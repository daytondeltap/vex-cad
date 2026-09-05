const EPS=1e-9;
const vec3=v=>Array.isArray(v)&&v.length===3?v:[0,0,0];
const normalized=v=>{const a=vec3(v),m=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/m,a[1]/m,a[2]/m];};

export const isConnector=a=>a?.type==='pin'||a?.type==='shaft';
export const isReceptacle=a=>a?.type==='hole'||a?.type==='socket';

export const compatible=(a,b)=>{
  const pair=`${a?.type}:${b?.type}`;
  // Physical connection hardware is required. Two empty holes (or sockets)
  // never form a connection by themselves.
  return ['hole:pin','pin:hole','socket:shaft','shaft:socket'].includes(pair);
};

export function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
export function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}

export function sameAttachment(a,b,{pointTolerance=.08,axisTolerance=.002}={}){
  if(!a||!b||a.type!==b.type)return false;
  if(distance(vec3(a.point),vec3(b.point))>pointTolerance)return false;
  const aa=normalized(a.axis),ba=normalized(b.axis);
  return 1-Math.abs(dot(aa,ba))<=axisTolerance;
}

export function projectedSpan(def,attachment){
  const bbox=def?.bbox;
  if(!Array.isArray(bbox)||bbox.length!==2)return 0;
  const lo=bbox[0],hi=bbox[1];
  if(!lo?.every?.(Number.isFinite)||!hi?.every?.(Number.isFinite))return 0;
  const axis=normalized(attachment?.axis||[0,0,1]);
  let min=Infinity,max=-Infinity;
  for(const x of [lo[0],hi[0]])for(const y of [lo[1],hi[1]])for(const z of [lo[2],hi[2]]){
    const p=x*axis[0]+y*axis[1]+z*axis[2];min=Math.min(min,p);max=Math.max(max,p);
  }
  return Number.isFinite(min)&&Number.isFinite(max)?Math.max(0,max-min):0;
}

export function connectorLength(def,attachment){
  const explicit=Number(attachment?.length);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const span=projectedSpan(def,attachment);
  // The currently shipped VEX IQ connector family tops out at about 25 mm.
  // Capping inferred pin length prevents a heuristic axis on a large part from
  // being mistaken for an impossibly long connector.
  return attachment?.type==='pin'?Math.min(span,25.4):span;
}

export function receptacleDepth(def,attachment){
  const explicit=Number(attachment?.depth);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const span=projectedSpan(def,attachment);
  // VEX IQ beam/plate pin holes are normally one structural layer deep
  // (~6.1 mm). BREP axes sometimes run across the whole part bbox, so cap
  // inferred hole depth conservatively instead of treating a long beam as a
  // 100+ mm-deep hole.
  return attachment?.type==='hole'?Math.min(span,6.35):span;
}

export function findFreeConnectorOffset(length,newDepth,occupied=[],tolerance=.18){
  length=Number(length);newDepth=Number(newDepth);
  if(!(length>0&&newDepth>0)||newDepth>length+tolerance)return null;
  const half=length/2;
  const spans=(occupied||[]).map(o=>{
    const center=Number(o?.center)||0,depth=Math.max(0,Number(o?.depth)||0);
    return [Math.max(-half,center-depth/2),Math.min(half,center+depth/2)];
  }).filter(([a,b])=>b>a+EPS).sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const span of spans){
    const last=merged[merged.length-1];
    if(last&&span[0]<=last[1]+tolerance*.25)last[1]=Math.max(last[1],span[1]);
    else merged.push([...span]);
  }
  const gaps=[];let cursor=-half;
  for(const [a,b] of merged){if(a>cursor)gaps.push([cursor,a]);cursor=Math.max(cursor,b);}
  if(cursor<half)gaps.push([cursor,half]);
  for(const [a,b] of gaps){
    if(b-a+tolerance<newDepth)continue;
    // Pack against the nearest free end so remaining connector length stays
    // contiguous for another beam instead of overlapping the current beam.
    return Math.min(b-newDepth/2,a+newDepth/2);
  }
  return null;
}

export function canFitConnector(length,occupiedDepths,newDepth,tolerance=.18){
  const occupied=(occupiedDepths||[]).map((depth,i)=>({
    depth:Number(depth)||0,
    center:-Number(length)/2+(occupiedDepths.slice(0,i).reduce((n,d)=>n+(Number(d)||0),0))+(Number(depth)||0)/2
  }));
  return findFreeConnectorOffset(length,newDepth,occupied,tolerance)!==null;
}

export function rankSnapCandidates(sourceAttachments,targetAttachments,maxDistance=12){
  const out=[];
  for(let si=0;si<sourceAttachments.length;si++)for(let ti=0;ti<targetAttachments.length;ti++){
    const s=sourceAttachments[si],t=targetAttachments[ti];if(!compatible(s,t))continue;
    const d=distance(s.worldPoint||s.point,t.worldPoint||t.point);if(d>maxDistance)continue;
    const axisScore=1-Math.abs(dot(s.worldAxis||s.axis,t.worldAxis||t.axis));
    out.push({sourceIndex:si,targetIndex:ti,distance:d,score:d+axisScore*2,source:s,target:t});
  }
  return out.sort((a,b)=>a.score-b.score);
}
