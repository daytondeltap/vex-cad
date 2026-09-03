export function wouldCreateCycle(constraints,parentId,childId){
  if(parentId===childId)return true;
  const graph=new Map();
  for(const c of constraints){ if(!graph.has(c.parentId))graph.set(c.parentId,[]); graph.get(c.parentId).push(c.childId); }
  const stack=[childId], seen=new Set();
  while(stack.length){ const n=stack.pop(); if(n===parentId)return true; if(seen.has(n))continue; seen.add(n); for(const x of graph.get(n)||[])stack.push(x); }
  return false;
}
export function childConstraint(constraints,id){ return constraints.find(c=>c.childId===id)||null; }
export function validateConstraint(c,entities){
  if(!c?.id||!['fixed','revolute'].includes(c.type))return false;
  return entities.has(c.parentId)&&entities.has(c.childId)&&c.parentId!==c.childId;
}
