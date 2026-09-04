import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const mat4=a=>new THREE.Matrix4().fromArray(a);
const arr=m=>m.toArray();
const disposeMaterial=m=>{if(Array.isArray(m))m.forEach(x=>x?.dispose?.());else m?.dispose?.();};

export class SceneRenderer {
  constructor(container,library,{quality='balanced',onContextLost=null}={}){
    this.container=container; this.library=library; this.quality=quality; this.scene=new THREE.Scene(); this.scene.background=new THREE.Color(0x101318);
    this.camera=new THREE.PerspectiveCamera(45,1,0.1,12000); this.camera.position.set(160,130,180); this.camera.up.set(0,0,1);
    this.renderer=new THREE.WebGLRenderer({antialias:quality!=='low',powerPreference:quality==='high'?'high-performance':'default'}); this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,quality==='low'?1:quality==='balanced'?1.35:1.75)); container.appendChild(this.renderer.domElement); this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();onContextLost?.();},{passive:false});
    this.orbit=new OrbitControls(this.camera,this.renderer.domElement); this.orbit.enableDamping=false; this.orbit.target.set(0,0,0); this.orbit.addEventListener('change',()=>this.invalidate());
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x253045,2.15)); const key=new THREE.DirectionalLight(0xffffff,2.2); key.position.set(130,-100,180); this.scene.add(key);
    this.grid=new THREE.GridHelper(800,80,0x4b5666,0x252b34); this.grid.rotateX(Math.PI/2); this.scene.add(this.grid);
    this.axes=new THREE.AxesHelper(60); this.scene.add(this.axes);
    this.batches=new Map(); this.customMeshes=new Map(); this.selectionHelpers=[]; this.entityMatrices=new Map(); this.entityHidden=new Map();
    this.ghost=null; this.markerGroup=new THREE.Group(); this.markerGeometry=new THREE.SphereGeometry(1.8,8,6); this.markerMaterial=new THREE.MeshBasicMaterial({color:0xf4d35e,transparent:true,opacity:.9}); this.snapMarkerMaterial=new THREE.MeshBasicMaterial({color:0x5de397,transparent:true,opacity:.9}); this.scene.add(this.markerGroup);
    this.pivot=new THREE.Object3D(); this.scene.add(this.pivot); this.transform=new TransformControls(this.camera,this.renderer.domElement); this.transformHelper=this.transform.getHelper(); this.scene.add(this.transformHelper); this.transform.attach(this.pivot); this.transform.enabled=false; this.transformHelper.visible=false;
    this.transform.addEventListener('dragging-changed',e=>{this.orbit.enabled=!e.value;});
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(container); this.resize(); this.invalidate();
  }
  setQuality(q){ this.quality=q; this.renderer.setPixelRatio(Math.min(devicePixelRatio,q==='low'?1:q==='balanced'?1.35:1.75)); this.resize(); }
  resize(){ const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight); this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); this.invalidate(); }
  invalidate(){ if(this.raf)return; this.raf=requestAnimationFrame(()=>{this.raf=0;this.renderer.render(this.scene,this.camera);}); }
  async ensureBatch(partId){
    if(this.batches.has(partId))return this.batches.get(partId); const def=this.library.get(partId),g=await this.library.geometry(partId);
    const material=new THREE.MeshStandardMaterial({color:def?.color||'#728095',roughness:.62,metalness:.03}); const batch={geometry:g,material,mesh:null,ids:[],capacity:0}; this.batches.set(partId,batch); return batch;
  }
  async sync(entities,customGeometries=new Map()){
    this.entityMatrices.clear(); this.entityHidden.clear(); const grouped=new Map();
    for(const e of entities.values()){this.entityMatrices.set(e.id,e.matrix);this.entityHidden.set(e.id,!!e.hidden); if(e.custom){this.#syncCustom(e,customGeometries.get(e.partId));continue;} if(!grouped.has(e.partId))grouped.set(e.partId,[]);grouped.get(e.partId).push(e);}
    for(const [partId,es] of grouped){const b=await this.ensureBatch(partId);this.#writeBatch(b,es);}
    for(const [partId,b] of this.batches){if(!grouped.has(partId))this.#writeBatch(b,[]);}
    for(const [id,obj] of [...this.customMeshes])if(!entities.has(id)){this.scene.remove(obj);disposeMaterial(obj.material);this.customMeshes.delete(id);}
    this.invalidate();
  }
  #writeBatch(b,entities){
    const needed=Math.max(1,entities.length); if(!b.mesh||needed>b.capacity){ if(b.mesh)this.scene.remove(b.mesh); b.capacity=Math.max(8,2**Math.ceil(Math.log2(needed))); b.mesh=new THREE.InstancedMesh(b.geometry,b.material,b.capacity); b.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); b.mesh.frustumCulled=true; this.scene.add(b.mesh); }
    b.ids=entities.map(e=>e.id); b.mesh.count=entities.length; const zero=new THREE.Matrix4().makeScale(0,0,0);
    entities.forEach((e,i)=>b.mesh.setMatrixAt(i,e.hidden?zero:mat4(e.matrix))); b.mesh.instanceMatrix.needsUpdate=true; b.mesh.computeBoundingSphere?.();
  }
  #syncCustom(e,g){
    if(!g)return; let mesh=this.customMeshes.get(e.id); if(!mesh){mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#98a8bb',roughness:.6}));mesh.userData.entityId=e.id;this.customMeshes.set(e.id,mesh);this.scene.add(mesh);} mesh.visible=!e.hidden;mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(e.matrix);mesh.matrixWorldNeedsUpdate=true;
  }
  pick(clientX,clientY){
    const r=this.renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2((clientX-r.left)/r.width*2-1,-((clientY-r.top)/r.height)*2+1); const ray=new THREE.Raycaster();ray.setFromCamera(p,this.camera);
    const objects=[...this.batches.values()].map(b=>b.mesh).filter(Boolean).concat([...this.customMeshes.values()]); const hits=ray.intersectObjects(objects,true);
    for(const h of hits){ if(h.object.isInstancedMesh){const b=[...this.batches.values()].find(x=>x.mesh===h.object);const id=b?.ids[h.instanceId];if(id)return id;} let o=h.object;while(o&&!o.userData.entityId)o=o.parent;if(o?.userData.entityId)return o.userData.entityId; }
    return null;
  }
  boxSelect(rect,entities){
    const out=[],r=this.renderer.domElement.getBoundingClientRect(); for(const e of entities.values()){if(e.hidden)continue; const p=new THREE.Vector3().setFromMatrixPosition(mat4(e.matrix)).project(this.camera); const x=r.left+(p.x+1)*.5*r.width,y=r.top+(1-p.y)*.5*r.height;if(x>=rect.x1&&x<=rect.x2&&y>=rect.y1&&y<=rect.y2)out.push(e.id);} return out;
  }
  setSelection(ids,entities,library=this.library){
    for(const h of this.selectionHelpers){this.scene.remove(h);h.geometry?.dispose?.();disposeMaterial(h.material);}this.selectionHelpers=[];
    for(const id of ids){const e=entities.get(id);if(!e||e.hidden)continue;let box;if(e.custom){const obj=this.customMeshes.get(id);if(obj)box=new THREE.Box3().setFromObject(obj);}else{const def=library.get(e.partId);if(def){box=new THREE.Box3(new THREE.Vector3(...def.bbox[0]),new THREE.Vector3(...def.bbox[1])).applyMatrix4(mat4(e.matrix));}}if(box){const h=new THREE.Box3Helper(box,0x62b0ff);this.selectionHelpers.push(h);this.scene.add(h);}}
    this.invalidate();
  }
  setupTransform(ids,entities,{onPreview,onCommit}){
    this.transform.enabled=false;this.transformHelper.visible=false;if(!ids.length)return;
    const movable=ids.filter(id=>!entities.get(id)?.locked);if(!movable.length)return; const center=new THREE.Vector3();for(const id of movable)center.add(new THREE.Vector3().setFromMatrixPosition(mat4(entities.get(id).matrix)));center.multiplyScalar(1/movable.length);this.pivot.position.copy(center);this.pivot.rotation.set(0,0,0);this.pivot.scale.set(1,1,1);this.pivot.updateMatrixWorld(true);this.transform.enabled=true;this.transformHelper.visible=true;
    let starts=null,pivotStart=null;
    const down=()=>{starts=new Map(movable.map(id=>[id,mat4(entities.get(id).matrix)]));this.pivot.updateMatrixWorld(true);pivotStart=this.pivot.matrixWorld.clone();};
    const change=()=>{if(!starts||!pivotStart)return;this.pivot.updateMatrixWorld(true);const delta=this.pivot.matrixWorld.clone().multiply(pivotStart.clone().invert());const map=new Map();for(const [id,m] of starts)map.set(id,arr(delta.clone().multiply(m)));onPreview?.(map);};
    const up=()=>{if(!starts)return;const before=new Map([...starts].map(([id,m])=>[id,arr(m)]));const after=new Map(movable.map(id=>[id,[...entities.get(id).matrix]]));starts=null;pivotStart=null;onCommit?.(before,after);};
    if(this._tDown)this.transform.removeEventListener('mouseDown',this._tDown);if(this._tChange)this.transform.removeEventListener('objectChange',this._tChange);if(this._tUp)this.transform.removeEventListener('mouseUp',this._tUp);
    this._tDown=down;this._tChange=change;this._tUp=up;this.transform.addEventListener('mouseDown',down);this.transform.addEventListener('objectChange',change);this.transform.addEventListener('mouseUp',up);
  }
  setTransformMode(mode){this.transform.setMode(mode);this.invalidate();}
  fit(ids,entities){
    const targets=ids.length?ids:[...entities.keys()];let box=new THREE.Box3(),found=false;
    for(const id of targets){const e=entities.get(id);if(!e||e.hidden)continue;let b;if(e.custom){const o=this.customMeshes.get(id);if(o)b=new THREE.Box3().setFromObject(o);}else{const d=this.library.get(e.partId);if(d)b=new THREE.Box3(new THREE.Vector3(...d.bbox[0]),new THREE.Vector3(...d.bbox[1])).applyMatrix4(mat4(e.matrix));}if(b&&!b.isEmpty()){box.union(b);found=true;}}
    if(!found)return;const c=box.getCenter(new THREE.Vector3()),size=Math.max(20,box.getSize(new THREE.Vector3()).length());this.orbit.target.copy(c);const currentDir=this.camera.position.clone().sub(this.orbit.target);const dir=currentDir.lengthSq()>1e-8?currentDir.normalize():new THREE.Vector3(1,1,1).normalize();this.camera.position.copy(c.clone().add(dir.multiplyScalar(size*1.15)));this.camera.near=Math.max(.1,size/1000);this.camera.far=Math.max(5000,size*20);this.camera.updateProjectionMatrix();this.orbit.update();this.invalidate();
  }
  async setGhost(partId,matrix,snapped=false){
    const g=await this.library.geometry(partId); if(!this.ghost||this.ghost.userData.partId!==partId){if(this.ghost){this.scene.remove(this.ghost);disposeMaterial(this.ghost.material);}this.ghost=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:snapped?0x5de397:0x62b0ff,transparent:true,opacity:.42,depthWrite:false}));this.ghost.userData.partId=partId;this.scene.add(this.ghost);}this.ghost.material.color.set(snapped?0x5de397:0x62b0ff);this.ghost.matrixAutoUpdate=false;this.ghost.matrix.copy(matrix);this.ghost.visible=true;this.invalidate();
  }
  clearGhost(){if(this.ghost){this.ghost.visible=false;this.invalidate();}}
  setMarkers(points){
    this.markerGroup.clear();for(const p of points.slice(0,60)){const m=new THREE.Mesh(this.markerGeometry,p.color===0x5de397?this.snapMarkerMaterial:this.markerMaterial);m.position.fromArray(p.point);this.markerGroup.add(m);}this.invalidate();
  }
  screenRay(clientX,clientY){const r=this.renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2((clientX-r.left)/r.width*2-1,-((clientY-r.top)/r.height)*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(p,this.camera);return ray.ray;}
}
