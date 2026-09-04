export const PROJECT_SCHEMA=2;
const MAX_ENTITIES=10000,MAX_CONSTRAINTS=20000,MAX_CUSTOM_POSITION_VALUES=6_000_000,MAX_CUSTOM_INDICES=6_000_000;
const finiteMatrix=m=>Array.isArray(m)&&m.length===16&&m.every(Number.isFinite);
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);

export function serializeProject(state){
  return {schema:PROJECT_SCHEMA,name:state.projectName||'Untitled',createdBy:'VEX CAD',entities:[...state.entities.values()].map(e=>({
    id:e.id,partId:e.partId,name:e.name,matrix:[...e.matrix],hidden:!!e.hidden,locked:!!e.locked,custom:e.custom||null
  })),constraints:state.constraints.map(c=>structuredClone(c)),settings:{quality:state.quality||'balanced'}};
}

function validateCustom(custom,id){
  if(custom==null)return;
  if(typeof custom!=='object')throw new Error(`Invalid custom part data on ${id}`);
  if(custom.name!=null&&typeof custom.name!=='string')throw new Error(`Invalid custom part name on ${id}`);
  const g=custom.geometry;if(g==null)return;
  if(!Array.isArray(g.positions)||g.positions.length<9||g.positions.length%3!==0||g.positions.length>MAX_CUSTOM_POSITION_VALUES||g.positions.some(v=>!Number.isFinite(v)))throw new Error(`Invalid custom geometry positions on ${id}`);
  const vc=g.positions.length/3,indices=Array.isArray(g.indices)?g.indices:[];
  if(indices.length%3!==0||indices.length>MAX_CUSTOM_INDICES||indices.some(v=>!Number.isInteger(v)||v<0||v>=vc))throw new Error(`Invalid custom geometry indices on ${id}`);
}

export function validateProject(p){
  if(!p||p.schema!==PROJECT_SCHEMA||!Array.isArray(p.entities)||!Array.isArray(p.constraints))throw new Error('Unsupported or invalid VEX CAD project');
  if(p.entities.length>MAX_ENTITIES)throw new Error(`Project exceeds ${MAX_ENTITIES.toLocaleString()} parts`);
  if(p.constraints.length>MAX_CONSTRAINTS)throw new Error(`Project exceeds ${MAX_CONSTRAINTS.toLocaleString()} constraints`);
  if(p.name!=null&&typeof p.name!=='string')throw new Error('Invalid project name');
  if(p.settings?.quality!=null&&!['low','balanced','high'].includes(p.settings.quality))throw new Error('Invalid project quality setting');

  const ids=new Set();
  for(const e of p.entities){
    if(!e||typeof e.id!=='string'||!e.id||typeof e.partId!=='string'||!e.partId||!finiteMatrix(e.matrix))throw new Error('Invalid entity');
    if(ids.has(e.id))throw new Error('Duplicate entity ID');ids.add(e.id);
    if(e.name!=null&&typeof e.name!=='string')throw new Error(`Invalid entity name on ${e.id}`);
    validateCustom(e.custom,e.id);
  }

  const constraintIds=new Set(),childIds=new Set(),graph=new Map();
  for(const c of p.constraints){
    if(!c||typeof c.id!=='string'||!c.id||!['fixed','revolute'].includes(c.type))throw new Error('Invalid constraint');
    if(constraintIds.has(c.id))throw new Error('Duplicate constraint ID');constraintIds.add(c.id);
    if(!ids.has(c.parentId)||!ids.has(c.childId)||c.parentId===c.childId)throw new Error(`Constraint ${c.id} references invalid entities`);
    if(childIds.has(c.childId))throw new Error(`Part ${c.childId} has more than one driving constraint`);childIds.add(c.childId);
    const matrix=c.type==='fixed'?c.relativeMatrix:(c.baseRelative||c.relativeMatrix);
    if(!finiteMatrix(matrix))throw new Error(`Constraint ${c.id} has an invalid transform`);
    if(c.type==='revolute'){
      if(!finite3(c.anchor||[0,0,0])||!finite3(c.axis||[0,0,1])||!Number.isFinite(c.angle??0))throw new Error(`Constraint ${c.id} has invalid revolute data`);
      if(Math.hypot(...(c.axis||[0,0,1]))<1e-6)throw new Error(`Constraint ${c.id} has a zero-length axis`);
    }
    if(!graph.has(c.parentId))graph.set(c.parentId,[]);graph.get(c.parentId).push(c.childId);
  }

  const visiting=new Set(),visited=new Set();
  const walk=id=>{if(visiting.has(id))throw new Error('Constraint graph contains a cycle');if(visited.has(id))return;visiting.add(id);for(const child of graph.get(id)||[])walk(child);visiting.delete(id);visited.add(id);};
  for(const id of ids)walk(id);
  return p;
}
