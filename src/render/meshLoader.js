import * as THREE from 'three';

export class PartLibrary {
  constructor(base='./parts/'){ this.base=base; this.manifest=null; this.byId=new Map(); this.geometryCache=new Map(); }
  async loadManifest(){
    const r=await fetch(`${this.base}manifest.json`,{cache:'force-cache'}); if(!r.ok)throw new Error(`Parts manifest HTTP ${r.status}`);
    this.manifest=await r.json(); this.byId=new Map(this.manifest.parts.map(p=>[p.id,p])); return this.manifest;
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
    const promise=this.#loadVxm(`${this.base}${def.mesh}`); this.geometryCache.set(id,promise); return promise;
  }
  async #loadVxm(url){
    const r=await fetch(url,{cache:'force-cache'}); if(!r.ok)throw new Error(`Mesh HTTP ${r.status}`); const b=await r.arrayBuffer(); const dv=new DataView(b);
    const magic=String.fromCharCode(...new Uint8Array(b,0,4)); if(magic!=='VXM1')throw new Error('Invalid VEX mesh');
    const vc=dv.getUint32(4,true), ic=dv.getUint32(8,true); const min=[dv.getFloat32(12,true),dv.getFloat32(16,true),dv.getFloat32(20,true)], max=[dv.getFloat32(24,true),dv.getFloat32(28,true),dv.getFloat32(32,true)];
    const q=new Uint16Array(b,36,vc*3); const pos=new Float32Array(vc*3); for(let i=0;i<vc;i++)for(let a=0;a<3;a++)pos[i*3+a]=min[a]+(q[i*3+a]/65535)*(max[a]-min[a]);
    const indexOffset=36+vc*3*2; const idx=new Uint32Array(ic); for(let i=0;i<ic;i++) idx[i]=dv.getUint32(indexOffset+i*4,true);
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setIndex(new THREE.BufferAttribute(idx,1)); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

export function geometryFromOcct(result){
  if(!result?.success||!Array.isArray(result.meshes)||result.meshes.length===0)throw new Error('OpenCascade returned no mesh');
  const positions=[],indices=[]; let base=0;
  for(const mesh of result.meshes){
    const pa=mesh.attributes?.position?.array||[]; for(const p of pa){ positions.push(p[0],p[1],p[2]); }
    const ia=mesh.index?.array||[]; for(const tri of ia)indices.push(base+tri[0],base+tri[1],base+tri[2]); base+=pa.length;
  }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

export function geometryToProjectData(g){
  const p=g.getAttribute('position'); const i=g.index; return {positions:Array.from(p.array),indices:i?Array.from(i.array):[],bbox:g.boundingBox?{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()}:null};
}
export function geometryFromProjectData(d){
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(d.positions,3)); if(d.indices?.length)g.setIndex(d.indices); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
