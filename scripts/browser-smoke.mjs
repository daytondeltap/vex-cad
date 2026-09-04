import { chromium } from 'playwright-core';

const base=process.env.VEX_SMOKE_URL||'http://127.0.0.1:4173/vex-cad/';
const executablePath=process.env.CHROME_PATH||'/usr/bin/google-chrome';
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror',err=>errors.push(`pageerror: ${err.message}`));
page.on('console',msg=>{if(msg.type()==='error')errors.push(`console: ${msg.text()}`);});
try{
  const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
  if(!response?.ok())throw new Error(`page HTTP ${response?.status()}`);
  await page.waitForFunction(()=>{
    const text=document.querySelector('#libraryMeta')?.textContent||'';
    return /VEX IQ models/.test(text)||/Library failed|Graphics failed|Startup failed/i.test(text);
  },null,{timeout:20000});
  const meta=await page.locator('#libraryMeta').innerText();
  if(!/VEX IQ models/.test(meta))throw new Error(`library did not load: ${meta}`);
  const canvas=page.locator('#viewport canvas');await canvas.waitFor({state:'visible',timeout:10000});
  const graphics=await canvas.evaluate(el=>({width:el.width,height:el.height,webgl2:!!el.getContext('webgl2'),webgl:!!el.getContext('webgl')}));
  if(graphics.width<10||graphics.height<10||(!graphics.webgl2&&!graphics.webgl))throw new Error(`invalid graphics canvas ${JSON.stringify(graphics)}`);
  const first=page.locator('.part-row').first();await first.waitFor({state:'visible',timeout:10000});await first.click();
  const box=await canvas.boundingBox();if(!box)throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);await page.waitForTimeout(350);await page.mouse.click(box.x+box.width*.55,box.y+box.height*.55);
  await page.waitForFunction(()=>/^1 parts/.test(document.querySelector('#stats')?.textContent||''),null,{timeout:12000});
  const status=await page.locator('#status').innerText();
  if(/failed|error/i.test(status))throw new Error(`editor status after placement: ${status}`);
  if(errors.some(x=>/Failed to resolve module|Cannot find module|404.*(three|parts|app-stable)|Parts manifest HTTP|Invalid VEX mesh/i.test(x)))throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,meta,graphics,status,errors}));
} finally {await browser.close();}
