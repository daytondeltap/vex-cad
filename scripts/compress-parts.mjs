import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root=path.resolve(process.argv[2]||'public/parts'),manifestPath=path.join(root,'manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
if(!Array.isArray(manifest.parts)||!manifest.parts.length)throw new Error('Parts manifest is empty');
let rawBytes=0,compressedBytes=0,count=0;
for(const part of manifest.parts){
  const rel=String(part.mesh||'');if(!rel)throw new Error(`Missing mesh for ${part.id}`);
  if(rel.endsWith('.gz'))continue;
  const src=path.join(root,rel),raw=await fs.readFile(src),gz=gzipSync(raw,{level:9}),gzRel=`${rel}.gz`,dst=path.join(root,gzRel);
  await fs.writeFile(dst,gz);await fs.unlink(src);part.mesh=gzRel;part.compression='gzip';part.rawBytes=raw.length;part.compressedBytes=gz.length;rawBytes+=raw.length;compressedBytes+=gz.length;count++;
}
manifest.meshCompression='gzip';manifest.meshRawBytes=rawBytes;manifest.meshCompressedBytes=compressedBytes;manifest.meshCompressionRatio=rawBytes?compressedBytes/rawBytes:1;
await fs.writeFile(manifestPath,JSON.stringify(manifest));
console.log(`compressed ${count} meshes: ${(rawBytes/1048576).toFixed(1)} MiB -> ${(compressedBytes/1048576).toFixed(1)} MiB (${(100*compressedBytes/Math.max(1,rawBytes)).toFixed(1)}%)`);
