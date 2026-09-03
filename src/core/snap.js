export const compatible=(a,b)=>{
  const pair=`${a.type}:${b.type}`;
  return ['hole:pin','pin:hole','socket:shaft','shaft:socket','hole:hole','socket:socket'].includes(pair);
};
export function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
export function distance(a,b){ return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]); }
export function rankSnapCandidates(sourceAttachments,targetAttachments,maxDistance=12){
  const out=[];
  for(let si=0;si<sourceAttachments.length;si++) for(let ti=0;ti<targetAttachments.length;ti++){
    const s=sourceAttachments[si],t=targetAttachments[ti]; if(!compatible(s,t))continue;
    const d=distance(s.worldPoint||s.point,t.worldPoint||t.point); if(d>maxDistance)continue;
    const axisScore=1-Math.abs(dot(s.worldAxis||s.axis,t.worldAxis||t.axis));
    out.push({sourceIndex:si,targetIndex:ti,distance:d,score:d+axisScore*2,source:s,target:t});
  }
  return out.sort((a,b)=>a.score-b.score);
}
