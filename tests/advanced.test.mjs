import test from 'node:test';
import assert from 'node:assert/strict';
import { inferGearTeeth, gearKinematics, driveMetrics, overallGearRatio } from '../src/simulation-core.js';
import { createTutorial, appendStep, diffSnapshots, validateTutorial } from '../src/tutorial-core.js';

const matrix=(x=0,y=0,z=0)=>[1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1];
const entity=(id,x=0)=>({id,partId:`p-${id}`,name:id,matrix:matrix(x,0,0),hidden:false,locked:false,custom:null});
const project=entities=>({schema:2,name:'Robot',entities,constraints:[],settings:{quality:'balanced'}});

test('gear tooth inference and kinematics',()=>{
  assert.equal(inferGearTeeth('36 Tooth Gear'),36);
  assert.equal(inferGearTeeth('12T Gear'),12);
  const chain=[{id:'a',teeth:12},{id:'b',teeth:36}];
  const out=gearKinematics(chain,120);
  assert.equal(overallGearRatio(chain),3);
  assert.equal(out[1].rpm,-40);
});

test('drive simulation respects ratio, incline and traction ceiling',()=>{
  const gears=[{teeth:12},{teeth:36}];
  const m=driveMetrics({gears,inputRpm:120,motorTorqueNm:.3,motorCount:2,efficiency:.8,wheelDiameterMm:100,massKg:4,wheelCount:4,inclineDeg:10,tractionCoefficient:.5});
  assert.equal(m.ratio,3);
  assert.equal(m.outputRpm,40);
  assert.ok(m.tractiveForceN<=m.tractionLimitN+1e-9);
  assert.ok(m.gradeForceN>0);
  assert.ok(m.staticLoadPerWheelN>0);
});

test('tutorial snapshots detect added, moved and removed entities',()=>{
  const s1=project([entity('a',0)]),s2=project([entity('a',25),entity('b',5)]),s3=project([entity('b',5)]);
  const d12=diffSnapshots(s1,s2);
  assert.deepEqual(d12.added,['b']);
  assert.deepEqual(d12.moved,['a']);
  assert.equal(d12.arrows.length,2);
  const d23=diffSnapshots(s2,s3);
  assert.deepEqual(d23.removed,['a']);
});

test('tutorial builder appends local steps with deterministic diffs',()=>{
  const t=createTutorial('Drive Base');
  const first=appendStep(t,project([entity('a',0)]));
  const second=appendStep(t,project([entity('a',10),entity('b',4)]));
  assert.equal(first.number,1);
  assert.equal(second.number,2);
  assert.equal(second.changes.moved.includes('a'),true);
  assert.equal(second.changes.added.includes('b'),true);
  assert.equal(validateTutorial(t),t);
});
