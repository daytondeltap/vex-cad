#!/usr/bin/env python3
from pathlib import Path


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old,new,1)


app_path=Path('src/app-stable.js')
app=app_path.read_text(encoding='utf8')

app=replace_once(app,
"let editorClipboard=null,pasteSerial=0;",
"let editorClipboard=null,pasteSerial=0,autoAlign=null;",
'editor state')

app=replace_once(app,
"function setSelection(ids){state.selection=new Set(expandGroupedIds(ids));if(!renderer)return;renderer.setSelection(state.selection,state.entities);setupTransform();renderInspector();}",
"function setSelection(ids){if(autoAlign)cancelAutoAlign(true);state.selection=new Set(expandGroupedIds(ids));if(!renderer)return;renderer.setSelection(state.selection,state.entities);setupTransform();renderInspector();updateAutoAlignButton();}",
'group-aware selection')

marker="function beginPlacement(partId){"
if marker not in app:
    raise SystemExit('Auto Align insertion marker missing')
if 'function startAutoAlign()' in app:
    raise SystemExit('Auto Align already present')

auto_align=r'''function updateAutoAlignButton(){
  const btn=$('autoAlignBtn');if(!btn)return;
  btn.disabled=state.selection.size!==2||!!placement;
  btn.classList.toggle('active',!!autoAlign);btn.setAttribute('aria-pressed',autoAlign?'true':'false');
}
function autoAlignAttachments(e){return localAttachmentDef(e).filter(a=>Array.isArray(a?.point)&&Array.isArray(a?.axis));}
function autoAlignHint(text){const hint=$('placementHint');if(!hint)return;hint.classList.remove('hidden');hint.textContent=text;}
function renderAutoAlignMarkers(){
  if(!autoAlign||!renderer)return;
  const markers=[];
  for(const id of autoAlign.ids){const e=state.entities.get(id);if(!e)continue;for(const a of autoAlignAttachments(e)){const selected=autoAlign.first?.entityId===id&&sameAttachment(autoAlign.first.attachment,a);markers.push({point:worldAttachment(e,a).worldPoint,color:selected?0x5de397:undefined});}}
  renderer.setMarkers(markers);
}
function cancelAutoAlign(quiet=false){
  if(!autoAlign)return false;autoAlign=null;renderer?.setMarkers([]);const hint=$('placementHint');hint?.classList.add('hidden');if(renderer){renderer.orbit.enabled=renderer.navigationPreset==='standard';setupTransform();}updateAutoAlignButton();if(!quiet)setStatus('Auto Align cancelled.');return true;
}
function startAutoAlign(){
  if(autoAlign){cancelAutoAlign();return;}
  const ids=[...state.selection];if(ids.length!==2){setStatus('Auto Align needs exactly two selected parts. Ctrl/Cmd-click the second part, then try again.','warn');return;}
  const [a,b]=ids.map(id=>state.entities.get(id));if(!a||!b)return;
  if(a.custom||b.custom){setStatus('Auto Align currently needs catalog parts with detected connection points.','warn');return;}
  if(!autoAlignAttachments(a).length||!autoAlignAttachments(b).length){setStatus('One selected part has no detected connection points.','warn');return;}
  cancelPlacement();autoAlign={ids,first:null};
  renderer.transform.enabled=false;renderer.transformHelper.visible=false;renderer.orbit.enabled=false;
  autoAlignHint('Auto Align · 1 of 2 · click a highlighted connection point on the part that should stay still · Esc cancel');
  setStatus('Auto Align: choose the stationary connection point first.');renderAutoAlignMarkers();updateAutoAlignButton();
}
function pickAutoAlignAttachment(clientX,clientY,ids){
  if(!renderer)return null;const canvas=renderer.renderer.domElement,rect=canvas.getBoundingClientRect();let best=null;
  for(const id of ids){const e=state.entities.get(id);if(!e)continue;for(const a of autoAlignAttachments(e)){
    const world=worldAttachment(e,a),p=new THREE.Vector3(...world.worldPoint).project(renderer.camera);if(p.z<-1||p.z>1)continue;
    const sx=rect.left+(p.x+1)*.5*rect.width,sy=rect.top+(1-p.y)*.5*rect.height,d=Math.hypot(clientX-sx,clientY-sy);
    if(d<=28&&(!best||d<best.distance))best={entityId:id,attachment:a,world,distance:d};
  }}
  return best;
}
function autoAlignMatrix(anchorEntity,anchorAttachment,movingEntity,movingAttachment){
  const anchorDef=library.get(anchorEntity.partId),movingDef=library.get(movingEntity.partId),anchorWorld=worldAttachment(anchorEntity,anchorAttachment),movingWorld=worldAttachment(movingEntity,movingAttachment);
  const fromAxis=new THREE.Vector3(...movingWorld.worldAxis).normalize(),anchorAxis=new THREE.Vector3(...anchorWorld.worldAxis).normalize(),toAxis=anchorAxis.clone().negate();
  const q=new THREE.Quaternion().setFromUnitVectors(fromAxis,toAxis),sourcePoint=new THREE.Vector3(...movingWorld.worldPoint),anchorPoint=new THREE.Vector3(...anchorWorld.worldPoint);
  const around=new THREE.Matrix4().makeTranslation(sourcePoint.x,sourcePoint.y,sourcePoint.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-sourcePoint.x,-sourcePoint.y,-sourcePoint.z));
  let desired=null,kind='geometric';
  if(compatible(movingAttachment,anchorAttachment)){
    const physical=physicalSnapTarget(movingDef,movingAttachment,{entity:anchorEntity,def:anchorDef,local:anchorAttachment,world:anchorWorld});
    if(!physical)return {error:'Those connection points are occupied or cannot physically fit.'};
    desired=new THREE.Vector3(...physical.targetWorld.worldPoint);kind='insert';
  }else if(isReceptacle(movingAttachment)&&isReceptacle(anchorAttachment)){
    const anchorDepth=receptacleDepth(anchorDef,anchorAttachment),movingDepth=receptacleDepth(movingDef,movingAttachment);if(!(anchorDepth>0&&movingDepth>0))return {error:'Could not determine the two hole depths.'};
    const separation=(anchorDepth+movingDepth)*.5,a=anchorPoint.clone().addScaledVector(anchorAxis,separation),b=anchorPoint.clone().addScaledVector(anchorAxis,-separation);
    desired=a.distanceToSquared(sourcePoint)<=b.distanceToSquared(sourcePoint)?a:b;kind='flush-holes';
  }else return {error:'Those two connection-point types cannot be physically aligned.'};
  const delta=desired.clone().sub(sourcePoint),after=new THREE.Matrix4().makeTranslation(delta.x,delta.y,delta.z).multiply(around).multiply(new THREE.Matrix4().fromArray(movingEntity.matrix));
  return {matrix:after.toArray(),kind};
}
function handleAutoAlignClick(ev){
  if(!autoAlign)return false;
  const ids=autoAlign.first?autoAlign.ids.filter(id=>id!==autoAlign.first.entityId):autoAlign.ids,pick=pickAutoAlignAttachment(ev.clientX,ev.clientY,ids);
  if(!pick){setStatus('Click one of the highlighted connection points.','warn');return true;}
  if(!autoAlign.first){
    autoAlign.first=pick;const otherId=autoAlign.ids.find(id=>id!==pick.entityId),other=state.entities.get(otherId);
    autoAlignHint(`Auto Align · 2 of 2 · click the matching point on ${entityName(other)} · Esc cancel`);setStatus(`Anchor chosen on ${entityName(state.entities.get(pick.entityId))}. Now choose the point to move.`);renderAutoAlignMarkers();return true;
  }
  const anchor=state.entities.get(autoAlign.first.entityId),moving=state.entities.get(pick.entityId);if(!anchor||!moving){cancelAutoAlign(true);return true;}
  if(moving.locked||childConstraint(state.constraints,moving.id)){setStatus('That second part is locked or driven. Restart Auto Align and choose it first so it stays stationary.','warn');return true;}
  const result=autoAlignMatrix(anchor,autoAlign.first.attachment,moving,pick.attachment);if(result.error){setStatus(result.error,'warn');return true;}
  const idsCopy=[...autoAlign.ids],before=[...moving.matrix],after=[...result.matrix];autoAlign=null;renderer.setMarkers([]);$('placementHint')?.classList.add('hidden');renderer.orbit.enabled=renderer.navigationPreset==='standard';updateAutoAlignButton();
  history.execute(command('Auto Align',()=>{moving.matrix=[...after];setSelection(idsCopy);scheduleSync();},()=>{moving.matrix=[...before];setSelection(idsCopy);scheduleSync();}));
  setStatus(result.kind==='flush-holes'?'Auto Align complete · holes are coaxial and the part faces are flush. Add a connector if the joint should be physically fastened.':'Auto Align complete · compatible connection points inserted using physical fit.');
  return true;
}

'''
app=app.replace(marker,auto_align+marker,1)

app=replace_once(app,
"function beginPlacement(partId){if(!libraryReady){",
"function beginPlacement(partId){if(autoAlign)cancelAutoAlign(true);if(!libraryReady){",
'placement cancels align')

old_multi="if(ids.length>1){const grouped=ids.some(id=>state.entities.get(id)?.groupId);el.innerHTML=`<b>${ids.length} parts selected</b><div class=\"row\" style=\"margin-top:10px\"><button id=\"multiFix\">Fix 1 → 2</button><button id=\"multiDup\">Duplicate</button><button id=\"multiGroup\">${grouped?'Regroup':'Group'}</button>${grouped?'<button id=\"multiUngroup\">Ungroup</button>':''}</div><div class=\"library-meta inspector-meta\">${grouped?'Grouped selection · Ctrl/Cmd+Shift+G to ungroup':'Ctrl/Cmd+G groups selection · Ctrl/Cmd+D duplicates'}</div>`;$('multiFix').onclick=fixedConstraintForSelection;$('multiDup').onclick=duplicateSelected;$('multiGroup').onclick=groupSelected;if($('multiUngroup'))$('multiUngroup').onclick=ungroupSelected;return;}"
new_multi="if(ids.length>1){const grouped=ids.some(id=>state.entities.get(id)?.groupId),canAlign=ids.length===2;el.innerHTML=`<b>${ids.length} parts selected</b><div class=\"row\" style=\"margin-top:10px\">${canAlign?'<button id=\"multiAlign\" class=\"primary\">Auto Align</button>':''}<button id=\"multiFix\">Fix 1 → 2</button><button id=\"multiDup\">Duplicate</button><button id=\"multiGroup\">${grouped?'Regroup':'Group'}</button>${grouped?'<button id=\"multiUngroup\">Ungroup</button>':''}</div><div class=\"library-meta inspector-meta\">${canAlign?'Ctrl/Cmd+Shift+A · choose an anchor point, then a point to move':grouped?'Grouped selection · Ctrl/Cmd+Shift+G to ungroup':'Ctrl/Cmd+G groups selection · Ctrl/Cmd+D duplicates'}</div>`;if($('multiAlign'))$('multiAlign').onclick=startAutoAlign;$('multiFix').onclick=fixedConstraintForSelection;$('multiDup').onclick=duplicateSelected;$('multiGroup').onclick=groupSelected;if($('multiUngroup'))$('multiUngroup').onclick=ungroupSelected;return;}"
app=replace_once(app,old_multi,new_multi,'multi inspector')

old_bind="$('partSearch').oninput=renderParts;$('category').onchange=renderParts;$('newBtn').onclick=newProject;$('saveBtn').onclick=saveProject;$('openBtn').onclick=()=>$('projectFile').click();$('projectFile').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await openProject(f);};$('importBtn').onclick=()=>$('cadFile').click();$('cadFile').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await importCAD(f);};$('undoBtn').onclick=()=>history.undo();$('redoBtn').onclick=()=>history.redo();$('moveBtn').onclick=()=>setMode('translate');$('rotateBtn').onclick=()=>setMode('rotate');$('fitBtn').onclick=()=>renderer?.fit([...state.selection],state.entities);$('quality').onchange=e=>{state.quality=e.target.value;renderer?.setQuality(state.quality);scheduleSync();};"
new_bind=old_bind+"$('autoAlignBtn').onclick=startAutoAlign;updateAutoAlignButton();"
app=replace_once(app,old_bind,new_bind,'toolbar bindings')

old_down="canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};try{canvas.setPointerCapture(e.pointerId);}catch{}if(e.shiftKey&&!placement){box=true;renderer.orbit.enabled=false;const r=$('selectRect');r.classList.remove('hidden');Object.assign(r.style,{left:`${e.clientX}px`,top:`${e.clientY}px`,width:'0px',height:'0px'});}});"
new_down="canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};try{canvas.setPointerCapture(e.pointerId);}catch{}if(autoAlign){renderer.orbit.enabled=false;return;}if(e.shiftKey&&!placement){box=true;renderer.orbit.enabled=false;const r=$('selectRect');r.classList.remove('hidden');Object.assign(r.style,{left:`${e.clientX}px`,top:`${e.clientY}px`,width:'0px',height:'0px'});}});"
app=replace_once(app,old_down,new_down,'pointer down')

old_move="canvas.addEventListener('pointermove',e=>{const rect=canvas.getBoundingClientRect();if(rect.width&&rect.height)multiplayer.sendCursor((e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height,state.selection);if(placement){updatePlacement(e);return;}if(box&&down){"
new_move="canvas.addEventListener('pointermove',e=>{const rect=canvas.getBoundingClientRect();if(rect.width&&rect.height)multiplayer.sendCursor((e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height,state.selection);if(placement){updatePlacement(e);return;}if(autoAlign)return;if(box&&down){"
app=replace_once(app,old_move,new_move,'pointer move')

old_up="canvas.addEventListener('pointerup',e=>{if(e.button!==0)return;try{if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}if(placement){commitPlacement();clearPointerState();return;}if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);if(box){"
new_up="canvas.addEventListener('pointerup',e=>{if(e.button!==0)return;try{if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}if(placement){commitPlacement();clearPointerState();return;}if(autoAlign){if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);if(moved<7)handleAutoAlignClick(e);down=null;return;}if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);if(box){"
app=replace_once(app,old_up,new_up,'pointer up')

old_key="if(mod&&key==='d'){e.preventDefault();duplicateSelected();return;}if(mod&&key==='a'){e.preventDefault();setSelection([...state.entities.keys()]);return;}"
new_key="if(mod&&key==='d'){e.preventDefault();duplicateSelected();return;}if(mod&&key==='a'&&e.shiftKey){e.preventDefault();startAutoAlign();return;}if(mod&&key==='a'){e.preventDefault();setSelection([...state.entities.keys()]);return;}"
app=replace_once(app,old_key,new_key,'Auto Align shortcut')

old_escape="else if(key==='f')renderer.fit([...state.selection],state.entities);else if(e.key==='Escape')cancelPlacement();"
new_escape="else if(key==='f')renderer.fit([...state.selection],state.entities);else if(e.key==='Escape'){if(!cancelAutoAlign())cancelPlacement();}"
app=replace_once(app,old_escape,new_escape,'Escape behavior')

old_api="duplicate:duplicateSelected,setStatus,scheduleSync:()=>scheduleSync({broadcast:false}),isLibraryReady:()=>libraryReady};}"
new_api="duplicate:duplicateSelected,autoAlign:startAutoAlign,cancelAutoAlign,setStatus,scheduleSync:()=>scheduleSync({broadcast:false}),isLibraryReady:()=>libraryReady};}"
app=replace_once(app,old_api,new_api,'app API')
app_path.write_text(app,encoding='utf8')

# Add a clear top-toolbar entry and a compact control hint.
index_path=Path('index.html');index=index_path.read_text(encoding='utf8')
index=replace_once(index,
'<button id="rotateBtn">Rotate</button><button id="fitBtn">Fit</button>',
'<button id="rotateBtn">Rotate</button><button id="autoAlignBtn" class="auto-align-button" title="Select 2 parts, then choose 2 connection points · Ctrl/Cmd+Shift+A" aria-pressed="false" disabled>Auto Align</button><button id="fitBtn">Fit</button>',
'toolbar Auto Align button')
index=replace_once(index,
'<span>Shift+drag box select · Esc cancel · Delete remove · M/R transform</span>',
'<span>Ctrl/Cmd+click multi-select · Ctrl/Cmd+Shift+A Auto Align · Q/E 90° placement rotate · Esc cancel</span>',
'footer controls')
index_path.write_text(index,encoding='utf8')

# Keep the dynamic settings footer equally discoverable in both navigation modes.
studio_path=Path('src/studio-settings.js');studio=studio_path.read_text(encoding='utf8')
old="footer.textContent=settings.controlsPreset==='roblox'?`${prettyKey(settings.bindings.cycleTransform)} cycle tool · RMB look · WASD fly · MMB pan · LMB drag select`:'Shift+drag box select · Esc cancel · Delete remove · M/R transform';"
new="footer.textContent=settings.controlsPreset==='roblox'?`${prettyKey(settings.bindings.cycleTransform)} cycle tool · RMB look · WASD fly · Ctrl/Cmd+Shift+A align`:'Ctrl/Cmd+click multi-select · Ctrl/Cmd+Shift+A Auto Align · M/R transform';"
studio=replace_once(studio,old,new,'settings footer')
studio_path.write_text(studio,encoding='utf8')

print('Auto Align patch applied')
