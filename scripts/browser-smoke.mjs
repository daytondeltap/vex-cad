import { chromium } from 'playwright-core';

const base=process.env.VEX_SMOKE_URL||'http://127.0.0.1:4173/vex-cad/';
const executablePath=process.env.CHROME_PATH||'/usr/bin/google-chrome';
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],badResponses=[],failedRequests=[];
page.setDefaultTimeout(12000);
page.on('pageerror',err=>errors.push(`pageerror: ${err.message}`));
page.on('console',msg=>{if(['error','warning'].includes(msg.type()))errors.push(`${msg.type()}: ${msg.text()}`);});
page.on('requestfailed',req=>failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`));
page.on('response',res=>{if(res.status()>=400)badResponses.push(`${res.status()} ${res.url()}`);});
async function snapshot(){return page.evaluate(()=>({url:location.href,title:document.title,booted:window.__vexBooted,bootError:window.__vexBootError||'',status:document.querySelector('#status')?.textContent||'',meta:document.querySelector('#libraryMeta')?.textContent||'',perf:document.querySelector('#perf')?.textContent||'',canvasCount:document.querySelectorAll('#viewport canvas').length,partRows:document.querySelectorAll('.part-row').length,settings:!!document.querySelector('#settingsBtn'),simulation:!!document.querySelector('#simulationBtn'),snapshotButton:!!document.querySelector('#snapshotBtn'),body:(document.body?.innerText||'').slice(0,900)}));}
const moved=(a,b,eps=.01)=>a.some((v,i)=>Math.abs(v-b[i])>eps);
const setControl=async(selector,value,event='change')=>page.evaluate(({selector,value,event})=>{const el=document.querySelector(selector);if(!el)throw new Error(`Missing control ${selector}`);if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);el.dispatchEvent(new Event(event,{bubbles:true}));},{selector,value,event});
const clickDom=async selector=>page.evaluate(selector=>{const el=document.querySelector(selector);if(!el)throw new Error(`Missing button ${selector}`);el.click();},selector);
const checkpoint=label=>console.log(`smoke-checkpoint ${label}`);
try{
  const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
  if(!response?.ok())throw new Error(`page HTTP ${response?.status()}`);
  await page.waitForTimeout(1500);
  console.log('boot-snapshot-1',JSON.stringify(await snapshot()));
  await page.waitForFunction(()=>{
    const text=document.querySelector('#libraryMeta')?.textContent||'';
    return /VEX IQ models/.test(text)||/Library failed|Graphics failed|Startup failed/i.test(text);
  },null,{timeout:30000});
  const meta=await page.locator('#libraryMeta').innerText();
  if(!/VEX IQ models/.test(meta))throw new Error(`library did not load: ${meta}`);
  const manifest=await page.evaluate(async()=>{const r=await fetch('./parts/manifest.json',{cache:'no-store'});return r.json();});
  if(manifest.meshCompression!=='gzip')throw new Error(`expected gzip mesh manifest, got ${manifest.meshCompression||'none'}`);
  if(!manifest.parts?.[0]?.mesh?.endsWith('.gz'))throw new Error('manifest does not point at compressed per-part meshes');

  const canvas=page.locator('#viewport canvas');await canvas.waitFor({state:'visible',timeout:10000});
  const graphics=await page.evaluate(()=>{const r=window.__vexRenderer?.renderer,c=r?.domElement,gl=r?.getContext?.();return {width:c?.width||0,height:c?.height||0,hasRenderer:!!r,hasContext:!!gl,contextLost:gl?.isContextLost?.()??true};});
  if(graphics.width<10||graphics.height<10||!graphics.hasRenderer||!graphics.hasContext||graphics.contextLost)throw new Error(`invalid graphics canvas ${JSON.stringify(graphics)}`);
  checkpoint('graphics-ok');

  const settingsBtn=page.locator('#settingsBtn');await settingsBtn.waitFor({state:'visible',timeout:10000});await settingsBtn.click();
  await page.waitForFunction(()=>document.querySelector('#settingsPanel')?.classList.contains('open'),null,{timeout:5000});
  const panelState=await page.evaluate(()=>{const el=document.querySelector('#settingsPanel'),r=el.getBoundingClientRect(),s=getComputedStyle(el);return {className:el.className,aria:el.getAttribute('aria-hidden'),display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height};});
  console.log('settings-panel-state',JSON.stringify(panelState));
  if(!/\bopen\b/.test(panelState.className)||panelState.display==='none'||panelState.visibility==='hidden'||panelState.width<200||panelState.height<200)throw new Error(`settings panel did not open visibly: ${JSON.stringify(panelState)}`);
  await setControl('#controlPreset','roblox');await setControl('#materialStyle','glossy');
  const proximityDefault=await page.evaluate(()=>document.querySelector('#proximitySnap')?.checked===true);if(!proximityDefault)throw new Error('proximity snapping should default on');
  await setControl('#snapDistance',32,'input');await setControl('#snapAngle',120,'input');
  await page.waitForFunction(()=>window.__vexRenderer?.navigationPreset==='roblox'&&window.__vexRenderer?.visualSettings?.materialStyle==='glossy'&&window.__vexFeatureSettings?.snapDistance===32&&window.__vexFeatureSettings?.snapAngle===120,null,{timeout:5000});
  await clickDom('#doneSettingsBtn');
  await page.waitForFunction(()=>!document.querySelector('#settingsPanel')?.classList.contains('open'),null,{timeout:5000});
  checkpoint('settings-ok');

  const cameraBefore=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());await page.keyboard.down('w');await page.waitForTimeout(170);
  const cameraMoving=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());if(!moved(cameraBefore,cameraMoving))throw new Error('Roblox WASD navigation did not move camera');
  await settingsBtn.click();await page.waitForTimeout(260);
  const cameraStopped1=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());await page.waitForTimeout(320);const cameraStopped2=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());
  if(moved(cameraStopped1,cameraStopped2,.025))throw new Error(`Roblox movement stayed latched after opening menu: ${JSON.stringify({cameraStopped1,cameraStopped2})}`);
  const navState=await page.evaluate(()=>({keys:[...(window.__vexRenderer?.navKeys||[])],navFrame:window.__vexRenderer?.navFrame||0,navPointer:!!window.__vexRenderer?.navPointer}));
  if(navState.keys.length||navState.navFrame||navState.navPointer)throw new Error(`Studio movement state did not fully clear: ${JSON.stringify(navState)}`);
  await page.keyboard.up('w');await clickDom('#doneSettingsBtn');
  await page.keyboard.press('r');if(!await page.locator('#rotateBtn').evaluate(el=>el.classList.contains('active')))throw new Error('Roblox transform-cycle key did not switch tools');
  checkpoint('movement-stop-ok');

  const first=page.locator('.part-row').first();await first.waitFor({state:'visible',timeout:10000});await first.click();
  const box=await canvas.boundingBox();if(!box)throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);await page.waitForTimeout(450);await page.mouse.click(box.x+box.width*.55,box.y+box.height*.55);
  await page.waitForFunction(()=>/^1 parts/.test(document.querySelector('#stats')?.textContent||''),null,{timeout:12000});
  checkpoint('part-placement-ok');

  await page.locator('#snapshotBtn').waitFor({state:'visible',timeout:10000});await clickDom('#snapshotBtn');
  await page.waitForFunction(()=>/Snapshot\s*·\s*1/.test(document.querySelector('#snapshotBtn')?.textContent||''),null,{timeout:5000});
  await clickDom('#tutorialBtn');await page.waitForFunction(()=>document.querySelector('#tutorialPanel')?.classList.contains('open'),null,{timeout:5000});
  const localNote=await page.locator('.tutorial-local-note').innerText();if(!/never sent/i.test(localNote))throw new Error('tutorial local-only disclosure missing');
  await clickDom('#previewTutorialBtn');await page.waitForFunction(()=>document.querySelector('#tutorialViewer')?.classList.contains('open'),null,{timeout:7000});
  await page.waitForFunction(()=>/1\s*\/\s*1/.test(document.querySelector('#instructionProgress')?.textContent||''),null,{timeout:8000});
  if(await page.locator('#instructionViewport canvas').count()!==1)throw new Error('tutorial 3D viewer did not create a canvas');
  await clickDom('#exitTutorialViewer');
  checkpoint('tutorial-ok');

  await clickDom('#simulationBtn');await page.waitForFunction(()=>document.querySelector('#simulationPanel')?.classList.contains('open'),null,{timeout:7000});
  await page.waitForFunction(()=>document.querySelector('#simulationMetrics')?.textContent?.includes('Gear ratio'),null,{timeout:8000});
  if(await page.locator('#simulationViewport canvas').count()!==1)throw new Error('simulation viewer did not create a canvas');
  await clickDom('#closeSimulationBtn');
  checkpoint('simulation-ok');

  const status=await page.locator('#status').innerText();
  if(/failed|error/i.test(status))throw new Error(`editor status after advanced feature smoke: ${status}`);
  if(errors.some(x=>/Failed to resolve module|Cannot find module|404.*(three|parts|app-stable|studio-settings|advanced-features)|Parts manifest HTTP|Invalid VEX mesh|Not a VEX CAD tutorial|CONTEXT_LOST_WEBGL|existing context of a different type/i.test(x)))throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,meta,compression:manifest.meshCompression,graphics,status,panelState,cameraBefore,cameraMoving,cameraStopped1,cameraStopped2,navState,errors,badResponses,failedRequests}));
} catch(err){
  let snap={};try{snap=await snapshot();}catch{}
  console.error('VEX_SMOKE_DIAGNOSTICS',JSON.stringify({snap,errors,badResponses,failedRequests},null,2));
  throw err;
} finally {await browser.close();}
