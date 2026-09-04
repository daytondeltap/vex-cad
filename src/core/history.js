export class History {
  constructor(limit=200){ this.undoStack=[]; this.redoStack=[]; this.limit=limit; }
  execute(command){ command.do(); this.undoStack.push(command); if(this.undoStack.length>this.limit)this.undoStack.shift(); this.redoStack.length=0; }
  record(command){ this.undoStack.push(command); if(this.undoStack.length>this.limit)this.undoStack.shift(); this.redoStack.length=0; }
  undo(){ const c=this.undoStack.pop(); if(!c)return false; c.undo(); this.redoStack.push(c); return true; }
  redo(){ const c=this.redoStack.pop(); if(!c)return false; c.do(); this.undoStack.push(c); return true; }
  clear(){ this.undoStack.length=0; this.redoStack.length=0; }
}
export const command=(label,doFn,undoFn)=>({label,do:doFn,undo:undoFn});
