import { chromium } from 'playwright-core';

const base=process.env.VEX_SMOKE_URL||'http://127.0.0.1:4173/vex-cad/';
const executablePath=process.env.CHROME_PATH||'/usr/bin/google-chrome';
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],badResponses=[],failedRequests=[];
page.on('pageerror',err=>errors.push(`pageerror: ${err.message}`));
page.on('console',msg=>{if(['error','warning'].includes(msg.type()))errors.push(`${msg.type()}: ${msg.text()}`);});
page.on('requestfailed',req=>failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`));
page.on('response',res=>{if(res.status()>=400)badResponses.push(`${res.status()} ${res.url()}`);});
async function snapshot(){return page.evaluate(()=>({url:location.href,title:document.title,booted:window.__vexBooted,bootError:window.__vexBootError||'',status:document.querySelector('#status')?.textContent||'',meta:document.querySelector('#libraryMeta')?.textContent||'',perf:document.querySelector('#perf')?.textContent||'',canvasCount:document.querySelectorAll('#viewport canvas').length,partRows:document.querySelectorAll('.part-row').length,settings:!!document.querySelector('#settingsBtn'),simulation:!!document.querySelector('#simulationBtn'),snapshotButton:!!document.querySelector('#snapshotBtn'),body:(document.body?.innerText||'').slice(0,900)}));}
const moved=(a,b,eps=.01)=>a.some((v,i)=>Math.abs(v-b[i])>eps);
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
  const graphics=await canvas.evaluate(el=>({width:el.width,height:el.height,webgl2:!!el.getContext('webgl2'),webgl:!!el.getContext('webgl')}));
  if(graphics.width<10||graphics.height<10||(!graphics.webgl2&&!graphics.webgl))throw new Error(`invalid graphics canvas ${JSON.stringify(graphics)}`);

  const settingsBtn=page.locator('#settingsBtn');await settingsBtn.waitFor({state:'visible',timeout:10000});await settingsBtn.click();
  await page.selectOption('#controlPreset','roblox');await page.selectOption('#materialStyle','glossy');
  if(!await page.locator('#proximitySnap').isChecked())throw new Error('proximity snapping should default on');
  await page.locator('#snapDistance').evaluate(el=>{el.value='32';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#snapAngle').evaluate(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>window.__vexRenderer?.navigationPreset==='roblox'&&window.__vexRenderer?.visualSettings?.materialStyle==='glossy'&&window.__vexFeatureSettings?.snapDistance===32&&window.__vexFeatureSettings?.snapAngle===120,null,{timeout:5000});
  await page.click('#doneSettingsBtn');

  const cameraBefore=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());await page.keyboard.down('w');await page.waitForTimeout(170);
  const cameraMoving=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());if(!moved(cameraBefore,cameraMoving))throw new Error('Roblox WASD navigation did not move camera');
  await page.click('#settingsBtn');await page.waitForTimeout(260);
  const cameraStopped1=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());await page.waitForTimeout(320);const cameraStopped2=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());
  if(moved(cameraStopped1,cameraStopped2,.025))throw new Error(`Roblox movement stayed latched after opening menu: ${JSON.stringify({cameraStopped1,cameraStopped2})}`);
  const navState=await page.evaluate(()=>({keys:[...(window.__vexRenderer?.navKeys||[])],navFrame:window.__vexRenderer?.navFrame||0,navPointer:!!window.__vexRenderer?.navPointer}));
  if(navState.keys.length||navState.navFrame||navState.navPointer)throw new Error(`Studio movement state did not fully clear: ${JSON.stringify(navState)}`);
  await page.keyboard.up('w');await page.click('#doneSettingsBtn');
  await page.keyboard.press('r');if(!await page.locator('#rotateBtn').evaluate(el=>el.classList.contains('active')))throw new Error('Roblox transform-cycle key did not switch tools');

  const first=page.locator('.part-row').first();await first.waitFor({state:'visible',timeout:10000});await first.click();
  const box=await canvas.boundingBox();if(!box)throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);await page.waitForTimeout(450);await page.mouse.click(box.x+box.width*.55,box.y+box.height*.55);
  await page.waitForFunction(()=>/^1 parts/.test(document.querySelector('#stats')?.textContent||''),null,{timeout:12000});

  await page.locator('#snapshotBtn').waitFor({state:'visible',timeout:10000});await page.click('#snapshotBtn');
  await page.waitForFunction(()=>/Snapshot\s*·\s*1/.test(document.querySelector('#snapshotBtn')?.textContent||''),null,{timeout:5000});
  await page.click('#tutorialBtn');await page.locator('#tutorialPanel.open').waitFor({state:'visible',timeout:5000});
  const localNote=await page.locator('.tutorial-local-note').innerText();if(!/never sent/i.test(localNote))throw new Error('tutorial local-only disclosure missing');
  await page.click('#previewTutorialBtn');await page.locator('#tutorialViewer.open').waitFor({state:'visible',timeout:7000});
  await page.waitForFunction(()=>/1\s*\/\s*1/.test(document.querySelector('#instructionProgress')?.textContent||''),null,{timeout:8000});
  if(await page.locator('#instructionViewport canvas').count()!==1)throw new Error('tutorial 3D viewer did not create a canvas');
  await page.click('#exitTutorialViewer');

  await page.click('#simulationBtn');await page.locator('#simulationPanel.open').waitFor({state:'visible',timeout:7000});
  await page.waitForFunction(()=>document.querySelector('#simulationMetrics')?.textContent?.includes('Gear ratio'),null,{timeout:8000});
  if(await page.locator('#simulationViewport canvas').count()!==1)throw new Error('simulation viewer did not create a canvas');
  await page.click('#closeSimulationBtn');

  const status=await page.locator('#status').innerText();
  if(/failed|error/i.test(status))throw new Error(`editor status after advanced feature smoke: ${status}`);
  if(errors.some(x=>/Failed to resolve module|Cannot find module|404.*(three|parts|app-stable|studio-settings|advanced-features)|Parts manifest HTTP|Invalid VEX mesh|Not a VEX CAD tutorial/i.test(x)))throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,meta,compression:manifest.meshCompression,graphics,status,cameraBefore,cameraMoving,cameraStopped1,cameraStopped2,navState,errors,badResponses,failedRequests}));
} catch(err){
  let snap={};try{snap=await snapshot();}catch{}
  console.error('VEX_SMOKE_DIAGNOSTICS',JSON.stringify({snap,errors,badResponses,failedRequests},null,2));
  throw err;
} finally {await browser.close();}
