import test from 'node:test';
import assert from 'node:assert/strict';
import {diffSnapshots,applyDelta} from '../src/multiplayer.js';

const base={schema:2,name:'Robot',createdBy:'VEX CAD',entities:[{id:'a',partId:'p',matrix:Array(16).fill(0),hidden:false,locked:false,custom:null}],constraints:[],settings:{quality:'balanced'}};

test('multiplayer delta roundtrip handles add change delete',()=>{
  const next=structuredClone(base);
  next.name='Robot 2';
  next.entities[0].hidden=true;
  next.entities.push({id:'b',partId:'q',matrix:Array(16).fill(1),hidden:false,locked:false,custom:null});
  const delta=diffSnapshots(base,next);
  assert.ok(delta);
  assert.deepEqual(applyDelta(base,delta),next);
});

test('multiplayer delta deletion roundtrip',()=>{
  const next=structuredClone(base);next.entities=[];
  assert.deepEqual(applyDelta(base,diffSnapshots(base,next)),next);
});

test('unchanged project creates no delta',()=>assert.equal(diffSnapshots(base,structuredClone(base)),null));
