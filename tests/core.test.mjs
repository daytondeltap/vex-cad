import test from 'node:test'; import assert from 'node:assert/strict';
import {History,command} from '../src/core/history.js';
import {compatible,rankSnapCandidates} from '../src/core/snap.js';
import {wouldCreateCycle} from '../src/core/constraints.js';
import {serializeProject,validateProject} from '../src/core/project.js';
test('history undo redo',()=>{let n=0;const h=new History();h.execute(command('x',()=>n++,()=>n--));assert.equal(n,1);h.undo();assert.equal(n,0);h.redo();assert.equal(n,1)});
test('snap compatibility/ranking',()=>{assert.equal(compatible({type:'pin'},{type:'hole'}),true);const r=rankSnapCandidates([{type:'pin',point:[0,0,0],axis:[1,0,0]}],[{type:'hole',point:[2,0,0],axis:[-1,0,0]}],5);assert.equal(r.length,1);assert.equal(r[0].distance,2)});
test('constraint cycle',()=>{const cs=[{parentId:'a',childId:'b'},{parentId:'b',childId:'c'}];assert.equal(wouldCreateCycle(cs,'c','a'),true);assert.equal(wouldCreateCycle(cs,'a','d'),false)});
test('project roundtrip validates',()=>{const state={entities:new Map([['a',{id:'a',partId:'p',name:'x',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]]),constraints:[],quality:'low'};assert.equal(validateProject(serializeProject(state)).entities.length,1)});
