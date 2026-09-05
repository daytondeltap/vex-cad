export const TUTORIAL_SCHEMA=1;
const MAGIC_GZIP='VXT1GZ\n',MAGIC_JSON='VXT1JS\n';
const clone=v=>structuredClone(v);
const pos=e=>[e.matrix?.[12]||0,e.matrix?.[13]||0,e.matrix?.[14]||0];
const changedMatrix=(a,b,eps=.001)=>!Array.isArray(a)||!Array.isArray(b)||a.length!==16||b.length!==16||a.some((v,i)=>Math.abs(v-b[i])>eps);

export function snapshotProject(project){
  if(!project||!Array.isArray(project.entities))throw new Error('No CAD project is available to snapshot');
  return {schema:project.schema||2,name:project.name||'Untitled',entities:project.entities.map(e=>clone(e)),constraints:Array.isArray(project.constraints)?project.constraints.map(c=>clone(c)):[],settings:clone(project.settings||{})};
}

export function diffSnapshots(previous,current){
  const before=new Map((previous?.entities||[]).map(e=>[e.id,e])),after=new Map((current?.entities||[]).map(e=>[e.id,e]));
  const added=[],removed=[],moved=[],unchanged=[];
  for(const [id,e] of after){const old=before.get(id);if(!old)added.push(id);else if(changedMatrix(old.matrix,e.matrix)||old.hidden!==e.hidden)moved.push(id);else unchanged.push(id);}
  for(const id of before.keys())if(!after.has(id))removed.push(id);
  const arrows=[];
  for(const id of added){const e=after.get(id),to=pos(e);arrows.push({kind:'add',entityId:id,from:[to[0],to[1],to[2]+42],to});}
  for(const id of moved){const a=before.get(id),b=after.get(id);arrows.push({kind:'move',entityId:id,from:pos(a),to:pos(b)});}
  for(const id of removed){const e=before.get(id),from=pos(e);arrows.push({kind:'remove',entityId:id,from,to:[from[0],from[1],from[2]+42]});}
  return {added,removed,moved,unchanged,arrows};
}

export function createTutorial(name='Custom Build'){
  return {schema:TUTORIAL_SCHEMA,type:'vex-cad-tutorial',name:String(name||'Custom Build').slice(0,120),createdAt:new Date().toISOString(),steps:[]};
}

export function appendStep(tutorial,project,title=''){
  if(!tutorial||tutorial.schema!==TUTORIAL_SCHEMA||!Array.isArray(tutorial.steps))throw new Error('Invalid tutorial');
  const snapshot=snapshotProject(project),previous=tutorial.steps.at(-1)?.snapshot||null,changes=diffSnapshots(previous,snapshot),number=tutorial.steps.length+1;
  const step={id:crypto.randomUUID?.()||`step-${Date.now()}-${number}`,number,title:String(title||`Step ${number}`).slice(0,100),snapshot,changes};
  tutorial.steps.push(step);return step;
}

export function validateTutorial(t){
  if(!t||t.schema!==TUTORIAL_SCHEMA||t.type!=='vex-cad-tutorial'||!Array.isArray(t.steps)||t.steps.length>500)throw new Error('Unsupported or invalid VEX CAD tutorial');
  for(let i=0;i<t.steps.length;i++){const s=t.steps[i];if(!s||!s.snapshot||!Array.isArray(s.snapshot.entities)||s.snapshot.entities.length>10000)throw new Error(`Invalid tutorial step ${i+1}`);}
  return t;
}

async function streamBytes(bytes,kind){
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream(kind));return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unstreamBytes(bytes,kind){
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(kind));return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeTutorial(tutorial){
  validateTutorial(tutorial);const json=new TextEncoder().encode(JSON.stringify(tutorial));
  if(typeof CompressionStream==='function'){
    const zipped=await streamBytes(json,'gzip'),head=new TextEncoder().encode(MAGIC_GZIP),out=new Uint8Array(head.length+zipped.length);out.set(head);out.set(zipped,head.length);return out;
  }
  const head=new TextEncoder().encode(MAGIC_JSON),out=new Uint8Array(head.length+json.length);out.set(head);out.set(json,head.length);return out;
}

export async function decodeTutorial(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(await input.arrayBuffer()),head=new TextDecoder().decode(bytes.slice(0,7));let payload;
  if(head===MAGIC_GZIP){if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress VEX tutorial files');payload=await unstreamBytes(bytes.slice(7),'gzip');}
  else if(head===MAGIC_JSON)payload=bytes.slice(7);else throw new Error('Not a VEX CAD tutorial file');
  return validateTutorial(JSON.parse(new TextDecoder().decode(payload)));
}
