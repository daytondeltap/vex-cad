import fs from 'node:fs';
import path from 'node:path';

const manifestPath=path.resolve(process.argv[2]||'public/parts/manifest.json');
if(!fs.existsSync(manifestPath))throw new Error(`Missing ${manifestPath}`);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!Array.isArray(m.parts)||m.parts.length<50)throw new Error(`Too few usable parts in manifest: ${m.parts?.length||0}`);
if(m.partCount!==m.parts.length)throw new Error(`partCount mismatch: ${m.partCount} vs ${m.parts.length}`);

const failures=Array.isArray(m.failures)?m.failures:[];
const sourceCount=Number.isFinite(m.sourceEntryCount)?m.sourceEntryCount:(m.parts.length+failures.length);
if(sourceCount<m.parts.length)throw new Error('sourceEntryCount cannot be smaller than partCount');
if(Number.isFinite(m.failedCount)&&m.failedCount!==failures.length)throw new Error(`failedCount mismatch: ${m.failedCount} vs ${failures.length}`);
const failureRatio=sourceCount?failures.length/sourceCount:1;
if(failureRatio>0.10)throw new Error(`Too many source conversion failures: ${failures.length}/${sourceCount}`);
for(const failure of failures){
  if(!failure||typeof failure.file!=='string'||!failure.file.trim())throw new Error('Invalid failure row');
  if(typeof failure.error!=='string'||!failure.error.trim())throw new Error(`Failure row missing error: ${failure.file}`);
}

const root=path.dirname(manifestPath),ids=new Set(),meshes=new Set();let verified=0,totalTriangles=0;
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
for(const part of m.parts){
  if(!part.id||!part.name||!part.mesh||!part.partNumber)throw new Error('Invalid part row');
  if(ids.has(part.id))throw new Error(`Duplicate id ${part.id}`);ids.add(part.id);
  if(meshes.has(part.mesh))throw new Error(`Duplicate mesh path ${part.mesh}`);meshes.add(part.mesh);
  if(!Number.isFinite(part.triangles)||part.triangles<1||part.triangles>90000)throw new Error(`Triangle budget violated by ${part.id}: ${part.triangles}`);
  if(!Number.isFinite(part.vertices)||part.vertices<3)throw new Error(`Invalid vertex count for ${part.id}`);
  if(!Array.isArray(part.bbox)||part.bbox.length!==2||!finite3(part.bbox[0])||!finite3(part.bbox[1]))throw new Error(`Invalid bbox for ${part.id}`);
  if(part.bbox[0].some((v,i)=>v>part.bbox[1][i]))throw new Error(`Inverted bbox for ${part.id}`);
  const attachments=Array.isArray(part.attachments)?part.attachments:[];
  for(const a of attachments){
    if(!a||!['hole','pin','shaft','socket'].includes(a.type))throw new Error(`Invalid attachment type on ${part.id}`);
    if(!finite3(a.point)||!finite3(a.axis))throw new Error(`Invalid attachment coordinates on ${part.id}`);
    const axisLength=Math.hypot(...a.axis);
    if(axisLength<0.9||axisLength>1.1)throw new Error(`Non-unit attachment axis on ${part.id}`);
  }
  totalTriangles+=part.triangles;verified+=attachments.filter(a=>a.verified).length;
  const fp=path.join(root,part.mesh);if(!fs.existsSync(fp))throw new Error(`Missing mesh ${part.mesh}`);
  const b=fs.readFileSync(fp);if(b.length<36||b.subarray(0,4).toString()!=='VXM1')throw new Error(`Bad mesh ${part.mesh}`);
  const vc=b.readUInt32LE(4),ic=b.readUInt32LE(8),expected=36+vc*6+ic*4;
  if(!vc||!ic||ic%3||b.length!==expected)throw new Error(`Corrupt mesh layout ${part.mesh}`);
  if(vc!==part.vertices)throw new Error(`Manifest/vertex mismatch ${part.mesh}`);
  if(ic!==part.triangles*3)throw new Error(`Manifest/index mismatch ${part.mesh}`);
}

if(failures.length)console.warn(`asset-check warning: ${failures.length}/${sourceCount} source STEP entries unavailable; usable catalog remains valid`);
console.log(`asset-check: ${m.parts.length} parts, ${verified} BREP-verified attachments, ${totalTriangles.toLocaleString()} triangles`);
