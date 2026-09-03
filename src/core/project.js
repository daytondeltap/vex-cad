export const PROJECT_SCHEMA=2;
export function serializeProject(state){
  return {schema:PROJECT_SCHEMA,name:state.projectName||'Untitled',createdBy:'VEX CAD',entities:[...state.entities.values()].map(e=>({
    id:e.id,partId:e.partId,name:e.name,matrix:[...e.matrix],hidden:!!e.hidden,locked:!!e.locked,custom:e.custom||null
  })),constraints:state.constraints.map(c=>structuredClone(c)),settings:{quality:state.quality||'balanced'}};
}
export function validateProject(p){
  if(!p||p.schema!==PROJECT_SCHEMA||!Array.isArray(p.entities)||!Array.isArray(p.constraints))throw new Error('Unsupported or invalid VEX CAD project');
  const ids=new Set(); for(const e of p.entities){ if(!e.id||!Array.isArray(e.matrix)||e.matrix.length!==16)throw new Error('Invalid entity'); if(ids.has(e.id))throw new Error('Duplicate entity ID'); ids.add(e.id); }
  return p;
}
