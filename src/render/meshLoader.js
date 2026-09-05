import * as THREE from 'three';

const MAX_VERTICES=2_000_000;
const MAX_INDICES=6_000_000;
const APP_ROOT=new URL('../../',import.meta.url);

async function fetchWithTimeout(url,{timeout=12000,cache='no-store'}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{cache,signal:controller.signal});}
  catch(err){
    if(err?.name==='AbortError')throw new Error(`Timed out loading ${new URL(url).pathname}`);
    throw err;
  }finally{clearTimeout(timer);}
}

async function gunzip(buffer){
  if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress the optimized VEX mesh format');
  const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

export class PartLibrary {
  constructor(base='./parts/'){
    this.base=new URL(base,APP_ROOT).href;
    this.manifest=null;
    this.byId=new Map();
    this.geometryCache=new Map();
  }
  async loadManifest(){
    const baseUrl=new URL('manifest.json',this.base);
    let lastError=null;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const url=new URL(baseUrl);
        if(attempt)url.searchParams.set('reload',Date.now().toString());
        const r=await fetchWithTimeout(url,{cache:'no-store'});
        if(!r.ok)throw new Error(`Parts manifest HTTP ${r.status}`);
        const manifest=await r.json();
        if(!manifest||!Array.isArray(manifest.parts)||manifest.parts.length===0)throw new Error('Parts manifest is invalid or empty');
        const byId=new Map();
        for(const p of manifest.parts){
          if(!p?.id||!p.mesh||byId.has(p.id))throw new Error(`Invalid or duplicate part definition: ${p?.id||'unknown'}`);
          byId.set(p.id,p);
        }
        this.manifest=manifest;
        this.byId=byId;
        return this.manifest;
      }catch(err){
        lastError=err;
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,350));
      }
    }
    throw new Error(`Could not load the VEX parts library: ${lastError?.message||'unknown error'}`);
  }
  get(id){ return this.byId.get(id); }
  search(query='',category='All'){
    const q=query.trim().toLowerCase(); const tokens=q.split(/\s+/).filter(Boolean);
    return (this.manifest?.parts||[]).filter(p=>category==='All'||p.category===category).filter(p=>{
      const hay=`${p.name} ${p.partNumber} ${p.category}`.toLowerCase(); return tokens.every(t=>hay.includes(t));
    });
  }
  async geometry(id){
    if(this.geometryCache.has(id))return this.geometryCache.get(id);
    const def=this.get(id); if(!def)throw new Error(`Unknown part ${id}`);
    const promise=this.#loadVxm(new URL(def.mesh,this.base)).catch(err=>{this.geometryCache.delete(id);throw err;});
    this.geometryCache.set(id,promise); return promise;
  }
  async #loadVxm(url){
    const r=await fetchWithTimeout(url,{timeout:18000,cache:'force-cache'}); if(!r.ok)throw new Error(`Mesh HTTP ${r.status}`); let b=await r.arrayBuffer();
    if(url.pathname.endsWith('.gz'))b=await gunzip(b);
    if(b.byteLength<36)throw new Error('VEX mesh is truncated');
    const dv=new DataView(b),magic=String.fromCharCode(...new Uint8Array(b,0,4)); if(magic!=='VXM1')throw new Error('Invalid VEX mesh');
    const vc=dv.getUint32(4,true),ic=dv.getUint32(8,true);
    if(!vc||!ic||ic%3||vc>MAX_VERTICES||ic>MAX_INDICES)throw new Error('VEX mesh counts are invalid');
    const expected=36+vc*6+ic*4;if(expected!==b.byteLength)throw new Error('VEX mesh byte length is invalid');
    const min=[dv.getFloat32(12,true),dv.getFloat32(16,true),dv.getFloat32(20,true)], max=[dv.getFloat32(24,true),dv.getFloat32(28,true),dv.getFloat32(32,true)];
    if([...min,...max].some(v=>!Number.isFinite(v)))throw new Error('VEX mesh bounds are invalid');
    const q=new Uint16Array(b,36,vc*3),pos=new Float32Array(vc*3); for(let i=0;i<vc;i++)for(let a=0;a<3;a++)pos[i*3+a]=min[a]+(q[i*3+a]/65535)*(max[a]-min[a]);
    const indexOffset=36+vc*3*2,idx=new Uint32Array(ic); for(let i=0;i<ic;i++){const v=dv.getUint32(indexOffset+i*4,true);if(v>=vc)throw new Error('VEX mesh index is out of range');idx[i]=v;}
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setIndex(new THREE.BufferAttribute(idx,1)); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

export function geometryFromOcct(result){
  if(!result?.success||!Array.isArray(result.meshes)||result.meshes.length===0)throw new Error('OpenCascade returned no mesh');
  const positions=[],indices=[]; let base=0;
  for(const mesh of result.meshes){
    const pa=mesh.attributes?.position?.array||[]; for(const p of pa){ if(!Array.isArray(p)||p.length<3||p.slice(0,3).some(v=>!Number.isFinite(v)))throw new Error('OpenCascade returned invalid vertices'); positions.push(p[0],p[1],p[2]); }
    const ia=mesh.index?.array||[]; for(const tri of ia){ if(!Array.isArray(tri)||tri.length<3)throw new Error('OpenCascade returned invalid triangles'); const a=tri[0],b=tri[1],c=tri[2];if(!Number.isInteger(a)||!Number.isInteger(b)||!Number.isInteger(c)||a<0||b<0||c<0||a>=pa.length||b>=pa.length||c>=pa.length)throw new Error('OpenCascade returned an out-of-range triangle');indices.push(base+a,base+b,base+c); } base+=pa.length;
    if(base>MAX_VERTICES||indices.length>MAX_INDICES)throw new Error('Imported CAD exceeds safe browser geometry limits');
  }
  if(positions.length<9||indices.length<3)throw new Error('OpenCascade returned an empty mesh');
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

export function geometryToProjectData(g){
  const p=g.getAttribute('position'); const i=g.index; if(!p)throw new Error('Geometry has no positions');
  return {positions:Array.from(p.array),indices:i?Array.from(i.array):[],bbox:g.boundingBox?{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()}:null};
}
export function geometryFromProjectData(d){
  if(!d||!Array.isArray(d.positions)||d.positions.length<9||d.positions.length%3!==0||d.positions.length>MAX_VERTICES*3)throw new Error('Project geometry positions are invalid');
  if(d.positions.some(v=>!Number.isFinite(v)))throw new Error('Project geometry contains invalid coordinates');
  const vertexCount=d.positions.length/3,indices=Array.isArray(d.indices)?d.indices:[];
  if(indices.length%3!==0||indices.length>MAX_INDICES||indices.some(v=>!Number.isInteger(v)||v<0||v>=vertexCount))throw new Error('Project geometry indices are invalid');
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(d.positions,3)); if(indices.length)g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
