import fs from 'node:fs';
import path from 'node:path';
const manifestPath = path.resolve(process.argv[2] || 'public/parts/manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}`);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if (!Array.isArray(m.parts) || m.parts.length < 1) throw new Error('No parts in manifest');
const root=path.dirname(manifestPath), ids=new Set(); let verified=0;
for (const part of m.parts) {
  if (!part.id || !part.name || !part.mesh) throw new Error('Invalid part row');
  if (ids.has(part.id)) throw new Error(`Duplicate id ${part.id}`); ids.add(part.id);
  verified += (part.attachments||[]).filter(a=>a.verified).length;
  const fp=path.join(root,part.mesh);
  if (!fs.existsSync(fp)) throw new Error(`Missing mesh ${part.mesh}`);
  const b=fs.readFileSync(fp); if (b.subarray(0,4).toString()!=='VXM1') throw new Error(`Bad mesh ${part.mesh}`);
}
if (m.failures?.length) throw new Error(`Manifest contains ${m.failures.length} conversion failures`);
console.log(`asset-check: ${m.parts.length} parts, ${verified} BREP-verified attachments`);
