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
async function snapshot(){return page.evaluate(()=>({url:location.href,title:document.title,booted:window.__vexBooted,bootError:window.__vexBootError||'',status:document.querySelector('#status')?.textContent||'',meta:document.querySelector('#libraryMeta')?.textContent||'',perf:document.querySelector('#perf')?.textContent||'',canvasCount:document.querySelectorAll('#viewport canvas').length,partRows:document.querySelectorAll('.part-row').length,settings:!!document.querySelector('#settingsBtn'),body:(document.body?.innerText||'').slice(0,700)}));}
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
  const canvas=page.locator('#viewport canvas');await canvas.waitFor({state:'visible',timeout:10000});
  const graphics=await canvas.evaluate(el=>({width:el.width,height:el.height,webgl2:!!el.getContext('webgl2'),webgl:!!el.getContext('webgl')}));
  if(graphics.width<10||graphics.height<10||(!graphics.webgl2&&!graphics.webgl))throw new Error(`invalid graphics canvas ${JSON.stringify(graphics)}`);

  const settingsBtn=page.locator('#settingsBtn');await settingsBtn.waitFor({state:'visible',timeout:10000});await settingsBtn.click();
  await page.selectOption('#controlPreset','roblox');await page.selectOption('#materialStyle','glossy');
  await page.waitForFunction(()=>window.__vexRenderer?.navigationPreset==='roblox'&&window.__vexRenderer?.visualSettings?.materialStyle==='glossy',null,{timeout:5000});
  await page.click('#doneSettingsBtn');
  const cameraBefore=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());await page.keyboard.down('w');await page.waitForTimeout(160);await page.keyboard.up('w');
  const cameraAfter=await page.evaluate(()=>window.__vexRenderer.camera.position.toArray());if(cameraBefore.every((v,i)=>Math.abs(v-cameraAfter[i])<.01))throw new Error('Roblox WASD navigation did not move camera');
  await page.keyboard.press('r');if(!await page.locator('#rotateBtn').evaluate(el=>el.classList.contains('active')))throw new Error('Roblox transform-cycle key did not switch tools');

  const first=page.locator('.part-row').first();await first.waitFor({state:'visible',timeout:10000});await first.click();
  const box=await canvas.boundingBox();if(!box)throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);await page.waitForTimeout(450);await page.mouse.click(box.x+box.width*.55,box.y+box.height*.55);
  await page.waitForFunction(()=>/^1 parts/.test(document.querySelector('#stats')?.textContent||''),null,{timeout:12000});
  const status=await page.locator('#status').innerText();
  if(/failed|error/i.test(status))throw new Error(`editor status after placement: ${status}`);
  if(errors.some(x=>/Failed to resolve module|Cannot find module|404.*(three|parts|app-stable|studio-settings)|Parts manifest HTTP|Invalid VEX mesh/i.test(x)))throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,meta,graphics,status,cameraBefore,cameraAfter,errors,badResponses,failedRequests}));
} catch(err){
  let snap={};try{snap=await snapshot();}catch{}
  console.error('VEX_SMOKE_DIAGNOSTICS',JSON.stringify({snap,errors,badResponses,failedRequests},null,2));
  throw err;
} finally {await browser.close();}
