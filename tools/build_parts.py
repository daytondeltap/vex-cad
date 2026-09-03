#!/usr/bin/env python3
import argparse, hashlib, json, math, os, re, struct, sys, tempfile, urllib.request, zipfile
from pathlib import Path

import cadquery as cq

OFFICIAL_ZIP = 'https://link.vex.com/cad/STEP/VEX-IQ-All-Parts-STEP'
PART_RE = re.compile(r'\((228-[^)]+)\)')

def category_for(name: str) -> str:
    n = name.lower()
    rules = [
        ('Electronics', ('brain','motor','sensor','controller','battery','radio','cable','led','bumper switch')),
        ('Gears', ('gear','worm','differential')),
        ('Wheels', ('wheel','tire','hub')),
        ('Motion', ('shaft','axle','pulley','sprocket','chain','belt','spool','linear motion','actuator','bearing')),
        ('Pins & Connectors', ('pin','connector','standoff','spacer','bushing','collar')),
        ('Structure', ('beam','plate','panel','angle','corner','gusset','sheet')),
        ('Game & Field', ('field','goal','ball','cube','ring','game','rapid relay','mix & match')),
    ]
    for cat, keys in rules:
        if any(k in n for k in keys): return cat
    return 'Other'

def color_for(category: str):
    return {
        'Structure':'#2f73d9','Pins & Connectors':'#4c5563','Gears':'#f2c94c','Wheels':'#20242b',
        'Motion':'#9aa3ad','Electronics':'#30343b','Game & Field':'#e97736','Other':'#728095'
    }.get(category, '#728095')

def v3(t): return [round(float(t[0]),5),round(float(t[1]),5),round(float(t[2]),5)]
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def sub(a,b): return [a[i]-b[i] for i in range(3)]
def add(a,b): return [a[i]+b[i] for i in range(3)]
def mul(a,s): return [x*s for x in a]
def norm(a):
    m=math.sqrt(dot(a,a)) or 1.0
    return [x/m for x in a]
def dist(a,b): return math.sqrt(sum((a[i]-b[i])**2 for i in range(3)))

def dedupe_attachments(items):
    out=[]
    for a in items:
        keep=True
        for b in out:
            if a['type'] != b['type']: continue
            if dist(a['point'],b['point']) < 0.65 and abs(abs(dot(a['axis'],b['axis']))-1) < 0.03:
                keep=False; break
        if keep: out.append(a)
    return out

def extract_attachments(shape, name, bbox):
    n=name.lower(); attachments=[]
    male_pin = (' pin' in ' '+n or n.endswith('pin')) and 'pinion' not in n
    shaftlike = any(k in n for k in ('shaft','axle')) and 'bracket' not in n
    rotary = any(k in n for k in ('gear','wheel','pulley','sprocket','spool'))
    if not male_pin and not shaftlike:
        for face in shape.Faces():
            try:
                if face.geomType() != 'CYLINDER': continue
                ad=face._geomAdaptor(); cyl=ad.Cylinder(); r=float(cyl.Radius())
                if not (1.75 <= r <= 2.35): continue
                if float(face.Area()) < 12.0: continue
                ax=cyl.Axis(); loc=[ax.Location().X(),ax.Location().Y(),ax.Location().Z()]
                axis=norm([ax.Direction().X(),ax.Direction().Y(),ax.Direction().Z()])
                c=list(face.Center().toTuple()); t=dot(sub(c,loc),axis); p=add(loc,mul(axis,t))
                attachments.append({'type':'hole','point':v3(p),'axis':v3(axis),'radius':round(r,4),'verified':True,'source':'brep-cylinder'})
            except Exception:
                continue
    center=[(bbox[0][i]+bbox[1][i])*0.5 for i in range(3)]
    dims=[bbox[1][i]-bbox[0][i] for i in range(3)]
    if male_pin or shaftlike:
        major=max(range(3), key=lambda i:dims[i]); axis=[0.,0.,0.]; axis[major]=1.
        attachments.append({'type':'shaft' if shaftlike else 'pin','point':v3(center),'axis':axis,'verified':False,'source':'part-axis-heuristic'})
    if rotary:
        minor=min(range(3), key=lambda i:dims[i]); axis=[0.,0.,0.]; axis[minor]=1.
        attachments.append({'type':'socket','point':v3(center),'axis':axis,'verified':False,'source':'rotary-center-heuristic'})
    return dedupe_attachments(attachments)

def flatten_shape(obj):
    vals=obj.vals()
    if len(vals)==1: return vals[0]
    return cq.Compound.makeCompound(vals)

def tessellate_adaptive(shape, diag):
    tolerances=[max(0.12,min(0.45,diag*0.0015)), max(0.3,min(0.8,diag*0.003)), max(0.6,min(1.2,diag*0.006))]
    for tol in tolerances:
        verts,tris=shape.tessellate(tol,0.28)
        if len(tris) <= 90000: return verts,tris,tol
    return verts,tris,tolerances[-1]

def write_mesh(path, verts, tris, bbmin, bbmax):
    ext=[max(bbmax[i]-bbmin[i],1e-7) for i in range(3)]
    with open(path,'wb') as f:
        f.write(b'VXM1'); f.write(struct.pack('<II',len(verts),len(tris)*3)); f.write(struct.pack('<6f',*(bbmin+bbmax)))
        q=[]
        for v in verts:
            p=v.toTuple()
            q.extend(max(0,min(65535,round((p[i]-bbmin[i])/ext[i]*65535))) for i in range(3))
        f.write(struct.pack('<'+'H'*len(q),*q))
        inds=[i for tri in tris for i in tri]
        f.write(struct.pack('<'+'I'*len(inds),*inds))

def ensure_zip(path):
    if path and Path(path).exists(): return Path(path)
    target=Path(tempfile.gettempdir())/'VEX-IQ-All-Parts.zip'
    if not target.exists():
        print('Downloading official VEX IQ CAD archive...', flush=True)
        req=urllib.request.Request(OFFICIAL_ZIP,headers={'User-Agent':'VEX-CAD-build/1.0'})
        with urllib.request.urlopen(req,timeout=90) as r, open(target,'wb') as f:
            while True:
                chunk=r.read(1024*1024)
                if not chunk: break
                f.write(chunk)
    return target

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--zip'); ap.add_argument('--out',required=True); ap.add_argument('--limit',type=int,default=0)
    args=ap.parse_args(); zp=ensure_zip(args.zip); out=Path(args.out); meshdir=out/'mesh'; meshdir.mkdir(parents=True,exist_ok=True)
    parts=[]; failures=[]
    with zipfile.ZipFile(zp) as z:
        names=sorted([n for n in z.namelist() if n.lower().endswith(('.step','.stp'))])
        if args.limit: names=names[:args.limit]
        for idx,name in enumerate(names,1):
            base=Path(name).name; display=re.sub(r'\s*\(228-[^)]+\)\s*$','',Path(base).stem).strip(); m=PART_RE.search(base)
            pn=m.group(1) if m else f'unknown-{idx:04d}'
            uid=hashlib.sha1(base.encode()).hexdigest()[:10]; pid=f'{pn}-{uid}'
            tmp=Path(tempfile.gettempdir())/f'vex-{uid}.step'; tmp.write_bytes(z.read(name))
            try:
                obj=cq.importers.importStep(str(tmp)); shape=flatten_shape(obj); bb=shape.BoundingBox(); bbmin=[bb.xmin,bb.ymin,bb.zmin]; bbmax=[bb.xmax,bb.ymax,bb.zmax]
                diag=math.sqrt(sum((bbmax[i]-bbmin[i])**2 for i in range(3))); verts,tris,tol=tessellate_adaptive(shape,diag)
                meshname=f'{uid}.vxm'; write_mesh(meshdir/meshname,verts,tris,bbmin,bbmax)
                cat=category_for(display); attachments=extract_attachments(shape,display,(bbmin,bbmax))
                parts.append({'id':pid,'partNumber':pn,'name':display,'category':cat,'color':color_for(cat),'mesh':f'mesh/{meshname}',
                    'bbox':[v3(bbmin),v3(bbmax)],'vertices':len(verts),'triangles':len(tris),'tolerance':round(tol,4),'attachments':attachments})
            except Exception as e:
                failures.append({'file':base,'error':str(e)[:300]})
            finally:
                try: tmp.unlink()
                except: pass
            if idx%25==0 or idx==len(names): print(f'{idx}/{len(names)} parts, failures={len(failures)}',flush=True)
    manifest={'schema':2,'source':'VEX IQ official STEP archive','sourceUrl':'https://link.vex.com/cad/STEP/VEX-IQ-All-Parts-STEP',
      'partCount':len(parts),'verifiedBrepAttachments':sum(sum(1 for a in p['attachments'] if a.get('verified')) for p in parts),
      'parts':parts,'failures':failures}
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf8')
    print(json.dumps({'parts':len(parts),'failures':len(failures),'verifiedAttachments':manifest['verifiedBrepAttachments']}))
    if failures: sys.exit(2)
if __name__=='__main__': main()
