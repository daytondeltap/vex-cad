import * as THREE from 'three';
import { PartLibrary, geometryFromOcct, geometryToProjectData, geometryFromProjectData } from './render/meshLoader.js';
import { SceneRenderer } from './render/sceneRenderer.js';
import { History, command } from './core/history.js';
import { compatible } from './core/snap.js';
import { applyConstraints, makeFixedConstraint, convertToRevolute } from './core/solver.js';
import { childConstraint, wouldCreateCycle } from './core/constraints.js';
import { serializeProject, validateProject } from './core/project.js';
import { CADImporter } from './workers/cadImporter.js';
import { MultiplayerClient } from './multiplayer.js';

const $=id=>document.getElementById(id);
const IDENTITY=new THREE.Matrix4();
const autoQuality=()=>((navigator.deviceMemory&&navigator.deviceMemory<=4)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4))?'low':'balanced';
const state={projectName:'Untitled',entities:new Map(),constraints:[],selection:new Set(),quality:autoQuality(),customGeometries:new Map()};
const history=new History(250);
const library=new PartLibrary('./parts/');
const importer=new CADImporter();
let renderer=null,libraryReady=false,placement=null,syncQueued=false,autosaveTimer=0,collabTimer=0,suppressCollab=0;
const remoteCursors=new Map();

function setStatus(msg,kind='info'){
  const el=$('status'); if(!el)return;
  el.textContent=msg; el.dataset.kind=kind; el.style.borderColor=kind==='error'?'#a84b55':kind==='warn'?'#a77b32':'#303844';
}
function uuid(){return crypto.randomUUID();}
function clone(v){return structuredClone(v);}
function finiteNumber(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function entityName(e){return e?.custom?.name||library.get(e?.partId)?.name||e?.name||'Part';}
function matrixTRS(matrix){const m=new THREE.Matrix4().fromArray(matrix),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);const r=new THREE.Euler().setFromQuaternion(q,'XYZ');return {p,r:[THREE.MathUtils.radToDeg(r.x),THREE.MathUtils.radToDeg(r.y),THREE.MathUtils.radToDeg(r.z)]};}
function composeTRS(p,r){const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.map(THREE.MathUtils.degToRad),'XYZ'));return new THREE.Matrix4().compose(new THREE.Vector3(...p),q,new THREE.Vector3(1,1,1)).toArray();}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const multiplayer=new MultiplayerClient({
  onSnapshot:async snapshot=>applyRemoteSnapshot(snapshot),
  onPresence:people=>renderPresence(people),
  onCursor:payload=>renderRemoteCursor(payload),
  onStatus:info=>renderCollabStatus(info),
});

function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{
    try{
      const text=JSON.stringify(serializeProject(state));
      if(text.length<4_000_000)localStorage.setItem('vex-cad-autosave',text); else localStorage.removeItem('vex-cad-autosave');
    }catch(err){console.warn('Autosave failed',err);}
  },650);
}
function scheduleCloudSync(){
  if(suppressCollab||!multiplayer.room)return;
  clearTimeout(collabTimer);
  collabTimer=setTimeout(()=>multiplayer.notifyState(serializeProject(state)).catch(err=>renderCollabStatus({state:'degraded',message:err.message})),180);
}
function scheduleSync({broadcast=true}={}){
  if(syncQueued||!renderer)return;
  syncQueued=true;
  requestAnimationFrame(async()=>{
    syncQueued=false;
    try{
      applyConstraints(state);
      if(libraryReady||[...state.entities.values()].every(e=>e.custom)) await renderer.sync(state.entities,state.customGeometries);
      else await renderer.sync(new Map([...state.entities].filter(([,e])=>e.custom)),state.customGeometries);
      renderer.setSelection(state.selection,state.entities);
      setupTransform(); renderInspector(); renderConstraints(); updateStats(); scheduleAutosave();
      if(broadcast)scheduleCloudSync();
    }catch(err){console.error(err);setStatus(`Render sync failed: ${err.message}`,'error');}
  });
}
function setSelection(ids){state.selection=new Set(ids.filter(id=>state.entities.has(id)));if(!renderer)return;renderer.setSelection(state.selection,state.entities);setupTransform();renderInspector();}

function localAttachmentDef(e){return e.custom?[]:(library.get(e.partId)?.attachments||[]);}
function worldAttachment(e,a){const m=new THREE.Matrix4().fromArray(e.matrix),p=new THREE.Vector3(...a.point).applyMatrix4(m),axis=new THREE.Vector3(...a.axis).transformDirection(m).normalize();return {...a,worldPoint:p.toArray(),worldAxis:axis.toArray()};}
function allTargetAttachments(){const out=[];for(const e of state.entities.values()){if(e.hidden)continue;for(const a of localAttachmentDef(e))out.push({entity:e,local:a,world:worldAttachment(e,a)});}return out;}
function makeSnapMatrix(source,targetWorld,spin=0){const sa=new THREE.Vector3(...source.axis).normalize(),ta=new THREE.Vector3(...targetWorld.worldAxis).normalize().negate(),q=new THREE.Quaternion().setFromUnitVectors(sa,ta);if(spin)q.premultiply(new THREE.Quaternion().setFromAxisAngle(ta,spin));const rp=new THREE.Vector3(...source.point).applyQuaternion(q),tp=new THREE.Vector3(...targetWorld.worldPoint),pos=tp.sub(rp);return new THREE.Matrix4().compose(pos,q,new THREE.Vector3(1,1,1));}
function bestSnap(partDef,freeMatrix){
  const sources=partDef?.attachments||[];if(!sources.length)return null;
  const freePos=new THREE.Vector3().setFromMatrixPosition(freeMatrix),candidates=[];
  for(const t of allTargetAttachments())for(const s of sources){if(!compatible(s,t.local))continue;const matrix=makeSnapMatrix(s,t.world,placement?.spin||0),pos=new THREE.Vector3().setFromMatrixPosition(matrix),d=pos.distanceTo(freePos);if(d<=22)candidates.push({score:d,matrix,source:s,target:t.local,targetEntity:t.entity,targetWorld:t.world});}
  candidates.sort((a,b)=>a.score-b.score);return candidates[placement?.candidateIndex%candidates.length||0]||null;
}

function setupTransform(){
  if(!renderer)return;
  const ids=[...state.selection].filter(id=>{const e=state.entities.get(id);return e&&!e.hidden&&!childConstraint(state.constraints,id);});
  renderer.setupTransform(ids,state.entities,{onPreview:map=>{
    for(const [id,m] of map)if(state.entities.has(id))state.entities.get(id).matrix=m;
    applyConstraints(state);
    renderer.sync(state.entities,state.customGeometries).then(()=>renderer.setSelection(state.selection,state.entities)).catch(err=>setStatus(`Preview failed: ${err.message}`,'error'));
  },onCommit:(before,after)=>{
    if(!before.size)return;
    history.record(command('Transform',()=>{for(const [id,m] of after)if(state.entities.has(id))state.entities.get(id).matrix=[...m];scheduleSync();},()=>{for(const [id,m] of before)if(state.entities.has(id))state.entities.get(id).matrix=[...m];scheduleSync();}));
    scheduleSync();
  }});
}
function createEntity(partId,matrix=IDENTITY.toArray(),custom=null){return {id:uuid(),partId,name:custom?.name||library.get(partId)?.name||'Part',matrix:[...matrix],hidden:false,locked:false,custom};}
function addPartCommand(e,constraint=null){history.execute(command('Add part',()=>{state.entities.set(e.id,e);if(constraint&&!state.constraints.some(c=>c.id===constraint.id))state.constraints.push(constraint);setSelection([e.id]);scheduleSync();},()=>{state.entities.delete(e.id);state.constraints=state.constraints.filter(c=>c.id!==constraint?.id&&c.parentId!==e.id&&c.childId!==e.id);setSelection([]);scheduleSync();}));}
function removeSelected(){const ids=[...state.selection];if(!ids.length)return;const ents=ids.map(id=>clone(state.entities.get(id))).filter(Boolean),related=state.constraints.filter(c=>ids.includes(c.parentId)||ids.includes(c.childId)).map(clone);history.execute(command('Delete parts',()=>{for(const id of ids)state.entities.delete(id);state.constraints=state.constraints.filter(c=>!ids.includes(c.parentId)&&!ids.includes(c.childId));setSelection([]);scheduleSync();},()=>{for(const e of ents)state.entities.set(e.id,e);for(const c of related)if(!state.constraints.some(x=>x.id===c.id))state.constraints.push(c);setSelection(ids);scheduleSync();}));}
function duplicateSelected(){const created=[];for(const id of state.selection){const src=state.entities.get(id);if(!src)continue;const e=clone(src);e.id=uuid();e.matrix=new THREE.Matrix4().makeTranslation(12,12,0).multiply(new THREE.Matrix4().fromArray(e.matrix)).toArray();created.push(e);}if(!created.length)return;history.execute(command('Duplicate',()=>{for(const e of created)state.entities.set(e.id,e);setSelection(created.map(e=>e.id));scheduleSync();},()=>{for(const e of created)state.entities.delete(e.id);setSelection([]);scheduleSync();}));}
function fixedConstraintForSelection(){const ids=[...state.selection];if(ids.length!==2)return;const [parentId,childId]=ids;if(childConstraint(state.constraints,childId)){setStatus('Second selected part already has a driving constraint.','error');return;}if(wouldCreateCycle(state.constraints,parentId,childId)){setStatus('That constraint would create a cycle.','error');return;}const c=makeFixedConstraint(state.entities.get(parentId),state.entities.get(childId));history.execute(command('Create fixed constraint',()=>{state.constraints.push(c);scheduleSync();},()=>{state.constraints=state.constraints.filter(x=>x.id!==c.id);scheduleSync();}));}

function beginPlacement(partId){if(!libraryReady){setStatus('Parts library is not ready yet.','warn');return;}const d=library.get(partId);if(!d)return;placement={partId,spin:0,candidate:null,candidateIndex:0,freeMatrix:new THREE.Matrix4(),lastPointer:null,requestId:0};$('placementHint').classList.remove('hidden');$('placementHint').textContent=`Placing ${d.name} · click to place · Q/E rotate · Tab cycle snap · Esc cancel`;setStatus('Move near a compatible attachment to SmartSnap.');}
function cancelPlacement(){placement=null;renderer?.clearGhost();renderer?.setMarkers([]);$('placementHint')?.classList.add('hidden');if(renderer)setStatus('Ready');}
async function updatePlacement(ev){if(!placement||!renderer)return;const current=placement;current.lastPointer={clientX:ev.clientX,clientY:ev.clientY};const requestId=++current.requestId,ray=renderer.screenRay(ev.clientX,ev.clientY),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0),hit=new THREE.Vector3();if(!ray.intersectPlane(plane,hit))return;const free=new THREE.Matrix4().makeTranslation(hit.x,hit.y,hit.z);current.freeMatrix=free;current.candidate=bestSnap(library.get(current.partId),free);try{await renderer.setGhost(current.partId,current.candidate?.matrix||free,!!current.candidate);if(placement!==current||requestId!==current.requestId)return;const markers=current.candidate?[{point:current.candidate.targetWorld.worldPoint,color:0x5de397}]:allTargetAttachments().filter(t=>new THREE.Vector3(...t.world.worldPoint).distanceTo(hit)<50).slice(0,35).map(t=>({point:t.world.worldPoint}));renderer.setMarkers(markers);}catch(err){if(placement===current)setStatus(`Part preview failed: ${err.message}`,'error');}}
function refreshPlacement(){if(placement?.lastPointer)updatePlacement(placement.lastPointer);}
function commitPlacement(){if(!placement)return;if(!placement.lastPointer){setStatus('Move the pointer over the workspace before placing.','warn');return;}const matrix=placement.candidate?.matrix||placement.freeMatrix,e=createEntity(placement.partId,matrix.toArray());let c=null;if(placement.candidate){const x=placement.candidate;c=makeFixedConstraint(x.targetEntity,e,x.target,x.source);}addPartCommand(e,c);placement.candidateIndex=0;setStatus(c?'Placed with SmartSnap constraint.':'Placed freely.');}

function renderParts(){const el=$('partsList');if(!el)return;if(!libraryReady){el.innerHTML='<div class="empty">Library unavailable. You can still import STEP/IGES/BREP.</div>';return;}const parts=library.search($('partSearch').value,$('category').value).slice(0,300);el.innerHTML=parts.map(p=>`<div class="part-row" data-id="${p.id}" role="button" tabindex="0"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.partNumber)}</small></div><span class="cat">${escapeHtml(p.category)}</span></div>`).join('')||'<div class="empty">No matches</div>';for(const row of el.querySelectorAll('.part-row')){const open=()=>beginPlacement(row.dataset.id);row.onclick=open;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};}}
function renderConstraints(){const el=$('constraints');if(!state.constraints.length){el.className='constraints empty';el.textContent='No constraints';return;}el.className='constraints';el.innerHTML=state.constraints.map(c=>`<div class="constraint-card"><b>${c.type==='fixed'?'Fixed':'Revolute'}</b>${escapeHtml(entityName(state.entities.get(c.parentId)))} → ${escapeHtml(entityName(state.entities.get(c.childId)))}${c.type==='revolute'?` · ${c.angle||0}°`:''}</div>`).join('');}
function renderInspector(){
  const el=$('inspector'),ids=[...state.selection];if(!ids.length){el.className='inspector empty';el.textContent='Select a part';return;}el.className='inspector';
  if(ids.length>1){el.innerHTML=`<b>${ids.length} parts selected</b><div class="row" style="margin-top:10px"><button id="multiFix">Fix 1 → 2</button><button id="multiDup">Duplicate</button></div>`;$('multiFix').onclick=fixedConstraintForSelection;$('multiDup').onclick=duplicateSelected;return;}
  const e=state.entities.get(ids[0]);if(!e){setSelection([]);return;}const def=e.custom?null:library.get(e.partId),tr=matrixTRS(e.matrix),driven=childConstraint(state.constraints,e.id),atts=def?.attachments||[],verified=atts.filter(a=>a.verified).length;
  el.innerHTML=`<b>${escapeHtml(entityName(e))}</b><div class="library-meta inspector-meta">${escapeHtml(def?.partNumber||'Imported CAD')} · ${verified}/${atts.length} verified axes</div>${driven?'<div class="constraint-card">Driven by a constraint. Detach it to move directly.</div>':''}<div class="field"><label>Position (mm)</label><div class="vec">${['X','Y','Z'].map((a,i)=>`<input data-pos="${i}" value="${tr.p.getComponent(i).toFixed(2)}" ${driven?'disabled':''} aria-label="${a}">`).join('')}</div></div><div class="field"><label>Rotation (deg)</label><div class="vec">${['X','Y','Z'].map((a,i)=>`<input data-rot="${i}" value="${tr.r[i].toFixed(1)}" ${driven?'disabled':''} aria-label="${a}">`).join('')}</div></div><div class="field row"><label><input id="lockToggle" type="checkbox" ${e.locked?'checked':''}/> Lock</label><label><input id="hideToggle" type="checkbox" ${e.hidden?'checked':''}/> Hide</label></div><div class="row"><button id="dupBtn">Duplicate</button><button id="deleteBtn">Delete</button><button id="isolateBtn">Isolate</button></div>${driven?constraintEditor(driven):''}`;
  const applyNumeric=()=>{const before=[...e.matrix],p=[...tr.p.toArray()],r=[...tr.r];for(const x of el.querySelectorAll('[data-pos]'))p[+x.dataset.pos]=finiteNumber(x.value,p[+x.dataset.pos]);for(const x of el.querySelectorAll('[data-rot]'))r[+x.dataset.rot]=finiteNumber(x.value,r[+x.dataset.rot]);const after=composeTRS(p,r);history.execute(command('Numeric transform',()=>{e.matrix=[...after];scheduleSync();},()=>{e.matrix=[...before];scheduleSync();}));};
  for(const x of el.querySelectorAll('[data-pos],[data-rot]'))x.onchange=applyNumeric;$('dupBtn').onclick=duplicateSelected;$('deleteBtn').onclick=removeSelected;$('isolateBtn').onclick=isolateSelection;$('lockToggle').onchange=ev=>toggleFlag(e,'locked',ev.target.checked);$('hideToggle').onchange=ev=>toggleFlag(e,'hidden',ev.target.checked);wireConstraintEditor(driven);
}
function constraintEditor(c){return `<div class="panel-title small inspector-subtitle">Constraint</div><div class="field"><label>Type</label><select id="constraintType"><option value="fixed" ${c.type==='fixed'?'selected':''}>Fixed</option><option value="revolute" ${c.type==='revolute'?'selected':''}>Revolute</option></select></div>${c.type==='revolute'?`<div class="field"><label>Angle <span id="angleValue">${c.angle||0}°</span></label><input id="constraintAngle" type="range" min="-180" max="180" value="${c.angle||0}"></div>`:''}<button id="detachConstraint">Detach constraint</button>`;}
function wireConstraintEditor(c){if(!c)return;$('constraintType').onchange=ev=>{const before=clone(c),after=ev.target.value==='revolute'?convertToRevolute(c,state.entities.get(c.parentId)):makeFixedConstraint(state.entities.get(c.parentId),state.entities.get(c.childId),c.targetAttachment,c.sourceAttachment);after.id=c.id;history.execute(command('Change constraint',()=>{Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,after);scheduleSync();},()=>{Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,before);scheduleSync();}));};if($('constraintAngle')){const slider=$('constraintAngle'),before=c.angle||0;slider.oninput=ev=>{c.angle=finiteNumber(ev.target.value,0);$('angleValue').textContent=`${c.angle}°`;scheduleSync();};slider.onchange=()=>{const after=c.angle||0;if(after!==before)history.record(command('Revolute angle',()=>{c.angle=after;scheduleSync();},()=>{c.angle=before;scheduleSync();}));};}$('detachConstraint').onclick=()=>{const copy=clone(c);history.execute(command('Detach constraint',()=>{state.constraints=state.constraints.filter(x=>x.id!==c.id);scheduleSync();},()=>{state.constraints.push(copy);scheduleSync();}));};}
function toggleFlag(e,key,value){const before=e[key];history.execute(command(`Set ${key}`,()=>{e[key]=value;scheduleSync();},()=>{e[key]=before;scheduleSync();}));}
function isolateSelection(){const before=new Map([...state.entities].map(([id,e])=>[id,e.hidden]));history.execute(command('Isolate',()=>{for(const [id,e] of state.entities)e.hidden=!state.selection.has(id);scheduleSync();},()=>{for(const [id,h] of before)if(state.entities.has(id))state.entities.get(id).hidden=h;scheduleSync();}));}
function updateStats(){$('stats').textContent=`${state.entities.size} parts · ${state.constraints.length} constraints`;}

function hydrateProject(p){const entities=new Map(),customGeometries=new Map();for(const raw of p.entities){const e=clone(raw);entities.set(e.id,e);if(e.custom?.geometry&&!customGeometries.has(e.partId))customGeometries.set(e.partId,geometryFromProjectData(e.custom.geometry));}return {entities,customGeometries,constraints:p.constraints.map(clone)};}
function applyProjectData(raw,{broadcast=false,label='Loaded'}={}){const p=validateProject(raw),next=hydrateProject(p);state.projectName=p.name||'Untitled';state.entities=next.entities;state.constraints=next.constraints;state.selection.clear();state.customGeometries=next.customGeometries;state.quality=p.settings?.quality||state.quality;$('quality').value=state.quality;$('projectName').textContent=state.projectName;renderer?.setQuality(state.quality);history.clear();cancelPlacement();scheduleSync({broadcast});setStatus(`${label} ${state.projectName}.`);}
async function applyRemoteSnapshot(snapshot){suppressCollab++;try{applyProjectData(snapshot,{broadcast:false,label:'Live sync:'});renderer?.fit([],state.entities);}catch(err){console.error(err);renderCollabStatus({state:'degraded',message:`Remote project rejected: ${err.message}`});}finally{suppressCollab--;}}
function newProject(){state.projectName='Untitled';state.entities.clear();state.constraints=[];state.selection.clear();state.customGeometries.clear();history.clear();$('projectName').textContent=state.projectName;cancelPlacement();scheduleSync();}
function saveProject(){const blob=new Blob([JSON.stringify(serializeProject(state))],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${state.projectName.replace(/[^a-z0-9_-]+/gi,'-')||'robot'}.vxcad`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setStatus('Project saved.');}
async function openProject(file){try{applyProjectData(JSON.parse(await file.text()),{broadcast:true,label:'Opened'});renderer.fit([],state.entities);}catch(err){console.error(err);setStatus(`Open failed: ${err.message}`,'error');}}
async function importCAD(file){setStatus(`OpenCascade importing ${file.name}…`);try{const result=await importer.import(file,state.quality),triCount=Math.floor((result.meshes||[]).reduce((n,m)=>n+(m.index?.array?.length||0),0)/3),triLimit=state.quality==='low'?1_000_000:state.quality==='high'?4_000_000:2_000_000;if(triCount>triLimit)throw new Error(`Imported CAD is too detailed for ${state.quality} mode (${triCount.toLocaleString()} triangles).`);const g=geometryFromOcct(result),partId=`custom:${uuid()}`,custom={name:file.name.replace(/\.(step|stp|iges|igs|brep|brp)$/i,''),geometry:geometryToProjectData(g)};state.customGeometries.set(partId,g);const e=createEntity(partId,IDENTITY.toArray(),custom);addPartCommand(e);renderer.fit([e.id],state.entities);setStatus(`Imported ${file.name}.`);}catch(err){console.error(err);setStatus(`Import failed: ${err.message}`,'error');}}
function restoreAutosave(){try{const t=localStorage.getItem('vex-cad-autosave');if(!t)return false;const p=validateProject(JSON.parse(t));if(!p.entities.length)return false;applyProjectData(p,{broadcast:false,label:'Recovered autosave:'});return true;}catch(err){console.warn('Autosave recovery failed',err);localStorage.removeItem('vex-cad-autosave');return false;}}

async function loadLibrary(){
  $('libraryMeta').innerHTML='Loading VEX IQ library…';
  try{
    const manifest=await library.loadManifest();libraryReady=true;
    const failed=manifest.failedCount??manifest.failures?.length??0;
    $('libraryMeta').textContent=`${manifest.partCount} VEX IQ models · ${manifest.verifiedBrepAttachments} verified axes${failed?` · ${failed} unavailable`:''}`;
    const cats=[...new Set(manifest.parts.map(p=>p.category))].sort();$('category').innerHTML='<option>All</option>'+cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');renderParts();
    if(!state.entities.size)restoreAutosave();else scheduleSync({broadcast:false});
    setStatus(failed?`Ready · catalog loaded with ${failed} unavailable source files.`:'Ready · choose a part to place it.');
    return true;
  }catch(err){
    libraryReady=false;console.error('Library load failed',err);$('libraryMeta').innerHTML=`Library failed: ${escapeHtml(err.message)} <button id="retryLibrary" class="link-button">Retry</button>`;$('retryLibrary').onclick=loadLibrary;renderParts();setStatus('Parts library unavailable. Imported CAD and local editing still work.','warn');return false;
  }
}

function setMode(mode){renderer?.setTransformMode(mode);$('moveBtn').classList.toggle('active',mode==='translate');$('rotateBtn').classList.toggle('active',mode==='rotate');}
function bindUI(){
  $('partSearch').oninput=renderParts;$('category').onchange=renderParts;$('newBtn').onclick=newProject;$('saveBtn').onclick=saveProject;$('openBtn').onclick=()=>$('projectFile').click();$('projectFile').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await openProject(f);};$('importBtn').onclick=()=>$('cadFile').click();$('cadFile').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await importCAD(f);};$('undoBtn').onclick=()=>history.undo();$('redoBtn').onclick=()=>history.redo();$('moveBtn').onclick=()=>setMode('translate');$('rotateBtn').onclick=()=>setMode('rotate');$('fitBtn').onclick=()=>renderer?.fit([...state.selection],state.entities);$('quality').onchange=e=>{state.quality=e.target.value;renderer?.setQuality(state.quality);scheduleSync();};
  $('shareBtn').onclick=()=>openSharePanel();$('closeShareBtn').onclick=closeSharePanel;$('createRoomBtn').onclick=createLiveRoom;$('copyRoomBtn').onclick=copyRoomLink;$('leaveRoomBtn').onclick=leaveLiveRoom;$('displayName').value=multiplayer.displayName;$('displayName').onchange=e=>multiplayer.setDisplayName(e.target.value);
  const canvas=renderer.renderer.domElement;let down=null,box=false;
  const clearPointerState=()=>{if(box){$('selectRect').classList.add('hidden');renderer.orbit.enabled=true;}box=false;down=null;};
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};try{canvas.setPointerCapture(e.pointerId);}catch{}if(e.shiftKey&&!placement){box=true;renderer.orbit.enabled=false;const r=$('selectRect');r.classList.remove('hidden');Object.assign(r.style,{left:`${e.clientX}px`,top:`${e.clientY}px`,width:'0px',height:'0px'});}});
  canvas.addEventListener('pointermove',e=>{const rect=canvas.getBoundingClientRect();if(rect.width&&rect.height)multiplayer.sendCursor((e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height,state.selection);if(placement){updatePlacement(e);return;}if(box&&down){const x1=Math.min(down.x,e.clientX),y1=Math.min(down.y,e.clientY),x2=Math.max(down.x,e.clientX),y2=Math.max(down.y,e.clientY),r=$('selectRect');Object.assign(r.style,{left:`${x1}px`,top:`${y1}px`,width:`${x2-x1}px`,height:`${y2-y1}px`});}});
  canvas.addEventListener('pointerup',e=>{if(e.button!==0)return;try{if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}if(placement){commitPlacement();clearPointerState();return;}if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);if(box){const rect={x1:Math.min(down.x,e.clientX),y1:Math.min(down.y,e.clientY),x2:Math.max(down.x,e.clientX),y2:Math.max(down.y,e.clientY)};$('selectRect').classList.add('hidden');renderer.orbit.enabled=true;box=false;setSelection(renderer.boxSelect(rect,state.entities));}else if(moved<5){const id=renderer.pick(e.clientX,e.clientY);if(id)setSelection(e.ctrlKey||e.metaKey?[...new Set([...state.selection,id])]:[id]);else setSelection([]);}down=null;});
  canvas.addEventListener('pointercancel',clearPointerState);window.addEventListener('blur',clearPointerState);
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('sharePanel').classList.contains('open')){closeSharePanel();return;}if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?history.redo():history.undo();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();history.redo();return;}if(e.key==='Delete'||e.key==='Backspace')removeSelected();else if(e.key.toLowerCase()==='m')setMode('translate');else if(e.key.toLowerCase()==='r'&&!placement)setMode('rotate');else if(e.key.toLowerCase()==='f')renderer.fit([...state.selection],state.entities);else if(e.key==='Escape')cancelPlacement();else if(placement&&(e.key.toLowerCase()==='q'||e.key.toLowerCase()==='e')){placement.spin+=(e.key.toLowerCase()==='q'?-1:1)*Math.PI/2;placement.candidateIndex=0;refreshPlacement();}else if(placement&&e.key==='Tab'){e.preventDefault();placement.candidateIndex++;refreshPlacement();}});
}

function openSharePanel(){$('sharePanel').classList.add('open');$('sharePanel').setAttribute('aria-hidden','false');updateSharePanel();}
function closeSharePanel(){$('sharePanel').classList.remove('open');$('sharePanel').setAttribute('aria-hidden','true');}
function updateSharePanel(){const room=multiplayer.room,link=multiplayer.shareUrl();$('roomCode').textContent=room?.code||'Not live';$('roomLink').value=link||'';$('copyRoomBtn').disabled=!link;$('leaveRoomBtn').disabled=!room;$('createRoomBtn').disabled=!!room;if(!room)$('livePeople').textContent='Start a live room to collaborate.';}
async function createLiveRoom(){try{$('createRoomBtn').disabled=true;renderCollabStatus({state:'connecting',message:'Creating room…'});const link=await multiplayer.createRoom(serializeProject(state),state.projectName);$('roomLink').value=link;updateSharePanel();await copyRoomLink();}catch(err){console.error(err);renderCollabStatus({state:'error',message:`Room failed: ${err.message}`});$('createRoomBtn').disabled=false;}}
async function copyRoomLink(){const link=multiplayer.shareUrl();if(!link)return;try{await navigator.clipboard.writeText(link);setStatus('Live room link copied.');}catch{$('roomLink').focus();$('roomLink').select();setStatus('Copy the selected room link.','warn');}}
async function leaveLiveRoom(){await multiplayer.leaveRoom();window.history.replaceState(null,'',location.pathname+location.search);clearRemoteCursors();updateSharePanel();}
function renderCollabStatus(info){const el=$('collabStatus');if(!el)return;el.textContent=info?.message||'Local only';el.dataset.state=info?.state||'offline';updateSharePanel();}
function renderPresence(people){$('presenceCount').textContent=`${people.length} online`;$('presenceList').innerHTML=people.length?people.map(p=>`<div class="presence-person">${escapeHtml(p.name)}${p.actorId===multiplayer.actorId?' · you':''}</div>`).join(''):'<div class="empty">No collaborators connected.</div>';if(multiplayer.room)$('livePeople').textContent=`${people.length} collaborator${people.length===1?'':'s'} online`;}
function renderRemoteCursor(p){if(!p?.actorId)return;let item=remoteCursors.get(p.actorId);if(!item){const el=document.createElement('div');el.className='remote-cursor';el.innerHTML='<span class="cursor-dot"></span><span class="cursor-label"></span>';$('remoteCursors').appendChild(el);item={el,timer:0};remoteCursors.set(p.actorId,item);}item.el.querySelector('.cursor-label').textContent=p.name||'Builder';item.el.style.left=`${Math.max(0,Math.min(1,p.x))*100}%`;item.el.style.top=`${Math.max(0,Math.min(1,p.y))*100}%`;clearTimeout(item.timer);item.timer=setTimeout(()=>{item.el.remove();remoteCursors.delete(p.actorId);},3200);}
function clearRemoteCursors(){for(const item of remoteCursors.values()){clearTimeout(item.timer);item.el.remove();}remoteCursors.clear();}

async function createRenderer(){
  const make=q=>new SceneRenderer($('viewport'),library,{quality:q,onContextLost:()=>setStatus('Graphics context lost. Your project is autosaved; waiting for GPU recovery…','error')});
  try{return make(state.quality);}catch(first){console.warn('Renderer init failed',first);if(state.quality!=='low'){state.quality='low';$('quality').value='low';try{return make('low');}catch(second){console.error(second);throw second;}}throw first;}
}

async function boot(){
  globalThis.__vexBooted=true;clearTimeout(globalThis.__vexBootTimer);
  setStatus('Starting graphics…');
  try{renderer=await createRenderer();$('quality').value=state.quality;bindUI();await renderer.sync(new Map(),state.customGeometries);$('perf').textContent=`WebGL · ${state.quality}`;setStatus('Graphics ready · loading parts library…');}
  catch(err){console.error(err);setStatus(`Graphics startup failed: ${err.message}`,'error');$('perf').textContent='GPU unavailable';$('libraryMeta').innerHTML='Graphics failed. Try Low quality, update browser/GPU drivers, or reload.';return;}
  const ok=await loadLibrary();
  if(ok){try{const room=multiplayer.parseRoomFromLocation();if(room){renderCollabStatus({state:'connecting',message:'Joining shared room…'});await multiplayer.autoJoin();renderer.fit([],state.entities);}}catch(err){console.error(err);renderCollabStatus({state:'error',message:`Live join failed: ${err.message}`});setStatus('Local editor ready; live room connection failed.','warn');}}
  else if(multiplayer.parseRoomFromLocation())renderCollabStatus({state:'degraded',message:'Room link detected · waiting for parts library'});
  updateSharePanel();
}

boot().catch(err=>{console.error(err);setStatus(`Fatal startup error: ${err.message}`,'error');});
