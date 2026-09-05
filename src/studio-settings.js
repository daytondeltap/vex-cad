import { DEFAULT_SETTINGS, loadSettings, saveSettings, normalizeSettings, eventKey, keyMatches } from './settings.js';

const $=id=>document.getElementById(id);
let settings=loadSettings(),renderer=null,recordingBinding=null,leftStart=null,robloxBox=false,synthetic=false;
const movementActions=['forward','back','left','right','up','down'];
const labels={forward:'Forward',back:'Back',left:'Left',right:'Right',up:'Up',down:'Down',cycleTransform:'Cycle Move / Rotate',moveTool:'Move tool',rotateTool:'Rotate tool',fit:'Frame selection',delete:'Delete selection'};
const prettyKey=k=>k.length===1?k.toUpperCase():k.replace('arrow','Arrow ').replace('delete','Delete').replace('backspace','Backspace').replace('space','Space');
const placementActive=()=>!$('placementHint')?.classList.contains('hidden');
const modalOpen=()=>!!document.querySelector('.settings-panel.open,.share-panel.open,.simulation-panel.open,.tutorial-panel.open,.tutorial-viewer.open');
const typing=()=>['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable;

function publishSettings(){globalThis.__vexFeatureSettings=settings;window.dispatchEvent(new CustomEvent('vex-settings-changed',{detail:settings}));}
function hardStopRobloxMotion(){
  if(!renderer)return;
  for(const a of [...movementActions,'fast'])renderer.setRobloxKey?.(a,false);
  renderer.navKeys?.clear?.();renderer.navPointer=null;
  if(renderer.navFrame){cancelAnimationFrame(renderer.navFrame);renderer.navFrame=0;}
  leftStart=null;robloxBox=false;
  const r=$('selectRect');if(r&&!r.classList.contains('hidden'))r.classList.add('hidden');
}
globalThis.__vexStopMotion=hardStopRobloxMotion;

function injectUI(){
  if($('settingsBtn'))return;
  const btn=document.createElement('button');btn.id='settingsBtn';btn.className='settings-button';btn.textContent='Settings';btn.title='Controls, graphics, snapping and keybinds';
  const tools=document.querySelector('.tools');tools?.appendChild(btn);
  const panel=document.createElement('section');panel.id='settingsPanel';panel.className='settings-panel';panel.setAttribute('aria-hidden','true');panel.innerHTML=`
    <div class="settings-card" role="dialog" aria-modal="true" aria-label="VEX CAD settings">
      <div class="settings-head"><div><b>Settings</b><small>Graphics, navigation, snapping and keybinds</small></div><button id="closeSettingsBtn" aria-label="Close settings">×</button></div>
      <div class="settings-scroll">
        <section class="settings-section"><div class="settings-section-title">Navigation</div>
          <label class="settings-row"><span><b>Control preset</b><small>Standard CAD orbit or Roblox Studio-style navigation.</small></span><select id="controlPreset"><option value="standard">Standard CAD</option><option value="roblox">Roblox Studio</option></select></label>
          <div id="robloxControls" class="settings-subgroup">
            <label class="settings-row"><span><b>Mouse look sensitivity</b><small>Right-click camera look.</small></span><input id="lookSensitivity" type="range" min="0.1" max="2.5" step="0.05"><output id="lookSensitivityValue"></output></label>
            <label class="settings-row"><span><b>Fly speed</b><small>WASD/QE movement in mm/s. Hold Shift for 3×.</small></span><input id="moveSpeed" type="range" min="20" max="800" step="10"><output id="moveSpeedValue"></output></label>
            <label class="settings-row"><span><b>Middle-pan sensitivity</b><small>Lateral canvas movement.</small></span><input id="panSensitivity" type="range" min="0.2" max="3" step="0.1"><output id="panSensitivityValue"></output></label>
            <label class="settings-row compact"><span><b>Invert vertical look</b></span><input id="invertY" type="checkbox"></label>
            <div class="control-cheatsheet"><b>Roblox Studio preset</b><span>RMB + mouse: look</span><span>WASD: fly</span><span>Q / E: down / up</span><span>MMB + drag: pan</span><span>LMB + drag: box select</span><span>Wheel: move camera forward/back</span><span>Any menu/focus change: stop movement</span></div>
          </div>
        </section>
        <section class="settings-section"><div class="settings-section-title">Proximity Snapping</div>
          <label class="settings-row compact"><span><b>Enable proximity snapping</b><small>Pins and compatible connectors align to nearby detected holes/axes.</small></span><input id="proximitySnap" type="checkbox"></label>
          <div id="snapControls" class="settings-subgroup">
            <label class="settings-row"><span><b>Snap distance</b><small>Maximum attachment-point distance before auto-alignment.</small></span><input id="snapDistance" type="range" min="4" max="60" step="1"><output id="snapDistanceValue"></output></label>
            <label class="settings-row"><span><b>Approach angle</b><small>How far a pin may be angled away from a hole and still snap.</small></span><input id="snapAngle" type="range" min="5" max="180" step="5"><output id="snapAngleValue"></output></label>
            <label class="settings-row compact"><span><b>Prioritize pin → hole</b><small>Prefer detected beam holes when several compatible snap points are nearby.</small></span><input id="snapPinHolePriority" type="checkbox"></label>
          </div>
        </section>
        <section class="settings-section"><div class="settings-section-title">Keybinds</div><div id="keybindGrid" class="keybind-grid"></div><small class="settings-note">Click a binding, then press the new key. Roblox mode uses movement bindings while the viewport is active.</small></section>
        <section class="settings-section"><div class="settings-section-title">Rendering</div>
          <label class="settings-row"><span><b>Material look</b><small>Studio Plastic adds clear-coat highlights without texture maps.</small></span><select id="materialStyle"><option value="studio">Studio Plastic</option><option value="matte">Matte CAD</option><option value="glossy">Glossy</option></select></label>
          <label class="settings-row"><span><b>Exposure</b><small>Overall scene brightness.</small></span><input id="exposure" type="range" min="0.55" max="1.8" step="0.05"><output id="exposureValue"></output></label>
          <label class="settings-row"><span><b>Soft shadows</b><small>Auto disables shadows in Low mode.</small></span><select id="shadowMode"><option value="auto">Auto</option><option value="on">Always on</option><option value="off">Off</option></select></label>
          <label class="settings-row compact"><span><b>Show grid</b></span><input id="showGrid" type="checkbox"></label>
          <label class="settings-row compact"><span><b>Show axes</b></span><input id="showAxes" type="checkbox"></label>
          <label class="settings-row"><span><b>GPU quality</b><small>Controls pixel ratio, antialiasing and shadow resolution.</small></span><select id="settingsQuality"><option value="low">Low</option><option value="balanced">Balanced</option><option value="high">High</option></select></label>
        </section>
      </div>
      <div class="settings-actions"><button id="resetSettingsBtn">Reset defaults</button><span class="grow"></span><button id="doneSettingsBtn" class="primary">Done</button></div>
    </div>`;
  document.body.appendChild(panel);
  btn.onclick=openSettings;$('closeSettingsBtn').onclick=closeSettings;$('doneSettingsBtn').onclick=closeSettings;$('settingsPanel').addEventListener('pointerdown',e=>{if(e.target===$('settingsPanel'))closeSettings();});
  $('resetSettingsBtn').onclick=()=>{hardStopRobloxMotion();settings=normalizeSettings(structuredClone(DEFAULT_SETTINGS));saveSettings(settings);syncUI();applySettings();};
  $('controlPreset').onchange=e=>{hardStopRobloxMotion();update({controlsPreset:e.target.value});};$('materialStyle').onchange=e=>update({materialStyle:e.target.value});$('shadowMode').onchange=e=>update({shadowMode:e.target.value});$('showGrid').onchange=e=>update({showGrid:e.target.checked});$('showAxes').onchange=e=>update({showAxes:e.target.checked});$('invertY').onchange=e=>update({invertY:e.target.checked});
  $('proximitySnap').onchange=e=>update({proximitySnap:e.target.checked});$('snapPinHolePriority').onchange=e=>update({snapPinHolePriority:e.target.checked});
  for(const id of ['lookSensitivity','moveSpeed','panSensitivity','exposure','snapDistance','snapAngle'])$(id).oninput=e=>update({[id]:Number(e.target.value)});
  $('settingsQuality').onchange=e=>{const q=$('quality');if(q){q.value=e.target.value;q.dispatchEvent(new Event('change',{bubbles:true}));}$('settingsQuality').value=e.target.value;};
  renderKeybinds();syncUI();publishSettings();
}
function renderKeybinds(){const grid=$('keybindGrid');if(!grid)return;grid.innerHTML=Object.keys(DEFAULT_SETTINGS.bindings).map(action=>`<div class="keybind-row"><span>${labels[action]||action}</span><button class="bind-button" data-bind="${action}">${prettyKey(settings.bindings[action])}</button></div>`).join('');for(const b of grid.querySelectorAll('[data-bind]'))b.onclick=()=>{hardStopRobloxMotion();recordingBinding=b.dataset.bind;b.textContent='Press a key…';b.classList.add('recording');};}
function syncUI(){if(!$('settingsPanel'))return;$('controlPreset').value=settings.controlsPreset;$('materialStyle').value=settings.materialStyle;$('shadowMode').value=settings.shadowMode;$('showGrid').checked=settings.showGrid;$('showAxes').checked=settings.showAxes;$('invertY').checked=settings.invertY;$('proximitySnap').checked=settings.proximitySnap;$('snapPinHolePriority').checked=settings.snapPinHolePriority;for(const id of ['lookSensitivity','moveSpeed','panSensitivity','exposure','snapDistance','snapAngle']){$(id).value=settings[id];$(`${id}Value`).textContent=id==='moveSpeed'?`${settings[id]} mm/s`:id==='snapDistance'?`${settings[id]} mm`:id==='snapAngle'?`${settings[id]}°`:Number(settings[id]).toFixed(id==='panSensitivity'?1:2);}$('robloxControls').classList.toggle('disabled',settings.controlsPreset!=='roblox');$('snapControls').classList.toggle('disabled',!settings.proximitySnap);$('settingsQuality').value=$('quality')?.value||'balanced';renderKeybinds();updateFooter();}
function update(patch){settings=saveSettings({...settings,...patch,bindings:{...settings.bindings,...(patch.bindings||{})}});syncUI();applySettings();publishSettings();}
function applySettings(){if(renderer){renderer.applyVisualSettings(settings);renderer.setCameraSettings(settings);renderer.setNavigationPreset(settings.controlsPreset);}publishSettings();updateFooter();}
function updateFooter(){const footer=document.querySelector('footer span:last-child');if(!footer)return;footer.textContent=settings.controlsPreset==='roblox'?`${prettyKey(settings.bindings.cycleTransform)} cycle tool · RMB look · WASD fly · MMB pan · LMB drag select`:'Shift+drag box select · Esc cancel · Delete remove · M/R transform';}
function openSettings(){hardStopRobloxMotion();$('settingsPanel').classList.add('open');$('settingsPanel').setAttribute('aria-hidden','false');syncUI();}
function closeSettings(){hardStopRobloxMotion();recordingBinding=null;const panel=$('settingsPanel');if(panel?.contains(document.activeElement))document.activeElement?.blur?.();panel?.classList.remove('open');panel?.setAttribute('aria-hidden','true');renderKeybinds();}

function clonePointer(type,e,overrides={}){return new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:e.isPrimary,clientX:overrides.clientX??e.clientX,clientY:overrides.clientY??e.clientY,screenX:e.screenX,screenY:e.screenY,button:overrides.button??e.button,buttons:overrides.buttons??e.buttons,shiftKey:overrides.shiftKey??e.shiftKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,pressure:e.pressure});}
function bindRobloxInput(){
  const canvas=renderer.renderer.domElement;
  canvas.addEventListener('contextmenu',e=>{if(settings.controlsPreset==='roblox')e.preventDefault();});
  canvas.addEventListener('pointerdown',e=>{
    if(synthetic||settings.controlsPreset!=='roblox')return;
    if(e.button===1||e.button===2){if(renderer.beginRobloxPointer(e)){e.preventDefault();e.stopImmediatePropagation();try{canvas.setPointerCapture(e.pointerId);}catch{}}return;}
    if(e.button===0&&!placementActive()&&!renderer.isTransformHandleActive())leftStart={x:e.clientX,y:e.clientY,pointerId:e.pointerId,event:e};else leftStart=null;
  },true);
  canvas.addEventListener('pointermove',e=>{
    if(synthetic||settings.controlsPreset!=='roblox')return;
    if(renderer.navPointer){e.preventDefault();e.stopImmediatePropagation();renderer.moveRobloxPointer(e);return;}
    if(leftStart&&!robloxBox&&(e.buttons&1)&&Math.hypot(e.clientX-leftStart.x,e.clientY-leftStart.y)>5&&!placementActive()){
      synthetic=true;try{canvas.dispatchEvent(clonePointer('pointercancel',leftStart.event,{buttons:0}));canvas.dispatchEvent(clonePointer('pointerdown',leftStart.event,{shiftKey:true,button:0,buttons:1,clientX:leftStart.x,clientY:leftStart.y}));robloxBox=true;}finally{synthetic=false;}
    }
  },true);
  canvas.addEventListener('pointerup',e=>{if(synthetic||settings.controlsPreset!=='roblox')return;if(renderer.navPointer&&renderer.endRobloxPointer(e)){e.preventDefault();e.stopImmediatePropagation();try{if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}return;}if(e.button===0){const wasBox=robloxBox;leftStart=null;robloxBox=false;if(wasBox)queueMicrotask(()=>renderer.setNavigationPreset('roblox'));}},true);
  canvas.addEventListener('pointercancel',()=>{const wasBox=robloxBox;leftStart=null;robloxBox=false;renderer.navPointer=null;if(wasBox)queueMicrotask(()=>renderer.setNavigationPreset('roblox'));},true);
  canvas.addEventListener('wheel',e=>{if(settings.controlsPreset==='roblox'&&renderer.robloxZoom(e.deltaY)){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});

  window.addEventListener('keydown',e=>{
    if(recordingBinding){hardStopRobloxMotion();e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape'){recordingBinding=null;renderKeybinds();return;}const key=eventKey(e);update({bindings:{[recordingBinding]:key}});recordingBinding=null;renderKeybinds();return;}
    if(settings.controlsPreset!=='roblox')return;
    if(modalOpen()||typing()){hardStopRobloxMotion();return;}
    // Editor shortcuts such as Ctrl/Cmd+A/D/G must not be consumed as WASD.
    // Starting any modifier chord also releases existing fly motion so a
    // shortcut can never leave Roblox navigation latched.
    if(e.ctrlKey||e.metaKey||e.altKey){hardStopRobloxMotion();return;}
    if(e.key==='Shift'){renderer.setRobloxKey('fast',true);return;}
    const movement=movementActions.find(a=>keyMatches(e,settings.bindings[a]));if(movement){if((movement==='up'||movement==='down')&&placementActive())return;e.preventDefault();e.stopImmediatePropagation();renderer.setRobloxKey(movement,true);return;}
    if(e.repeat)return;
    const action=['cycleTransform','moveTool','rotateTool','fit','delete'].find(a=>keyMatches(e,settings.bindings[a]));if(!action)return;
    if(action==='cycleTransform'&&placementActive())return;e.preventDefault();e.stopImmediatePropagation();
    if(action==='cycleTransform')($('moveBtn')?.classList.contains('active')?$('rotateBtn'):$('moveBtn'))?.click();
    else if(action==='moveTool')$('moveBtn')?.click();else if(action==='rotateTool')$('rotateBtn')?.click();else if(action==='fit')$('fitBtn')?.click();
    else if(action==='delete'){synthetic=true;try{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));}finally{synthetic=false;}}
  },true);
  window.addEventListener('keyup',e=>{if(settings.controlsPreset!=='roblox')return;if(e.key==='Shift'){renderer.setRobloxKey('fast',false);return;}const movement=movementActions.find(a=>keyMatches(e,settings.bindings[a]));if(movement)renderer.setRobloxKey(movement,false);},true);

  document.addEventListener('pointerdown',e=>{if(settings.controlsPreset==='roblox'&&!canvas.contains(e.target))hardStopRobloxMotion();},true);
  document.addEventListener('focusin',e=>{if(settings.controlsPreset==='roblox'&&!canvas.contains(e.target))hardStopRobloxMotion();},true);
  window.addEventListener('blur',hardStopRobloxMotion);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hardStopRobloxMotion();});
  let modalWasOpen=false;
  const observer=new MutationObserver(()=>{
    const open=modalOpen();
    if(settings.controlsPreset==='roblox'&&open&&!modalWasOpen)hardStopRobloxMotion();
    modalWasOpen=open;
  });
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','aria-hidden']});
}

async function start(){injectUI();for(let i=0;i<120&&!globalThis.__vexRenderer;i++)await new Promise(r=>setTimeout(r,50));renderer=globalThis.__vexRenderer;if(!renderer){console.warn('Settings module could not find renderer');return;}bindRobloxInput();applySettings();$('quality')?.addEventListener('change',()=>{$('settingsQuality').value=$('quality').value;renderer.applyVisualSettings(settings);});}
start().catch(console.error);
