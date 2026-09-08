export const dist3=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));

export function isReceptacle(a){return a?.type==='hole'||a?.type==='socket';}
export function isConnector(a){return a?.type==='pin'||a?.type==='shaft';}

// Receptacles need real connecting hardware. In particular, two bare beam
// holes are not a connection just because their centers happen to coincide.
export function compatible(a,b){
  if(!a||!b)return false;
  const x=a.type,y=b.type;
  if(isReceptacle(a)&&isReceptacle(b))return false;
  if((x==='pin'&&y==='hole')||(x==='hole'&&y==='pin'))return true;
  if((x==='pin'&&y==='socket')||(x==='socket'&&y==='pin'))return true;
  if((x==='shaft'&&(y==='hole'||y==='socket'))||(y==='shaft'&&(x==='hole'||x==='socket')))return true;
  // Shaft-to-shaft is retained for explicit axle continuation points. Generic
  // pin-to-pin remains physically invalid.
  return x==='shaft'&&y==='shaft';
}

export function projectedSpan(bbox,axis){
  if(!Array.isArray(bbox)||bbox.length!==2||!Array.isArray(axis))return 0;
  const a=norm(axis),lo=bbox[0],hi=bbox[1];let min=Infinity,max=-Infinity;
  for(let mask=0;mask<8;mask++){
    const p=[mask&1?hi[0]:lo[0],mask&2?hi[1]:lo[1],mask&4?hi[2]:lo[2]],d=dot(p,a);
    min=Math.min(min,d);max=Math.max(max,d);
  }
  return Number.isFinite(max-min)?Math.max(0,max-min):0;
}

export function connectorLength(def,a){
  const explicit=Number(a?.length);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  return isConnector(a)?projectedSpan(def?.bbox,a.axis):0;
}

export function receptacleDepth(def,a){
  if(!isReceptacle(a))return 0;
  const explicit=Number(a?.depth);if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const span=projectedSpan(def?.bbox,a.axis);
  // A structural IQ hole is about one beam layer deep. Protect against a bad
  // detected axis accidentally interpreting the whole beam length as depth.
  return Math.min(span,6.35);
}

export function sameAttachment(a,b,pointTolerance=.45,axisTolerance=.04){
  if(!a||!b||a.type!==b.type||!Array.isArray(a.point)||!Array.isArray(b.point))return false;
  if(dist3(a.point,b.point)>pointTolerance)return false;
  const aa=norm(a.axis||[0,0,1]),bb=norm(b.axis||[0,0,1]);
  return 1-Math.abs(dot(aa,bb))<=axisTolerance;
}

export function intervalsOverlap(a,b,epsilon=.08){return a.min<b.max-epsilon&&b.min<a.max-epsilon;}

// Returns the axial center for a new receptacle on a connector whose local
// axial interval is [-length/2,+length/2]. This is a tiny 1-D packing problem:
// use real occupied hole depths rather than a fixed "number of beams" guess.
export function findFreeConnectorOffset(length,newDepth,occupied=[]){
  length=Number(length);newDepth=Number(newDepth);
  if(!(length>0&&newDepth>0)||newDepth>length+.08)return null;
  const half=length/2,lo=-half+newDepth/2,hi=half-newDepth/2;
  const blocked=occupied.map(x=>({min:Number(x.center)-Number(x.depth)/2,max:Number(x.center)+Number(x.depth)/2})).filter(x=>Number.isFinite(x.min)&&Number.isFinite(x.max));
  const candidates=[lo,hi,0,...blocked.flatMap(x=>[x.min-newDepth/2,x.max+newDepth/2])].map(x=>clamp(x,lo,hi));
  const uniq=[...new Set(candidates.map(x=>Math.round(x*1000)/1000))];
  const valid=uniq.filter(center=>!blocked.some(b=>intervalsOverlap({min:center-newDepth/2,max:center+newDepth/2},b)));
  if(!valid.length)return null;
  // Prefer ends first so a short 1x1 pin can naturally bridge two layers.
  valid.sort((a,b)=>Math.abs(b)-Math.abs(a)||a-b);
  return valid[0];
}

export function canFitConnector(length,occupiedDepths,newDepth){
  const occupied=[];
  for(const d of occupiedDepths||[]){const c=findFreeConnectorOffset(length,d,occupied);if(c==null)return false;occupied.push({center:c,depth:d});}
  return findFreeConnectorOffset(length,newDepth,occupied)!=null;
}

export function rankSnapCandidates(sourceAttachments,targetAttachments,maxDistance=18){
  const out=[];
  for(const s of sourceAttachments||[])for(const t of targetAttachments||[]){
    if(!compatible(s,t))continue;const d=dist3(s.point,t.point);if(d>maxDistance)continue;
    const sa=norm(s.axis),ta=norm(t.axis),alignment=Math.abs(dot(sa,ta));
    out.push({source:s,target:t,distance:d,alignment,score:d+(1-alignment)*6});
  }
  out.sort((a,b)=>a.score-b.score);return out;
}
