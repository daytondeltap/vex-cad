export class CADImporter {
  constructor(){this.seq=0;this.pending=[];this.worker=null;}
  #ensure(){
    if(this.worker)return; const url=new URL('./occt/occt-import-js-worker.js',document.baseURI);this.worker=new Worker(url);
    this.worker.onmessage=e=>{const p=this.pending.shift();if(!p)return;if(e.data?.error)p.reject(new Error(e.data.error));else p.resolve(e.data?.result||e.data);};
    this.worker.onerror=e=>{const p=this.pending.shift();p?.reject(new Error(e.message||'OpenCascade worker failed'));};
  }
  import(file,quality='balanced'){
    const max=90*1024*1024;if(file.size>max)return Promise.reject(new Error('CAD import is limited to 90 MB per file to protect browser memory.'));
    const ext=file.name.split('.').pop().toLowerCase();const format=ext==='stp'||ext==='step'?'step':ext==='igs'||ext==='iges'?'iges':ext==='brep'||ext==='brp'?'brep':null;if(!format)return Promise.reject(new Error('Supported CAD formats: STEP/STP, IGES/IGS, BREP/BRP.'));
    this.#ensure();const params={linearUnit:'millimeter',linearDeflectionType:'bounding_box_ratio',linearDeflection:quality==='low'?0.0035:quality==='high'?0.0012:0.0022,angularDeflection:quality==='low'?0.45:0.3};
    return file.arrayBuffer().then(buffer=>new Promise((resolve,reject)=>{this.pending.push({resolve,reject});const bytes=new Uint8Array(buffer);this.worker.postMessage({format,buffer:bytes,params},[bytes.buffer]);}));
  }
}
