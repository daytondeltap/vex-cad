const clamp=(n,a,b)=>Math.min(b,Math.max(a,Number(n)||0));
const pos=e=>[e.matrix?.[12]||0,e.matrix?.[13]||0,e.matrix?.[14]||0];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export function inferGearTeeth(name=''){
  const text=String(name);
  const patterns=[/(\d{1,3})\s*(?:tooth|teeth)\b/i,/\b(?:gear|spur)\s*(\d{1,3})\s*[tT]\b/,/\b(\d{1,3})[tT]\s*(?:gear|spur)\b/i];
  for(const re of patterns){const m=text.match(re);if(m){const n=Number(m[1]);if(n>=8&&n<=120)return n;}}
  return null;
}

export function detectGears(project,getPart,selectedIds=[]){
  const gears=(project?.entities||[]).map(e=>{const d=getPart?.(e.partId)||{};const teeth=inferGearTeeth(`${e.name||''} ${d.name||''}`);return teeth?{id:e.id,partId:e.partId,name:d.name||e.name||'Gear',teeth,position:pos(e),matrix:[...e.matrix]}:null;}).filter(Boolean);
  if(gears.length<2)return gears;
  const selected=new Set(selectedIds||[]),start=gears.find(g=>selected.has(g.id))||gears[0],ordered=[start],unused=new Set(gears.filter(g=>g!==start));
  while(unused.size){const last=ordered.at(-1);let best=null,bestD=Infinity;for(const g of unused){const d=dist(last.position,g.position);if(d<bestD){bestD=d;best=g;}}ordered.push(best);unused.delete(best);}
  return ordered;
}

export function gearKinematics(gears,inputRpm=100){
  if(!Array.isArray(gears)||!gears.length)return [];
  const out=[{...gears[0],rpm:Number(inputRpm)||0,direction:1}];
  for(let i=1;i<gears.length;i++){
    const prev=out[i-1],cur=gears[i],rpm=-(prev.rpm*(prev.teeth/cur.teeth));
    out.push({...cur,rpm,direction:Math.sign(rpm)||1});
  }
  return out;
}

export function overallGearRatio(gears){
  if(!Array.isArray(gears)||gears.length<2)return 1;
  const first=Number(gears[0].teeth)||1,last=Number(gears.at(-1).teeth)||1;
  return last/first;
}

export function driveMetrics({gears=[],inputRpm=100,motorTorqueNm=.2,motorCount=2,efficiency=.82,wheelDiameterMm=100,massKg=4,wheelCount=4,inclineDeg=0}={}){
  const ratio=Math.max(.01,overallGearRatio(gears)),eff=clamp(efficiency,.05,1),motors=clamp(motorCount,1,16),diameter=clamp(wheelDiameterMm,20,400),mass=clamp(massKg,.1,100),wheels=clamp(wheelCount,1,16),rpm=(Number(inputRpm)||0)/ratio;
  const wheelRadiusM=diameter/2000,speedMps=Math.abs(rpm)*Math.PI*(diameter/1000)/60,tractiveForceN=(Math.max(0,Number(motorTorqueNm)||0)*motors*ratio*eff)/wheelRadiusM,gradeForceN=mass*9.80665*Math.sin((Number(inclineDeg)||0)*Math.PI/180),netForceN=Math.max(0,tractiveForceN-gradeForceN),accelMps2=netForceN/mass,staticLoadPerWheelN=mass*9.80665/wheels;
  return {ratio,outputRpm:rpm,speedMps,tractiveForceN,gradeForceN,netForceN,accelMps2,staticLoadPerWheelN,massKg:mass};
}

export function simulationSummary(metrics){
  return {
    ratioText:`${metrics.ratio.toFixed(2)}:1`,
    rpmText:`${metrics.outputRpm.toFixed(1)} rpm`,
    speedText:`${metrics.speedMps.toFixed(2)} m/s`,
    forceText:`${metrics.tractiveForceN.toFixed(1)} N`,
    accelText:`${metrics.accelMps2.toFixed(2)} m/s²`,
    loadText:`${metrics.staticLoadPerWheelN.toFixed(1)} N / wheel`
  };
}
