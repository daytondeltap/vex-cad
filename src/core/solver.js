import * as THREE from 'three';

export function applyConstraints(state){
  const entities=state.entities, constraints=state.constraints;
  const byParent=new Map(); for(const c of constraints){if(!byParent.has(c.parentId))byParent.set(c.parentId,[]);byParent.get(c.parentId).push(c);}
  const children=new Set(constraints.map(c=>c.childId)); const roots=[...entities.keys()].filter(id=>!children.has(id)); const visited=new Set();
  const walk=id=>{if(visited.has(id))return;visited.add(id);const p=entities.get(id);if(!p)return;const pm=new THREE.Matrix4().fromArray(p.matrix);
    for(const c of byParent.get(id)||[]){const ch=entities.get(c.childId);if(!ch)continue;let rel=new THREE.Matrix4().fromArray(c.relativeMatrix||c.baseRelative);
      if(c.type==='revolute'){
        const a=new THREE.Vector3(...(c.anchor||[0,0,0])),axis=new THREE.Vector3(...(c.axis||[0,0,1])).normalize();const ang=THREE.MathUtils.degToRad(c.angle||0);
        const rot=new THREE.Matrix4().makeRotationAxis(axis,ang), around=new THREE.Matrix4().makeTranslation(...a).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-a.x,-a.y,-a.z)); rel=around.multiply(new THREE.Matrix4().fromArray(c.baseRelative));
      }
      ch.matrix=pm.clone().multiply(rel).toArray();walk(ch.id);
    }};
  for(const r of roots)walk(r); for(const id of entities.keys())walk(id);
}
export function makeFixedConstraint(parent,child,targetAttachment=null,sourceAttachment=null){
  const pm=new THREE.Matrix4().fromArray(parent.matrix),cm=new THREE.Matrix4().fromArray(child.matrix);return {id:crypto.randomUUID(),type:'fixed',parentId:parent.id,childId:child.id,relativeMatrix:pm.clone().invert().multiply(cm).toArray(),targetAttachment,sourceAttachment};
}
export function convertToRevolute(c,parent){
  const anchor=c.targetAttachment?.point||[0,0,0],axis=c.targetAttachment?.axis||[0,0,1];return {...c,type:'revolute',baseRelative:[...(c.relativeMatrix||c.baseRelative)],anchor:[...anchor],axis:[...axis],angle:0};
}
