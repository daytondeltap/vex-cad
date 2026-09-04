const SUPABASE_URL='https://piwotkegieppufyyeslw.supabase.co';
const SUPABASE_KEY='sb_publishable_I2OeeCo-m59i_xi4yKfh8w_13V8ZPFO';
const MAX_BROADCAST_BYTES=180_000;
const MAX_SEEN_OPS=1500;

const deepClone=v=>structuredClone(v);
const stable=v=>JSON.stringify(v);

function mapById(items=[]){return new Map(items.map(x=>[x.id,x]));}

export function diffSnapshots(previous,next){
  if(!previous)return {full:deepClone(next)};
  const before=mapById(previous.entities),after=mapById(next.entities),upserts=[],deletes=[];
  for(const [id,e] of after){const old=before.get(id);if(!old||stable(old)!==stable(e))upserts.push(deepClone(e));}
  for(const id of before.keys())if(!after.has(id))deletes.push(id);
  const delta={schema:1};
  if(upserts.length)delta.upserts=upserts;
  if(deletes.length)delta.deletes=deletes;
  if(stable(previous.constraints)!==stable(next.constraints))delta.constraints=deepClone(next.constraints);
  if(previous.name!==next.name)delta.name=next.name;
  if(stable(previous.settings)!==stable(next.settings))delta.settings=deepClone(next.settings||{});
  return Object.keys(delta).length===1?null:delta;
}

export function applyDelta(snapshot,delta){
  if(delta?.full)return deepClone(delta.full);
  const next=deepClone(snapshot);
  const entities=mapById(next.entities);
  for(const id of delta?.deletes||[])entities.delete(id);
  for(const e of delta?.upserts||[])entities.set(e.id,deepClone(e));
  next.entities=[...entities.values()];
  if(delta?.constraints)next.constraints=deepClone(delta.constraints);
  if(typeof delta?.name==='string')next.name=delta.name;
  if(delta?.settings)next.settings=deepClone(delta.settings);
  return next;
}

function randomBytes(length){const a=new Uint8Array(length);crypto.getRandomValues(a);return a;}
function base64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function randomCode(length=10){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=randomBytes(length);return [...bytes].map(b=>chars[b%chars.length]).join('');}
async function sha256(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function uuid(){return crypto.randomUUID();}

export class MultiplayerClient{
  constructor({onSnapshot,onPresence,onCursor,onStatus}={}){
    this.onSnapshot=onSnapshot||(()=>{});this.onPresence=onPresence||(()=>{});this.onCursor=onCursor||(()=>{});this.onStatus=onStatus||(()=>{});
    this.actorId=localStorage.getItem('vex-cad-actor-id')||`actor-${uuid()}`;localStorage.setItem('vex-cad-actor-id',this.actorId);
    this.displayName=localStorage.getItem('vex-cad-display-name')||`Builder ${this.actorId.slice(-4).toUpperCase()}`;
    this.client=null;this.channel=null;this.room=null;this.lastSnapshot=null;this.seenOps=new Set();this.saveTimer=0;this.cursorTimer=0;this.pendingCursor=null;this.connected=false;this.applyingRemote=false;
  }
  sdkAvailable(){return !!globalThis.supabase?.createClient;}
  setDisplayName(name){this.displayName=(String(name||'').trim().slice(0,32)||this.displayName);localStorage.setItem('vex-cad-display-name',this.displayName);if(this.connected)this.trackPresence().catch(()=>{});}
  #ensureClient(){if(!this.sdkAvailable())throw new Error('Supabase realtime library is unavailable');if(!this.client)this.client=globalThis.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{params:{eventsPerSecond:20}}});return this.client;}
  async #rpc(name,args){const client=this.#ensureClient();const {data,error}=await client.rpc(name,args);if(error)throw new Error(error.message||`${name} failed`);return data;}
  async createRoom(snapshot,title){
    const id=uuid(),token=base64url(randomBytes(32)),roomCode=randomCode();
    const data=await this.#rpc('vex_room_create',{p_id:id,p_room_code:roomCode,p_token:token,p_title:title||'Untitled VEX CAD Room',p_snapshot:snapshot});
    if(!Array.isArray(data)||!data.length)throw new Error('Room creation returned no room');
    await this.joinRoom(id,token,{initialSnapshot:snapshot});
    return this.shareUrl();
  }
  async joinRoom(id,token,{initialSnapshot=null}={}){
    if(!/^[0-9a-f-]{36}$/i.test(String(id||''))||String(token||'').length<32)throw new Error('Invalid room link');
    await this.leaveRoom({preserveStatus:true});
    this.onStatus({state:'connecting',message:'Connecting…'});
    const rows=await this.#rpc('vex_room_get',{p_id:id,p_token:token});
    if(!Array.isArray(rows)||!rows.length)throw new Error('Room not found or the room token is invalid');
    const row=rows[0];this.room={id,token,code:row.room_code,title:row.title,revision:Number(row.revision)||0};
    this.lastSnapshot=deepClone(initialSnapshot||row.snapshot);
    if(!initialSnapshot){this.applyingRemote=true;try{await this.onSnapshot(deepClone(row.snapshot),{remote:true,initial:true});}finally{this.applyingRemote=false;}}
    const hash=await sha256(token),topic=`vex-cad:${id}:${hash.slice(0,32)}`,client=this.#ensureClient();
    const channel=client.channel(topic,{config:{broadcast:{ack:true,self:false},presence:{key:this.actorId}}});this.channel=channel;
    channel.on('broadcast',{event:'delta'},({payload})=>this.#receiveDelta(payload));
    channel.on('broadcast',{event:'refresh'},()=>this.refreshFromServer().catch(err=>this.onStatus({state:'degraded',message:err.message})));
    channel.on('broadcast',{event:'cursor'},({payload})=>{if(payload?.actorId&&payload.actorId!==this.actorId)this.onCursor(payload);});
    channel.on('presence',{event:'sync'},()=>this.#syncPresence());
    await new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(new Error('Realtime connection timed out'));}},10000);channel.subscribe(async(status,err)=>{if(done)return;if(status==='SUBSCRIBED'){done=true;clearTimeout(timer);this.connected=true;await this.trackPresence().catch(()=>{});this.#syncPresence();this.onStatus({state:'online',message:`Live · ${this.room.code}`});resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){done=true;clearTimeout(timer);reject(new Error(err?.message||`Realtime ${status.toLowerCase()}`));}});});
    this.#writeHash();return row;
  }
  async refreshFromServer(){if(!this.room)return;const rows=await this.#rpc('vex_room_get',{p_id:this.room.id,p_token:this.room.token});if(!rows?.length)throw new Error('Could not refresh room');const row=rows[0];this.room.revision=Number(row.revision)||this.room.revision;this.lastSnapshot=deepClone(row.snapshot);this.applyingRemote=true;try{await this.onSnapshot(deepClone(row.snapshot),{remote:true,refresh:true});}finally{this.applyingRemote=false;}}
  async notifyState(snapshot){
    if(!this.room||this.applyingRemote)return;
    const next=deepClone(snapshot),delta=diffSnapshots(this.lastSnapshot,next);if(!delta)return;this.lastSnapshot=next;
    const opId=uuid(),payload={opId,actorId:this.actorId,delta,at:Date.now()};this.#remember(opId);
    const bytes=new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if(this.connected&&this.channel){
      if(bytes<=MAX_BROADCAST_BYTES)this.channel.send({type:'broadcast',event:'delta',payload}).catch(()=>{});
      else this.channel.send({type:'broadcast',event:'refresh',payload:{actorId:this.actorId,at:Date.now()}}).catch(()=>{});
    }
    this.#rpc('vex_room_append_op',{p_id:this.room.id,p_token:this.room.token,p_op_id:opId,p_actor_id:this.actorId,p_op:{delta,at:payload.at}}).catch(()=>{});
    clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.saveSnapshot().catch(err=>this.onStatus({state:'degraded',message:`Cloud save failed: ${err.message}`})),850);
  }
  async saveSnapshot(){if(!this.room||!this.lastSnapshot)return;const rows=await this.#rpc('vex_room_save',{p_id:this.room.id,p_token:this.room.token,p_title:this.lastSnapshot.name||this.room.title,p_snapshot:this.lastSnapshot});if(rows?.length)this.room.revision=Number(rows[0].revision)||this.room.revision;}
  async #receiveDelta(payload){if(!payload?.opId||payload.actorId===this.actorId||this.seenOps.has(payload.opId)||!payload.delta||!this.lastSnapshot)return;this.#remember(payload.opId);const next=applyDelta(this.lastSnapshot,payload.delta);this.lastSnapshot=deepClone(next);this.applyingRemote=true;try{await this.onSnapshot(next,{remote:true,opId:payload.opId,actorId:payload.actorId});}finally{this.applyingRemote=false;}}
  #remember(id){this.seenOps.add(id);if(this.seenOps.size>MAX_SEEN_OPS){const first=this.seenOps.values().next().value;this.seenOps.delete(first);}}
  async trackPresence(){if(!this.channel||!this.connected)return;await this.channel.track({actorId:this.actorId,name:this.displayName,onlineAt:new Date().toISOString()});}
  #syncPresence(){if(!this.channel)return;const raw=this.channel.presenceState(),people=[];for(const list of Object.values(raw))for(const p of list||[])if(p?.actorId)people.push({actorId:p.actorId,name:p.name||'Builder'});const unique=[...new Map(people.map(p=>[p.actorId,p])).values()];this.onPresence(unique);}
  sendCursor(x,y,selection=[]){if(!this.connected||!this.channel)return;this.pendingCursor={actorId:this.actorId,name:this.displayName,x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),selection:[...selection].slice(0,24),at:Date.now()};if(this.cursorTimer)return;this.cursorTimer=setTimeout(()=>{this.cursorTimer=0;const payload=this.pendingCursor;this.pendingCursor=null;if(payload)this.channel?.send({type:'broadcast',event:'cursor',payload}).catch(()=>{});},65);}
  shareUrl(){if(!this.room)return null;const u=new URL(location.href);u.search='';u.hash=new URLSearchParams({room:this.room.id,token:this.room.token}).toString();return u.href;}
  parseRoomFromLocation(){const p=new URLSearchParams(location.hash.replace(/^#/,'')),room=p.get('room'),token=p.get('token');return room&&token?{room,token}:null;}
  #writeHash(){if(!this.room)return;history.replaceState(null,'',`#${new URLSearchParams({room:this.room.id,token:this.room.token})}`);}
  async autoJoin(){const x=this.parseRoomFromLocation();if(!x)return null;return this.joinRoom(x.room,x.token);}
  async leaveRoom({preserveStatus=false}={}){clearTimeout(this.saveTimer);clearTimeout(this.cursorTimer);if(this.channel){try{await this.channel.untrack();}catch{}try{await this.client?.removeChannel(this.channel);}catch{}}this.channel=null;this.connected=false;this.room=null;this.lastSnapshot=null;this.seenOps.clear();this.onPresence([]);if(!preserveStatus)this.onStatus({state:'offline',message:'Local only'});}
}
