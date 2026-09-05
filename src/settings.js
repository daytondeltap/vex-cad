export const DEFAULT_SETTINGS = Object.freeze({
  controlsPreset: 'standard',
  materialStyle: 'studio',
  exposure: 1.05,
  shadowMode: 'auto',
  showGrid: true,
  showAxes: true,
  lookSensitivity: 0.72,
  moveSpeed: 150,
  panSensitivity: 1,
  invertY: false,
  proximitySnap: true,
  snapDistance: 28,
  snapAngle: 110,
  snapPinHolePriority: true,
  bindings: Object.freeze({
    forward: 'w',
    back: 's',
    left: 'a',
    right: 'd',
    up: 'e',
    down: 'q',
    cycleTransform: 'r',
    moveTool: 'm',
    rotateTool: 't',
    fit: 'f',
    delete: 'delete'
  })
});

const CONTROL_PRESETS = new Set(['standard','roblox']);
const MATERIAL_STYLES = new Set(['studio','matte','glossy']);
const SHADOW_MODES = new Set(['auto','on','off']);
const clamp=(n,min,max,fallback)=>Number.isFinite(Number(n))?Math.min(max,Math.max(min,Number(n))):fallback;

export function normalizeBinding(value,fallback){
  if(typeof value!=='string')return fallback;
  const key=value.trim().toLowerCase();
  if(!key||key.length>24)return fallback;
  return key===' ' ? 'space' : key;
}

export function normalizeSettings(raw={}){
  const bindings={};
  for(const [action,def] of Object.entries(DEFAULT_SETTINGS.bindings))bindings[action]=normalizeBinding(raw?.bindings?.[action],def);
  return {
    controlsPreset: CONTROL_PRESETS.has(raw.controlsPreset)?raw.controlsPreset:DEFAULT_SETTINGS.controlsPreset,
    materialStyle: MATERIAL_STYLES.has(raw.materialStyle)?raw.materialStyle:DEFAULT_SETTINGS.materialStyle,
    exposure: clamp(raw.exposure,.55,1.8,DEFAULT_SETTINGS.exposure),
    shadowMode: SHADOW_MODES.has(raw.shadowMode)?raw.shadowMode:DEFAULT_SETTINGS.shadowMode,
    showGrid: raw.showGrid!==false,
    showAxes: raw.showAxes!==false,
    lookSensitivity: clamp(raw.lookSensitivity,.1,2.5,DEFAULT_SETTINGS.lookSensitivity),
    moveSpeed: clamp(raw.moveSpeed,20,800,DEFAULT_SETTINGS.moveSpeed),
    panSensitivity: clamp(raw.panSensitivity,.2,3,DEFAULT_SETTINGS.panSensitivity),
    invertY: !!raw.invertY,
    proximitySnap: raw.proximitySnap!==false,
    snapDistance: clamp(raw.snapDistance,4,60,DEFAULT_SETTINGS.snapDistance),
    snapAngle: clamp(raw.snapAngle,5,180,DEFAULT_SETTINGS.snapAngle),
    snapPinHolePriority: raw.snapPinHolePriority!==false,
    bindings
  };
}

export function eventKey(event){
  const key=String(event?.key||'').toLowerCase();
  if(key===' ')return 'space';
  return key;
}

export function keyMatches(event,binding){return eventKey(event)===normalizeBinding(binding,'');}

export function loadSettings(storage=globalThis.localStorage){
  try{return normalizeSettings(JSON.parse(storage?.getItem?.('vex-cad-settings')||'{}'));}
  catch{return normalizeSettings();}
}

export function saveSettings(settings,storage=globalThis.localStorage){
  const clean=normalizeSettings(settings);
  try{storage?.setItem?.('vex-cad-settings',JSON.stringify(clean));}catch{}
  return clean;
}
