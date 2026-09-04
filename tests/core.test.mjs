import test from 'node:test'; import assert from 'node:assert/strict';
import {History,command} from '../src/core/history.js';
import {compatible,rankSnapCandidates} from '../src/core/snap.js';
import {wouldCreateCycle} from '../src/core/constraints.js';
import {serializeProject,validateProject} from '../src/core/project.js';

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const entity=(id,partId='p')=>({id,partId,name:id,matrix:identity(),hidden:false,locked:false,custom:null});

test('history undo redo',()=>{let n=0;const h=new History();h.execute(command('x',()=>n++,()=>n--));assert.equal(n,1);h.undo();assert.equal(n,0);h.redo();assert.equal(n,1)});
test('snap compatibility/ranking',()=>{assert.equal(compatible({type:'pin'},{type:'hole'}),true);const r=rankSnapCandidates([{type:'pin',point:[0,0,0],axis:[1,0,0]}],[{type:'hole',point:[2,0,0],axis:[-1,0,0]}],5);assert.equal(r.length,1);assert.equal(r[0].distance,2)});
test('constraint cycle helper',()=>{const cs=[{parentId:'a',childId:'b'},{parentId:'b',childId:'c'}];assert.equal(wouldCreateCycle(cs,'c','a'),true);assert.equal(wouldCreateCycle(cs,'a','d'),false)});
test('project roundtrip validates',()=>{const state={entities:new Map([['a',entity('a')]]),constraints:[],quality:'low'};assert.equal(validateProject(serializeProject(state)).entities.length,1)});
test('project rejects non-finite matrices',()=>{const p={schema:2,name:'bad',entities:[entity('a')],constraints:[],settings:{quality:'balanced'}};p.entities[0].matrix[0]=Infinity;assert.throws(()=>validateProject(p),/Invalid entity/)});
test('project rejects dangling constraints',()=>{const p={schema:2,name:'bad',entities:[entity('a')],constraints:[{id:'c',type:'fixed',parentId:'a',childId:'missing',relativeMatrix:identity()}],settings:{quality:'balanced'}};assert.throws(()=>validateProject(p),/references invalid entities/)});
test('project rejects multiple drivers',()=>{const p={schema:2,name:'bad',entities:[entity('a'),entity('b'),entity('c')],constraints:[{id:'c1',type:'fixed',parentId:'a',childId:'c',relativeMatrix:identity()},{id:'c2',type:'fixed',parentId:'b',childId:'c',relativeMatrix:identity()}],settings:{quality:'balanced'}};assert.throws(()=>validateProject(p),/more than one driving constraint/)});
test('project rejects constraint graph cycles',()=>{const p={schema:2,name:'bad',entities:[entity('a'),entity('b')],constraints:[{id:'c1',type:'fixed',parentId:'a',childId:'b',relativeMatrix:identity()},{id:'c2',type:'fixed',parentId:'b',childId:'a',relativeMatrix:identity()}],settings:{quality:'balanced'}};assert.throws(()=>validateProject(p),/cycle/)});
