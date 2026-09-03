import fs from 'node:fs';import path from 'node:path';
const root=path.resolve('public/parts');const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));const ids=new Set();let verified=0;
if(manifest.partCount!==manifest.parts.length)throw new Error('partCount mismatch');
for(const p of manifest.parts){if(ids.has(p.id))throw new Error(`duplicate id ${p.id}`);ids.add(p.id);const file=path.join(root,p.mesh.shard);const stat=fs.statSync(file);if(p.mesh.offset<0||p.mesh.length<=4||p.mesh.offset+p.mesh.length>stat.size)throw new Error(`invalid mesh range ${p.id}`);verified+=(p.attachments||[]).filter(a=>a.verified).length;}
console.log(`Asset check OK: ${manifest.parts.length} parts, ${verified} verified attachment axes, ${new Set(manifest.parts.map(p=>p.mesh.shard)).size} shards.`);
