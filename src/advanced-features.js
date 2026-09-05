import * as THREE from 'three';
import { SceneRenderer } from './render/sceneRenderer.js';
import { geometryFromProjectData } from './render/meshLoader.js';
import { detectGears, gearKinematics, driveMetrics, simulationSummary } from './simulation-core.js';
import { createTutorial, appendStep, encodeTutorial, decodeTutorial, validateTutorial } from './tutorial-core.js';

const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api=null,tutorial=null,tutorialViewer=null,simulationViewer=null,simFrame=0,viewerStep=0,viewerArrowRefresh=null;

function hardStop(){globalThis.__vexStopMotion?.();}
function currentProject(){const p=api?.getProject?.();if(!p)throw new Error('The CAD project is not ready yet');return p;}
function customGeometryMap(project){const map=new Map();for(const e of project.entities||[])if(e.custom?.geometry&&!map.has(e.partId))try{map.set(e.partId,geometryFromProjectData(e.custom.geometry));}catch{}return map;}
function entityMap(project){return new Map((project.entities||[]).map(e=>[e.id,structuredClone(e)]));}
function getPartName(e){return api?.getPart?.(e?.partId)?.name||e?.name||'Part';}

function injectButtons(){
  const tools=document.querySelector('.tools');if(!tools||$('simulationBtn'))return;
  const sep=document.createElement('span');sep.className='sep advanced-sep';
  const snapshot=document.createElement('button');snapshot.id='snapshotBtn';snapshot.className='snapshot-button';snapshot.textContent='Snapshot';snapshot.title='Capture the current build as the next local tutorial step';
  const tutorialBtn=document.createElement('button');tutorialBtn.id='tutorialBtn';tutorialBtn.textContent='Tutorial';tutorialBtn.title='Create, save, load and preview local build instructions';
  const sim=document.createElement('button');sim.id='simulationBtn';sim.textContent='Simulation';sim.title='Gear train and drive/weight simulation';
  tools.append(sep,snapshot,tutorialBtn,sim);snapshot.onclick=captureStep;tutorialBtn.onclick=openTutorialBuilder;sim.onclick=openSimulation;
}

function injectPanels(){
  if($('simulationPanel'))return;
  const host=document.createElement('div');host.innerHTML=`
<section id="simulationPanel" class="simulation-panel" aria-hidden="true">
  <div class="simulation-shell">
    <header class="advanced-head"><div><b>Simulation Lab</b><small>Local engineering estimates + animated gear-train preview</small></div><button id="closeSimulationBtn" aria-label="Close simulation">×</button></header>
    <div class="simulation-layout">
      <aside class="sim-controls">
        <div class="advanced-section-title">Powertrain</div>
        <label>Input RPM<input id="simRpm" type="number" min="1" max="1000" value="100"></label>
        <label>Motor count<input id="simMotors" type="number" min="1" max="16" value="2"></label>
        <label>Torque / motor (N·m)<input id="simTorque" type="number" min="0" max="5" step="0.01" value="0.20"></label>
        <label>Drivetrain efficiency<input id="simEfficiency" type="number" min="0.05" max="1" step="0.01" value="0.82"></label>
        <div class="advanced-section-title">Robot / environment</div>
        <label>Total mass (kg)<input id="simMass" type="number" min="0.1" max="100" step="0.1" value="4"></label>
        <label>Wheel diameter (mm)<input id="simWheel" type="number" min="20" max="400" value="100"></label>
        <label>Driven wheels<input id="simWheelCount" type="number" min="1" max="16" value="4"></label>
        <label>Incline (degrees)<input id="simIncline" type="number" min="-45" max="45" step="1" value="0"></label>
        <label>Surface<select id="simSurface"><option value="0.55">Smooth tile</option><option value="0.75" selected>Competition field</option><option value="0.95">Rubber mat</option><option value="1.20">High-grip surface</option></select></label>
        <label class="inline-check"><input id="simAnimate" type="checkbox" checked> Animate detected gears</label>
        <button id="refreshSimulationBtn" class="primary">Recalculate from current build</button>
      </aside>
      <main class="sim-main"><div id="simulationViewport" class="simulation-viewport"></div><div id="gearStrip" class="gear-strip"></div></main>
      <aside id="simulationMetrics" class="sim-metrics"></aside>
    </div>
    <footer class="advanced-foot">Estimates are schematic design aids, not a replacement for physical testing. Gear order is inferred by nearest detected gear centers; select a gear before opening to make it the input gear.</footer>
  </div>
</section>
<section id="tutorialPanel" class="tutorial-panel" aria-hidden="true">
  <div class="tutorial-builder-card">
    <header class="advanced-head"><div><b>Tutorial Builder</b><small>Snapshots stay local unless you export a .vxtutorial file.</small></div><button id="closeTutorialBtn" aria-label="Close tutorial builder">×</button></header>
    <div class="tutorial-builder-body">
      <div class="tutorial-builder-actions"><button id="builderSnapshotBtn" class="primary">Capture snapshot</button><button id="previewTutorialBtn">Preview instructions</button><button id="saveTutorialBtn">Save .vxtutorial</button><button id="loadTutorialBtn">Load tutorial</button><input id="tutorialFile" type="file" accept=".vxtutorial,application/octet-stream" hidden></div>
      <label class="tutorial-name">Tutorial name<input id="tutorialName" maxlength="120" placeholder="My VEX IQ build"></label>
      <div id="tutorialSteps" class="tutorial-step-list"></div>
      <div class="tutorial-local-note">Local-only by design: tutorial snapshots and files are never sent to Supabase or any server.</div>
    </div>
  </div>
</section>
<section id="tutorialViewer" class="tutorial-viewer" aria-hidden="true">
  <div class="instruction-shell">
    <header class="instruction-top"><button id="exitTutorialViewer" class="instruction-icon">←</button><div><strong id="instructionTitle">BUILD INSTRUCTIONS</strong><small id="instructionSubtitle">Custom VEX CAD tutorial</small></div><span id="instructionProgress">1 / 1</span></header>
    <div class="instruction-body"><aside id="instructionRail" class="instruction-rail"></aside><main class="instruction-stage"><div id="instructionViewport" class="instruction-viewport"></div><svg id="instructionArrows" class="instruction-arrows" aria-hidden="true"></svg><div id="instructionCallout" class="instruction-callout"></div></main><aside id="instructionChanges" class="instruction-changes"></aside></div>
    <footer class="instruction-bottom"><button id="tutorialPrev">Previous</button><div class="instruction-hint">Drag to orbit · wheel to zoom · arrows show additions and movement</div><button id="tutorialNext" class="primary">Next</button></footer>
  </div>
</section>`;
  while(host.firstElementChild)document.body.appendChild(host.firstElementChild);
  $('closeSimulationBtn').onclick=closeSimulation;$('refreshSimulationBtn').onclick=refreshSimulation;$('simAnimate').onchange=()=>$('simAnimate').checked?startGearAnimation():stopGearAnimation();
  for(const id of ['simRpm','simMotors','simTorque','simEfficiency','simMass','simWheel','simWheelCount','simIncline','simSurface'])$(id).addEventListener('input',refreshSimulationMetrics);
  $('closeTutorialBtn').onclick=closeTutorialBuilder;$('builderSnapshotBtn').onclick=captureStep;$('previewTutorialBtn').onclick=()=>openTutorialViewer(0);$('saveTutorialBtn').onclick=saveTutorial;$('loadTutorialBtn').onclick=()=>$('tutorialFile').click();$('tutorialFile').onchange=loadTutorialFile;$('tutorialName').oninput=e=>{if(tutorial)tutorial.name=e.target.value||'Custom Build';};
  $('exitTutorialViewer').onclick=closeTutorialViewer;$('tutorialPrev').onclick=()=>showTutorialStep(viewerStep-1);$('tutorialNext').onclick=()=>showTutorialStep(viewerStep+1);
  for(const p of [$('simulationPanel'),$('tutorialPanel')])p.addEventListener('pointerdown',e=>{if(e.target===p)p=== $('simulationPanel')?closeSimulation():closeTutorialBuilder();});
}

async function makeViewer(container){
  const main=api.getRenderer(),viewer=new SceneRenderer(container,api.getLibrary(),{quality:main?.quality||'balanced'});globalThis.__vexRenderer=main;
  viewer.applyVisualSettings({...globalThis.__vexFeatureSettings,shadowMode:'off',showAxes:false});viewer.setNavigationPreset('standard');return viewer;
}

function simulationInputs(){return {inputRpm:Number($('simRpm').value),motorCount:Number($('simMotors').value),motorTorqueNm:Number($('simTorque').value),efficiency:Number($('simEfficiency').value),massKg:Number($('simMass').value),wheelDiameterMm:Number($('simWheel').value),wheelCount:Number($('simWheelCount').value),inclineDeg:Number($('simIncline').value),tractionCoefficient:Number($('simSurface').value)};}
function detectedGears(){return detectGears(currentProject(),id=>api.getPart(id),api.getSelection());}
function refreshSimulationMetrics(){
  if(!$('simulationPanel')?.classList.contains('open'))return;const gears=detectedGears(),metrics=driveMetrics({...simulationInputs(),gears}),s=simulationSummary(metrics);
  $('gearStrip').innerHTML=gears.length?gears.map((g,i)=>`<div class="gear-chip"><b>${g.teeth}T</b><span>${esc(g.name)}</span><small>${i===0?'input':i===gears.length-1?'output':`gear ${i+1}`}</small></div>`).join('<span class="gear-arrow">→</span>'):'<div class="sim-empty">No tooth-count gear names detected. Drive calculations use a 1:1 ratio until gears are present.</div>';
  $('simulationMetrics').innerHTML=`<div class="metric-hero"><span>Gear ratio</span><b>${s.ratioText}</b></div><div class="metric-grid"><div><span>Output</span><b>${s.rpmText}</b></div><div><span>Theoretical speed</span><b>${s.speedText}</b></div><div><span>Usable traction</span><b>${s.forceText}</b></div><div><span>Traction ceiling</span><b>${s.tractionText}</b></div><div><span>Acceleration estimate</span><b>${s.accelText}</b></div><div><span>Static load</span><b>${s.loadText}</b></div></div><div class="sim-note">Incline load: ${metrics.gradeForceN.toFixed(1)} N · motor-limited force: ${metrics.motorForceN.toFixed(1)} N</div>`;
}
async function refreshSimulation(){
  hardStop();refreshSimulationMetrics();const p=currentProject();if(!simulationViewer)simulationViewer=await makeViewer($('simulationViewport'));await simulationViewer.sync(entityMap(p),customGeometryMap(p));simulationViewer.fit([],entityMap(p));if($('simAnimate').checked)startGearAnimation();
}
async function openSimulation(){hardStop();$('simulationPanel').classList.add('open');$('simulationPanel').setAttribute('aria-hidden','false');await refreshSimulation();}
function closeSimulation(){hardStop();stopGearAnimation();$('simulationPanel').classList.remove('open');$('simulationPanel').setAttribute('aria-hidden','true');}
function stopGearAnimation(){if(simFrame)cancelAnimationFrame(simFrame);simFrame=0;}
function startGearAnimation(){
  stopGearAnimation();if(!simulationViewer||!$('simulationPanel').classList.contains('open')||!$('simAnimate').checked)return;const project=currentProject(),base=entityMap(project),custom=customGeometryMap(project),gears=gearKinematics(detectedGears(),Number($('simRpm').value)),gearById=new Map(gears.map(g=>[g.id,g])),start=performance.now();
  const frame=now=>{if(!$('simulationPanel').classList.contains('open')||!$('simAnimate').checked)return;const elapsed=(now-start)/1000,map=new Map();for(const [id,e0] of base){const e=structuredClone(e0),g=gearById.get(id);if(g){const def=api.getPart(e.partId),axis=def?.attachments?.find(a=>['socket','shaft','hole'].includes(a.type))?.axis||[0,0,1],angle=(g.rpm*2*Math.PI/60)*elapsed*.35,rot=new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...axis).normalize(),angle);e.matrix=new THREE.Matrix4().fromArray(e0.matrix).multiply(rot).toArray();}map.set(id,e);}simulationViewer.sync(map,custom).catch(()=>{});simFrame=requestAnimationFrame(frame);};simFrame=requestAnimationFrame(frame);
}

function ensureTutorial(){if(!tutorial)tutorial=createTutorial(currentProject().name||'Custom Build');return tutorial;}
function captureStep(){
  try{hardStop();const t=ensureTutorial();if($('tutorialName')?.value)t.name=$('tutorialName').value;const step=appendStep(t,currentProject());renderTutorialBuilder();api.setStatus?.(`Tutorial snapshot ${step.number} captured locally.`);const b=$('snapshotBtn');if(b)b.textContent=`Snapshot · ${t.steps.length}`;}
  catch(err){api?.setStatus?.(`Snapshot failed: ${err.message}`,'error');}
}
function renderTutorialBuilder(){
  if(!tutorial){$('tutorialSteps').innerHTML='<div class="tutorial-empty">No steps yet. Build something, then press Snapshot.</div>';return;}$('tutorialName').value=tutorial.name||'';$('tutorialSteps').innerHTML=tutorial.steps.map(s=>{const c=s.changes||{},summary=[c.added?.length?`+${c.added.length} added`:'',c.moved?.length?`${c.moved.length} moved`:'',c.removed?.length?`${c.removed.length} removed`:''].filter(Boolean).join(' · ')||'Initial state';return `<div class="tutorial-step-row"><span class="step-number">${s.number}</span><div><b>${esc(s.title)}</b><small>${summary}</small></div><button data-preview-step="${s.number-1}">Preview</button></div>`;}).join('')||'<div class="tutorial-empty">No steps yet.</div>';for(const b of $('tutorialSteps').querySelectorAll('[data-preview-step]'))b.onclick=()=>openTutorialViewer(Number(b.dataset.previewStep));$('previewTutorialBtn').disabled=!tutorial.steps.length;$('saveTutorialBtn').disabled=!tutorial.steps.length;}
function openTutorialBuilder(){hardStop();injectPanels();$('tutorialPanel').classList.add('open');$('tutorialPanel').setAttribute('aria-hidden','false');if(!tutorial)tutorial=createTutorial(currentProject().name||'Custom Build');renderTutorialBuilder();}
function closeTutorialBuilder(){hardStop();$('tutorialPanel').classList.remove('open');$('tutorialPanel').setAttribute('aria-hidden','true');}
async function saveTutorial(){
  try{if(!tutorial?.steps.length)return;const bytes=await encodeTutorial(tutorial),blob=new Blob([bytes],{type:'application/octet-stream'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(tutorial.name||'vex-build').replace(/[^a-z0-9_-]+/gi,'-')}.vxtutorial`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);api.setStatus?.('Tutorial saved locally as .vxtutorial.');}
  catch(err){api.setStatus?.(`Tutorial save failed: ${err.message}`,'error');}
}
async function loadTutorialFile(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;try{tutorial=await decodeTutorial(file);renderTutorialBuilder();$('snapshotBtn').textContent=`Snapshot · ${tutorial.steps.length}`;api.setStatus?.(`Loaded local tutorial: ${tutorial.name}`);}catch(err){api.setStatus?.(`Tutorial load failed: ${err.message}`,'error');}}

function interpolateMatrix(a,b,t){
  const am=new THREE.Matrix4().fromArray(a),bm=new THREE.Matrix4().fromArray(b),ap=new THREE.Vector3(),bp=new THREE.Vector3(),aq=new THREE.Quaternion(),bq=new THREE.Quaternion(),as=new THREE.Vector3(),bs=new THREE.Vector3();am.decompose(ap,aq,as);bm.decompose(bp,bq,bs);ap.lerp(bp,t);aq.slerp(bq,t);as.lerp(bs,t);return new THREE.Matrix4().compose(ap,aq,as).toArray();
}
function transitionMaps(previous,current,t){
  const before=new Map((previous?.entities||[]).map(e=>[e.id,e])),after=new Map((current?.entities||[]).map(e=>[e.id,e])),out=new Map();
  for(const [id,next] of after){const old=before.get(id);if(old){const e=structuredClone(next);e.matrix=interpolateMatrix(old.matrix,next.matrix,t);out.set(id,e);}else{const e=structuredClone(next),start=[...next.matrix];start[14]+=42;const sm=new THREE.Matrix4().fromArray(start),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();sm.decompose(p,q,s);s.multiplyScalar(.18);const startScaled=new THREE.Matrix4().compose(p,q,s).toArray();e.matrix=interpolateMatrix(startScaled,next.matrix,t);out.set(id,e);}}
  if(t<1)for(const [id,old] of before)if(!after.has(id)){const e=structuredClone(old),end=[...old.matrix];end[14]+=42;const em=new THREE.Matrix4().fromArray(end),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();em.decompose(p,q,s);s.multiplyScalar(.08);e.matrix=interpolateMatrix(old.matrix,new THREE.Matrix4().compose(p,q,s).toArray(),t);out.set(id,e);}
  return out;
}
function projectPoint(point){const v=new THREE.Vector3(...point).project(tutorialViewer.camera),box=$('instructionViewport').getBoundingClientRect();return {x:(v.x+1)*.5*box.width,y:(1-v.y)*.5*box.height};}
function drawStepArrows(step){
  const svg=$('instructionArrows'),box=$('instructionViewport').getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${Math.max(1,box.width)} ${Math.max(1,box.height)}`);const arrows=(step?.changes?.arrows||[]).slice(0,12);svg.innerHTML='<defs><marker id="vexArrowHead" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0,9 3.5,0 7" fill="#d71920"/></marker></defs>'+arrows.map(a=>{const f=projectPoint(a.from),t=projectPoint(a.to);return `<line x1="${f.x}" y1="${f.y}" x2="${t.x}" y2="${t.y}" class="instruction-arrow ${a.kind}" marker-end="url(#vexArrowHead)"/>`;}).join('');
}
async function openTutorialViewer(index=0){
  hardStop();if(!tutorial?.steps.length){api.setStatus?.('Capture at least one tutorial snapshot first.','warn');return;}validateTutorial(tutorial);closeTutorialBuilder();$('tutorialViewer').classList.add('open');$('tutorialViewer').setAttribute('aria-hidden','false');if(!tutorialViewer){tutorialViewer=await makeViewer($('instructionViewport'));viewerArrowRefresh=()=>drawStepArrows(tutorial?.steps?.[viewerStep]);tutorialViewer.orbit.addEventListener('change',viewerArrowRefresh);}await showTutorialStep(index,true);
}
function closeTutorialViewer(){hardStop();$('tutorialViewer').classList.remove('open');$('tutorialViewer').setAttribute('aria-hidden','true');}
async function showTutorialStep(index,initial=false){
  if(!tutorialViewer||!tutorial?.steps.length)return;index=Math.max(0,Math.min(tutorial.steps.length-1,index));const step=tutorial.steps[index],prev=index? tutorial.steps[index-1].snapshot:{entities:[],constraints:[]},target=step.snapshot,custom=customGeometryMap(target);viewerStep=index;$('instructionTitle').textContent=tutorial.name||'BUILD INSTRUCTIONS';$('instructionSubtitle').textContent=step.title||`Step ${index+1}`;$('instructionProgress').textContent=`${index+1} / ${tutorial.steps.length}`;$('tutorialPrev').disabled=index===0;$('tutorialNext').disabled=index===tutorial.steps.length-1;
  $('instructionRail').innerHTML=tutorial.steps.map((s,i)=>`<button class="instruction-step ${i===index?'active':''}" data-step="${i}"><span>${i+1}</span><small>${esc(s.title)}</small></button>`).join('');for(const b of $('instructionRail').querySelectorAll('[data-step]'))b.onclick=()=>showTutorialStep(Number(b.dataset.step));
  const added=(step.changes?.added||[]).map(id=>target.entities.find(e=>e.id===id)).filter(Boolean),moved=(step.changes?.moved||[]).map(id=>target.entities.find(e=>e.id===id)).filter(Boolean);$('instructionChanges').innerHTML=`<b>Step ${index+1}</b><p>${added.length?`Add ${added.length} part${added.length===1?'':'s'}.`:index===0?'Starting assembly.':''} ${moved.length?`Reposition ${moved.length}.`:''}</p>${added.slice(0,8).map(e=>`<div class="instruction-part"><span class="part-swatch"></span><div><b>${esc(getPartName(e))}</b><small>${esc(api.getPart(e.partId)?.partNumber||'')}</small></div></div>`).join('')}`;$('instructionCallout').textContent=added.length?`Add ${added.length} highlighted part${added.length===1?'':'s'}`:moved.length?`Move ${moved.length} part${moved.length===1?'':'s'}`:'Inspect this assembly state';
  if(initial){await tutorialViewer.sync(entityMap(prev),customGeometryMap(prev));tutorialViewer.fit([],entityMap(target));}
  const duration=560,frames=18;for(let i=0;i<=frames;i++){const t=i/frames,eased=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;await tutorialViewer.sync(transitionMaps(prev,target,eased),custom);if(i<frames)await sleep(duration/frames);}await tutorialViewer.sync(entityMap(target),custom);tutorialViewer.fit([],entityMap(target));requestAnimationFrame(()=>drawStepArrows(step));
}

async function start(){
  injectPanels();injectButtons();for(let i=0;i<160&&!globalThis.__vexAppAPI;i++)await sleep(50);api=globalThis.__vexAppAPI;if(!api){console.warn('Advanced features could not find VEX CAD runtime');return;}if(!tutorial)tutorial=createTutorial(currentProject().name||'Custom Build');renderTutorialBuilder();
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('tutorialViewer')?.classList.contains('open'))closeTutorialViewer();else if($('tutorialPanel')?.classList.contains('open'))closeTutorialBuilder();else if($('simulationPanel')?.classList.contains('open'))closeSimulation();}});
}
start().catch(err=>console.error('Advanced feature startup failed',err));
