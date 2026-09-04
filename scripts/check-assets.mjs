import fs from 'node:fs';
import path from 'node:path';
const manifestPath=path.resolve(process.argv[2]||'public/parts/manifest.json');
if(!fs.existsSync(manifestPath))throw new Error(`Missing ${manifestPath}`);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!Array.isArray(m.parts)||m.parts.length<1)throw new Error('No parts in manifest');
if(m.failures?.length)throw new Error(`Manifest contains ${m.failures.length} conversion failures`);
const root=path.dirname(manifestPath),ids=new Set();let verified=0,totalTriangles=0;
for(const part of m.parts){
  if(!part.id||!part.name||!part.mesh)throw new Error('Invalid part row');
  if(ids.has(part.id))throw new Error(`Duplicate id ${part.id}`);ids.add(part.id);
  if(!Number.isFinite(part.triangles)||part.triangles<1||part.triangles>90000)throw new Error(`Triangle budget violated by ${part.id}: ${part.triangles}`);
  totalTriangles+=part.triangles;verified+=(part.attachments||[]).filter(a=>a.verified).length;
  const fp=path.join(root,part.mesh);if(!fs.existsSync(fp))throw new Error(`Missing mesh ${part.mesh}`);
  const b=fs.readFileSync(fp);if(b.length<36||b.subarray(0,4).toString()!=='VXM1')throw new Error(`Bad mesh ${part.mesh}`);
  const vc=b.readUInt32LE(4),ic=b.readUInt32LE(8),expected=36+vc*6+ic*4;
  if(!vc||!ic||ic%3||b.length!==expected)throw new Error(`Corrupt mesh layout ${part.mesh}`);
  if(ic!==part.triangles*3)throw new Error(`Manifest/index mismatch ${part.mesh}`);
}
if(m.partCount!==m.parts.length)throw new Error(`partCount mismatch: ${m.partCount} vs ${m.parts.length}`);
console.log(`asset-check: ${m.parts.length} parts, ${verified} BREP-verified attachments, ${totalTriangles.toLocaleString()} triangles`);
