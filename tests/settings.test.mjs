import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, keyMatches } from '../src/settings.js';

test('settings normalization clamps unsafe values and fills bindings',()=>{
  const s=normalizeSettings({controlsPreset:'roblox',lookSensitivity:99,moveSpeed:-10,bindings:{forward:'ArrowUp',cycleTransform:''}});
  assert.equal(s.controlsPreset,'roblox');
  assert.equal(s.lookSensitivity,2.5);
  assert.equal(s.moveSpeed,20);
  assert.equal(s.bindings.forward,'arrowup');
  assert.equal(s.bindings.cycleTransform,DEFAULT_SETTINGS.bindings.cycleTransform);
});

test('settings normalization rejects unknown render modes',()=>{
  const s=normalizeSettings({materialStyle:'neon',shadowMode:'maybe'});
  assert.equal(s.materialStyle,'studio');
  assert.equal(s.shadowMode,'auto');
});

test('proximity snapping settings clamp and can be disabled',()=>{
  const s=normalizeSettings({proximitySnap:false,snapDistance:999,snapAngle:-5,snapPinHolePriority:false});
  assert.equal(s.proximitySnap,false);
  assert.equal(s.snapDistance,60);
  assert.equal(s.snapAngle,5);
  assert.equal(s.snapPinHolePriority,false);
});

test('key matching is case insensitive and handles space',()=>{
  assert.equal(keyMatches({key:'R'},'r'),true);
  assert.equal(keyMatches({key:' '},'space'),true);
  assert.equal(keyMatches({key:'T'},'r'),false);
});
