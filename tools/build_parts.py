#!/usr/bin/env python3
import argparse, hashlib, json, math, re, struct, sys, tempfile, zipfile
from pathlib import Path

import cadquery as cq

PART_RE = re.compile(r'(228(?:-[A-Za-z0-9]+){1,5})', re.IGNORECASE)
LFS_PREFIX = b'version https://git-lfs.github.com/spec/v1'
MAX_FAILURE_RATIO = 0.10
MIN_USABLE_PARTS = 50


def category_for(name: str) -> str:
    n = name.lower()
    rules = [
        ('Electronics', ('brain','motor','sensor','controller','battery','radio','cable','led','bumper switch')),
        ('Gears', ('gear','worm','differential')),
        ('Wheels', ('wheel','tire','hub')),
        ('Motion', ('shaft','axle','pulley','sprocket','chain','belt','spool','linear motion','actuator','bearing','turntable','tread','intake')),
        ('Pins & Connectors', ('pin','connector','standoff','spacer','bushing','collar')),
        ('Structure', ('beam','plate','panel','angle','corner','gusset','sheet','structure','truss')),
        ('Game & Field', ('field','goal','ball','cube','ring','game','rapid relay','mix & match')),
    ]
    for cat, keys in rules:
        if any(k in n for k in keys):
            return cat
    return 'Other'


def color_for(category: str):
    return {
        'Structure':'#2f73d9','Pins & Connectors':'#4c5563','Gears':'#f2c94c','Wheels':'#20242b',
        'Motion':'#9aa3ad','Electronics':'#30343b','Game & Field':'#e97736','Other':'#728095'
    }.get(category, '#728095')


def v3(t):
    return [round(float(t[0]),5), round(float(t[1]),5), round(float(t[2]),5)]


def dot(a,b):
    return sum(x*y for x,y in zip(a,b))


def sub(a,b):
    return [a[i]-b[i] for i in range(3)]


def add(a,b):
    return [a[i]+b[i] for i in range(3)]


def mul(a,s):
    return [x*s for x in a]


def norm(a):
    m=math.sqrt(dot(a,a)) or 1.0
    return [x/m for x in a]


def dist(a,b):
    return math.sqrt(sum((a[i]-b[i])**2 for i in range(3)))


def dedupe_attachments(items):
    out=[]
    for a in items:
        keep=True
        for b in out:
            if a['type'] != b['type']:
                continue
            if dist(a['point'],b['point']) < 0.65 and abs(abs(dot(a['axis'],b['axis']))-1) < 0.03:
                keep=False
                break
        if keep:
            out.append(a)
    return out


def standoff_end_attachments(name, bbox):
    """Return the two real male insertion ends on a pitch standoff.

    Standoffs are connector hardware, not bare structure. Each end is emitted
    as its own explicit ``standoff`` attachment so snapping and Auto Align can
    target either male end independently while still enforcing insertion length.
    """
    n=name.lower()
    if 'standoff' not in n or 'standoff connector' in n or 'extender' in n:
        return []
    dims=[bbox[1][i]-bbox[0][i] for i in range(3)]
    major=max(range(3), key=lambda i:dims[i])
    pin_length=min(6.14,max(2.0,dims[major]*0.45))
    out=[]
    for sign in (-1,1):
        axis=[0.,0.,0.]; axis[major]=float(sign)
        point=[(bbox[0][i]+bbox[1][i])*0.5 for i in range(3)]
        point[major]=(bbox[0][major]+pin_length*0.5) if sign<0 else (bbox[1][major]-pin_length*0.5)
        out.append({'type':'standoff','point':v3(point),'axis':axis,'radius':2.1,'length':round(pin_length,4),
                    'verified':True,'source':'standoff-end-geometry'})
    return out


def extract_attachments(shape, name, bbox):
    n=name.lower(); attachments=[]
    male_pin = (' pin' in ' '+n or n.endswith('pin')) and 'pinion' not in n
    shaftlike = any(k in n for k in ('shaft','axle')) and 'bracket' not in n
    rotary = any(k in n for k in ('gear','wheel','pulley','sprocket','spool','turntable'))
    if not male_pin and not shaftlike:
        for face in shape.Faces():
            try:
                if face.geomType() != 'CYLINDER':
                    continue
                ad=face._geomAdaptor(); cyl=ad.Cylinder(); r=float(cyl.Radius())
                if not (1.75 <= r <= 2.35):
                    continue
                if float(face.Area()) < 12.0:
                    continue
                ax=cyl.Axis(); loc=[ax.Location().X(),ax.Location().Y(),ax.Location().Z()]
                axis=norm([ax.Direction().X(),ax.Direction().Y(),ax.Direction().Z()])
                c=list(face.Center().toTuple()); t=dot(sub(c,loc),axis); p=add(loc,mul(axis,t))
                attachments.append({'type':'hole','point':v3(p),'axis':v3(axis),'radius':round(r,4),'verified':True,'source':'brep-cylinder'})
            except Exception:
                continue
    center=[(bbox[0][i]+bbox[1][i])*0.5 for i in range(3)]
    dims=[bbox[1][i]-bbox[0][i] for i in range(3)]
    attachments.extend(standoff_end_attachments(name,bbox))
    if male_pin or shaftlike:
        major=max(range(3), key=lambda i:dims[i]); axis=[0.,0.,0.]; axis[major]=1.
        attachments.append({'type':'shaft' if shaftlike else 'pin','point':v3(center),'axis':axis,'verified':False,'source':'part-axis-heuristic'})
    if rotary:
        minor=min(range(3), key=lambda i:dims[i]); axis=[0.,0.,0.]; axis[minor]=1.
        attachments.append({'type':'socket','point':v3(center),'axis':axis,'verified':False,'source':'rotary-center-heuristic'})
    return dedupe_attachments(attachments)


def flatten_shape(obj):
    vals=obj.vals()
    if not vals:
        raise RuntimeError('STEP import produced no shapes')
    if len(vals)==1:
        return vals[0]
    return cq.Compound.makeCompound(vals)


def tessellate_adaptive(shape, diag):
    passes=[
        (max(0.12,min(0.45,diag*0.0015)),0.28),
        (max(0.30,min(0.80,diag*0.0030)),0.36),
        (max(0.60,min(1.20,diag*0.0060)),0.48),
        (max(1.20,min(2.50,diag*0.0100)),0.65),
        (max(1.80,min(4.00,diag*0.0180)),0.85),
        (max(3.00,min(6.00,diag*0.0300)),1.05),
        (max(5.00,min(10.0,diag*0.0500)),1.30),
        (max(8.00,min(16.0,diag*0.0800)),1.55),
    ]
    last=None
    for tol,ang in passes:
        verts,tris=shape.tessellate(tol,ang)
        last=(verts,tris,tol)
        if verts and tris and len(tris) <= 90000:
            return last
    if last is None or not last[0] or not last[1]:
        raise RuntimeError('tessellation produced no mesh')
    raise RuntimeError(f'mesh exceeds 90000 triangle budget ({len(last[1])})')


def write_mesh(path, verts, tris, bbmin, bbmax):
    ext=[max(bbmax[i]-bbmin[i],1e-7) for i in range(3)]
    with open(path,'wb') as f:
        f.write(b'VXM1')
        f.write(struct.pack('<II',len(verts),len(tris)*3))
        f.write(struct.pack('<6f',*(bbmin+bbmax)))
        q=[]
        for v in verts:
            p=v.toTuple()
            q.extend(max(0,min(65535,round((p[i]-bbmin[i])/ext[i]*65535))) for i in range(3))
        f.write(struct.pack('<'+'H'*len(q),*q))
        inds=[i for tri in tris for i in tri]
        f.write(struct.pack('<'+'I'*len(inds),*inds))


def clean_display(zip_name, part_number):
    p=Path(zip_name)
    stem=p.stem.strip()
    stem=re.sub(r'\s*\(228-[^)]+\)\s*$','',stem).strip()
    if not stem or stem.lower()==part_number.lower() or stem.lower().startswith(part_number.lower()):
        parent=p.parent.name
        parent=re.sub(r'\s*step\s*$','',parent,flags=re.I).strip()
        if parent and parent.lower() not in ('main','repo'):
            return f'{parent} {part_number}'.strip()
        return part_number
    return stem


def classify_source_bytes(data: bytes):
    stripped=data.lstrip()
    if not stripped:
        return 'empty-source'
    if stripped.startswith(LFS_PREFIX):
        return 'git-lfs-pointer'
    head=stripped[:4096].upper()
    if b'ISO-10303-21' not in head:
        return 'invalid-step-header'
    return None


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--zip',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--limit',type=int,default=0)
    ap.add_argument('--strict',action='store_true',help='fail on any source conversion failure')
    args=ap.parse_args()
    zp=Path(args.zip)
    if not zp.exists():
        raise FileNotFoundError(zp)
    out=Path(args.out); meshdir=out/'mesh'; meshdir.mkdir(parents=True,exist_ok=True)
    parts=[]; failures=[]; seen_basenames=set()
    with zipfile.ZipFile(zp) as z:
        raw_names=sorted([n for n in z.namelist() if n.lower().endswith(('.step','.stp'))])
        names=[]
        for n in raw_names:
            key=Path(n).name.lower()
            if key in seen_basenames:
                continue
            seen_basenames.add(key)
            names.append(n)
        if args.limit:
            names=names[:args.limit]
        for idx,name in enumerate(names,1):
            base=Path(name).name
            m=PART_RE.search(base)
            pn=m.group(1) if m else f'unknown-{idx:04d}'
            display=clean_display(name,pn)
            uid=hashlib.sha1(name.encode('utf8')).hexdigest()[:10]
            pid=f'{pn}-{uid}'
            tmp=Path(tempfile.gettempdir())/f'vex-{uid}.step'
            data=z.read(name)
            source_issue=classify_source_bytes(data)
            if source_issue:
                failures.append({'file':base,'kind':source_issue,'error':f'source entry skipped: {source_issue}'})
                print(f'WARN {base}: {source_issue}', flush=True)
                continue
            tmp.write_bytes(data)
            try:
                obj=cq.importers.importStep(str(tmp)); shape=flatten_shape(obj)
                bb=shape.BoundingBox(); bbmin=[bb.xmin,bb.ymin,bb.zmin]; bbmax=[bb.xmax,bb.ymax,bb.zmax]
                if not all(math.isfinite(x) for x in bbmin+bbmax):
                    raise RuntimeError('non-finite bounding box')
                diag=math.sqrt(sum((bbmax[i]-bbmin[i])**2 for i in range(3)))
                if not math.isfinite(diag) or diag <= 0:
                    raise RuntimeError('invalid zero/negative bounding box')
                verts,tris,tol=tessellate_adaptive(shape,diag)
                meshname=f'{uid}.vxm'; write_mesh(meshdir/meshname,verts,tris,bbmin,bbmax)
                cat=category_for(display); attachments=extract_attachments(shape,display,(bbmin,bbmax))
                parts.append({'id':pid,'partNumber':pn,'name':display,'category':cat,'color':color_for(cat),'mesh':f'mesh/{meshname}',
                              'bbox':[v3(bbmin),v3(bbmax)],'vertices':len(verts),'triangles':len(tris),'attachments':attachments})
                print(f'[{idx}/{len(names)}] {pn}: {len(tris)} tris, {len(attachments)} attachments', flush=True)
            except Exception as e:
                failures.append({'file':base,'kind':'conversion-error','error':str(e)})
                print(f'WARN {base}: {e}', flush=True)
            finally:
                tmp.unlink(missing_ok=True)
    if not parts:
        raise RuntimeError('No VEX parts were converted')
    failure_ratio=len(failures)/max(1,len(names))
    if args.strict and failures:
        raise RuntimeError(f'{len(failures)} source parts failed in strict mode')
    if len(parts)<MIN_USABLE_PARTS:
        raise RuntimeError(f'Only {len(parts)} usable VEX parts were converted; expected at least {MIN_USABLE_PARTS}')
    if failure_ratio>MAX_FAILURE_RATIO:
        raise RuntimeError(f'{len(failures)}/{len(names)} VEX sources failed ({failure_ratio:.1%}), above {MAX_FAILURE_RATIO:.0%} limit')
    manifest={'schema':1,'partCount':len(parts),'verifiedBrepAttachments':sum(sum(1 for a in p['attachments'] if a.get('verified')) for p in parts),'parts':parts,
              'failedCount':len(failures),'failures':failures}
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    print(f'Built {len(parts)} parts with {manifest["verifiedBrepAttachments"]} verified BREP axes; {len(failures)} source failures.', flush=True)
    if failures:
        kinds={}
        for f in failures:kinds[f['kind']]=kinds.get(f['kind'],0)+1
        print('Failure breakdown: '+', '.join(f'{k}={v}' for k,v in sorted(kinds.items())), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
