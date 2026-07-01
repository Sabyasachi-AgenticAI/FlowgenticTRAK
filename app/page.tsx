'use client'
import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────
const SUPA_URL  = 'https://xfhegmlpfqqbipzngjcu.supabase.co'
const SUPA_ANON = 'sb_publishable_I7CK8LBaIZpspmO2cX43PQ_fX9MzZVI'
const LK_API_KEY    = 'APIDLrS54kQE5Xq'
const LK_API_SECRET = '0IrflhGErY1tMakBOUC4HfzKSMnlvYy7fHHrtbJNglvA'
const LK_WS_URL     = 'wss://flowgentic-trak-91ox6qih.livekit.cloud'
const AGENT_NAME    = 'my-agent'

function newRoomName(prefix: string) { return prefix+'-'+Math.random().toString(36).slice(2,9) }
const db = createClient(SUPA_URL, SUPA_ANON)

// ── LiveKit lazy loader ───────────────────────────────────────
let _LK: typeof import('livekit-client') | null = null
async function getLK() { if (!_LK) _LK = await import('livekit-client'); return _LK! }

// ── JWT helpers (browser crypto) ──────────────────────────────
function b64url(str: string) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
}
function b64urlBuf(buf: ArrayBuffer) {
  const b=new Uint8Array(buf); let s=''
  for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
}
async function signJWT(payload: object, secret: string) {
  const hdr=b64url(JSON.stringify({alg:'HS256',typ:'JWT'}))
  const pay=b64url(JSON.stringify(payload))
  const inp=`${hdr}.${pay}`
  const enc=new TextEncoder()
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(inp))
  return `${inp}.${b64urlBuf(sig)}`
}
async function makeParticipantToken(room: string) {
  const now=Math.floor(Date.now()/1000)
  return signJWT({iss:LK_API_KEY,exp:now+3600,nbf:now,jti:`user-${Date.now()}`,
    video:{room,roomJoin:true,canPublish:true,canSubscribe:true,canPublishData:true},
    name:'CSA Demo Viewer',metadata:''},LK_API_SECRET)
}
async function makeAdminToken(room: string) {
  const now=Math.floor(Date.now()/1000)
  return signJWT({iss:LK_API_KEY,exp:now+300,nbf:now,video:{room,roomCreate:true,roomAdmin:true}},LK_API_SECRET)
}
async function dispatchAgent(room: string, metadata?: object) {
  try {
    const tok=await makeAdminToken(room)
    const httpUrl=LK_WS_URL.replace('wss://','https://')
    const body: Record<string,unknown>={room,agentName:AGENT_NAME}
    if (metadata) body.metadata=JSON.stringify(metadata)
    const res=await fetch(`${httpUrl}/twirp/livekit.AgentDispatchService/CreateDispatch`,
      {method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(body)})
    if (!res.ok) dbg('Dispatch error '+res.status)
    else dbg('Dispatch OK — '+AGENT_NAME+(metadata?' · '+(metadata as any).use_case:''))
  } catch(e:any) { dbg('Dispatch failed: '+e.message) }
}

// ── Module-level state ────────────────────────────────────────
let loads: any[]=[],hasNewLoad=false,lkRoom: any=null,callState='idle'
const activeTranscripts=new Map<string,HTMLElement>()
const modalTranscripts=new Map<string,HTMLElement>()
let activeTab='cc'
const feedCounts={lt:0,cc:0,ar:0}
let callModalTimerInt: ReturnType<typeof setInterval>|null=null

// CC state
let ccLoads: any[]=[],ccHasCallMade=false,ccLkRoom: any=null,ccCallState='idle'
const ccTranscripts=new Map<string,HTMLElement>(),ccDialerTxMap=new Map<string,HTMLElement>()
const ltDialerTxMap=new Map<string,HTMLElement>()
let ccAutoRunning=false,ccDialerInt: ReturnType<typeof setInterval>|null=null,ccDialerSecs=0
let ccDoneSet=new Set<number>(),ccCountdownInt: ReturnType<typeof setInterval>|null=null,ccDemoIdx=-1
const _ccFeedRefs=new Set<string>()

// AR state
let arAccounts: any[]=[],arHasCallMade=false,arLkRoom: any=null,arCallState='idle'
const arTranscripts=new Map<string,HTMLElement>()
let arAutoRunning=false,arDemoAccounts: any[]=[],arDemoIdx=-1,arDoneSet=new Set<number>()
let arCountdownInt: ReturnType<typeof setInterval>|null=null,arDialerInt: ReturnType<typeof setInterval>|null=null,arDialerSecs=0
const arDialerTxMap=new Map<string,HTMLElement>(),_arFeedRefs=new Set<string>()

const CC_DEMO_CARRIERS=[
  {name:'Marcus Webb',initial:'M',load:'REF-29472',route:'MIA → LAX',pickup:'Jun 21, 07:00 CT',gpsIdleMins:97,alertType:'gps_idle'},
  {name:'Sandra Patel',initial:'S',load:'REF-29471',route:'LAX → ORD',pickup:'Jun 21, 08:00 CT',gpsIdleMins:35,alertType:'gps_idle'},
  {name:'James Carter',initial:'J',load:'CC-038',route:'ATL → CLT',pickup:'Jun 21, 07:00 CT',gpsIdleMins:120,alertType:'driver_initiated_vehicle_breakdown'},
]

// ── DOM helpers ───────────────────────────────────────────────
function el(id: string) { return document.getElementById(id) }
function chip(label: string,cls: string){return`<span class="chip ${cls}"><span class="chip-dot"></span>${label}</span>`}
function statusChip(st: string){
  const m: Record<string,string>={
    new:chip('New','chip-success'),act:chip('Active','chip-info'),delivered:chip('Delivered','chip-neutral'),
    confirmed:chip('Confirmed','chip-success'),pending_check:chip('Pending','chip-warning'),
    issue_raised:chip('Issue Raised','chip-warning'),rescheduled:chip('Rescheduled','chip-info'),
    in_progress:chip('In Progress','chip-info'),completed:chip('Completed','chip-neutral'),
    paid:chip('Collected','chip-success'),payment_promised:chip('Promised','chip-info'),
    escalated:chip('Escalated','chip-warning'),
  }
  return m[st]||chip(st,'chip-neutral')
}
function callStatusChip(st: string){
  if(st==='in_progress')return chip('In Progress','chip-warning')
  if(st==='completed')return chip('Completed','chip-neutral')
  return chip('Not Called','chip-neutral')
}
function incFeed(tab: string){
  feedCounts[tab as keyof typeof feedCounts]++
  if(activeTab===tab){
    const fc=el('feedCount');const n=feedCounts[tab as keyof typeof feedCounts]
    if(fc)fc.textContent=n+' event'+(n!==1?'s':'')
  }
}
function dbg(msg: string){
  console.log('[LK]',msg)
  let p=document.getElementById('dbg-panel')
  if(!p){
    p=document.createElement('div');p.id='dbg-panel'
    p.style.cssText='position:fixed;bottom:16px;right:16px;width:360px;background:var(--slate-900);border:1px solid var(--slate-700);border-radius:var(--radius-md);padding:10px 12px;font-family:var(--font-mono);font-size:10px;color:var(--slate-400);z-index:9999;max-height:200px;overflow-y:auto'
    p.innerHTML='<div style="color:var(--slate-500);font-size:9px;letter-spacing:1px;margin-bottom:6px">CALL DEBUG</div>'
    document.body.appendChild(p)
  }
  const row=document.createElement('div')
  row.style.cssText='padding:2px 0;border-top:1px solid var(--slate-800)'
  row.textContent=msg
  if(msg.includes('OK')||msg.includes('live'))row.style.color='var(--success-fg)'
  if(msg.includes('ERROR')||msg.includes('error'))row.style.color='var(--danger-fg)'
  p.appendChild(row);p.scrollTop=p.scrollHeight
}
function showError(msg: string){
  let e=document.getElementById('call-error')
  if(!e){e=document.createElement('div');e.id='call-error';e.style.cssText='position:fixed;bottom:16px;right:16px;background:var(--danger-bg);color:var(--danger-fg);border:1px solid var(--red-100);border-radius:var(--radius-md);padding:10px 14px;font-size:var(--text-sm);max-width:320px;z-index:999;display:none';document.body.appendChild(e)}
  if(msg){e.textContent='⚠ '+msg;e.style.display='block'}else{e.style.display='none'}
}
function updateAudioBars(active: boolean){
  document.querySelectorAll('.audio-bar').forEach(b=>b.classList.toggle('active',active))
}

// ── Topbar call state ─────────────────────────────────────────
const TAB_BTN_LABEL={lt:'Call Aria · Load Tender',cc:'Initialize Use Case',ar:'Call Aria · AR Collections'}
function setTopbarCallState(state: string,label?: string){
  const btn=el('call-btn'),lbl=el('call-label'),pill=el('statusPill'),txt=el('statusText'),rst=el('reset-btn')
  if(!btn||!lbl)return
  btn.className='btn-call'+(state==='active'?' call-active':state==='connecting'?' call-connecting':'')
  ;(btn as HTMLButtonElement).disabled=state==='connecting'
  lbl.textContent=label||(state==='active'?'End Call':state==='connecting'?'Connecting…':TAB_BTN_LABEL.lt)
  if(state==='active'&&pill&&txt){pill.className='status-pill live';txt.textContent='Live'}
  else if(state==='idle'){
    const anyActive=hasNewLoad||ccHasCallMade||arHasCallMade
    if(rst)rst.style.display=anyActive?'flex':'none'
    setTimeout(()=>{if(pill&&txt){pill.className='status-pill connecting';txt.textContent='Ready'}},800)
  }
  updateAudioBars(false)
}

// ── Feed card ─────────────────────────────────────────────────
function renderFeedCard(row: any,feedId: string,prepend: boolean){
  const feedEl=el(feedId);if(!feedEl)return
  const who=row.who==='aria'?'Aria AI · Saturn Freight':row.who==='cal'?'Caller · Saturn Freight':row.who==='carrier'?'Carrier · Inbound':row.who==='customer'?'Customer · Inbound':'System · Saturn Freight'
  const isLive=row.who==='aria'
  const badgeCls=row.badge_type==='auto'?'badge-auto':row.badge_type==='esc'?'badge-esc':'badge-live'
  const badgeLabel=row.badge_type==='auto'?'Automated':row.badge_type==='esc'?'Escalated':'Live'
  const d=document.createElement('div');d.className='feed-item'+(isLive?' live-item':'')
  const q=(row.quote||'').substring(0,90)+(row.quote||'').length>90?'…':''
  d.innerHTML=`<div class="feed-item-top"><span class="feed-item-name">${row.title}</span><span class="feed-item-time">${row.time_str}</span></div><div class="feed-item-who">${who}</div><div class="feed-item-quote">"${q}"</div><div class="feed-item-foot">${row.tool?`<span class="feed-tool">${row.tool}</span>`:'<span></span>'}<span class="feed-badge ${badgeCls}">${badgeLabel}</span></div>`
  const empty=feedEl.querySelector('.feed-empty');if(empty)empty.remove()
  if(prepend)feedEl.insertBefore(d,feedEl.firstChild);else feedEl.appendChild(d)
}

// ── Transcript helpers ────────────────────────────────────────
function updateTranscriptEl(segId: string,text: string,isAgent: boolean,isFinal: boolean,feedId: string){
  if(!text||!text.trim())return
  const cls=isAgent?'tx-aria':'tx-user',label=isAgent?'⚡ ARIA':'👤 YOU'
  let e=activeTranscripts.get(segId)
  if(!e){
    e=document.createElement('div');e.className=`tx-bubble ${cls}`
    e.innerHTML=`<div class="tx-who">${label}</div><span class="tx-text"></span><span class="tx-cursor"></span>`
    const feed=el(feedId);if(feed)feed.insertBefore(e,feed.firstChild)
    activeTranscripts.set(segId,e)
  }
  const t=e.querySelector('.tx-text');if(t)t.textContent=text
  if(isFinal){e.classList.add('tx-done');activeTranscripts.delete(segId)}
  updateModalTranscript(segId,text,isAgent,isFinal)
  updateLTDialerTranscript(segId,text,isAgent,isFinal)
}
function updateModalTranscript(segId: string,text: string,isAgent: boolean,isFinal: boolean){
  const wrap=el('callTranscript');if(!wrap)return
  const cls=isAgent?'modal-tx-aria':'modal-tx-human',label=isAgent?'⚡ Aria':'👤 You'
  let e=modalTranscripts.get(segId)
  if(!e){
    e=document.createElement('div');e.className=`modal-tx-line ${cls}`
    e.innerHTML=`<span class="modal-tx-label">${label}:</span><span class="modal-tx-text"></span><span class="modal-tx-cursor"></span>`
    wrap.insertBefore(e,wrap.firstChild);modalTranscripts.set(segId,e)
  }
  const t=e.querySelector('.modal-tx-text');if(t)t.textContent=text
  if(isFinal){e.classList.add('modal-tx-done');modalTranscripts.delete(segId);wrap.scrollTop=0}
}
function updateLTDialerTranscript(segId: string,text: string,isAgent: boolean,isFinal: boolean){
  const wrap=el('ltDialerTranscript');if(!wrap)return
  const cls=isAgent?'dialer-t-aria':'dialer-t-human',label=isAgent?'Aria':'Driver'
  let e=ltDialerTxMap.get(segId)
  if(!e){
    e=document.createElement('div');e.className='dialer-t-line '+cls
    e.innerHTML=`<span class="dialer-t-label">${label}:</span><span class="dialer-t-text"></span>`
    wrap.appendChild(e);ltDialerTxMap.set(segId,e)
  }
  const dt=e.querySelector('.dialer-t-text');if(dt)dt.textContent=text
  wrap.scrollTop=wrap.scrollHeight;if(isFinal)ltDialerTxMap.delete(segId)
}
function ccUpdateTranscript(segId: string,text: string,isAgent: boolean,isFinal: boolean){
  if(!text||!text.trim())return
  const cls=isAgent?'tx-aria':'tx-user',label=isAgent?'⚡ ARIA':'👤 YOU'
  let e=ccTranscripts.get(segId)
  if(!e){
    e=document.createElement('div');e.className=`tx-bubble ${cls}`
    e.innerHTML=`<div class="tx-who">${label}</div><span class="tx-text"></span><span class="tx-cursor"></span>`
    const feed=el('feed-cc');if(feed)feed.insertBefore(e,feed.firstChild);ccTranscripts.set(segId,e)
  }
  const t=e.querySelector('.tx-text');if(t)t.textContent=text
  if(isFinal){e.classList.add('tx-done');ccTranscripts.delete(segId)}
  const dw=el('dialerTranscript')
  if(dw){
    let dlEl=ccDialerTxMap.get(segId)
    if(!dlEl){
      dlEl=document.createElement('div');dlEl.className='dialer-t-line '+(isAgent?'dialer-t-aria':'dialer-t-human')
      dlEl.innerHTML=`<span class="dialer-t-label">${isAgent?'Aria':'Driver'}:</span><span class="dialer-t-text"></span>`
      dw.appendChild(dlEl);ccDialerTxMap.set(segId,dlEl)
    }
    const dt=dlEl.querySelector('.dialer-t-text');if(dt)dt.textContent=text
    dw.scrollTop=dw.scrollHeight;if(isFinal)ccDialerTxMap.delete(segId)
  }
}
function arUpdateTranscript(segId: string,text: string,isAgent: boolean,isFinal: boolean){
  if(!text||!text.trim())return
  const cls=isAgent?'tx-aria':'tx-user',label=isAgent?'⚡ ARIA':'👤 YOU'
  let e=arTranscripts.get(segId)
  if(!e){
    e=document.createElement('div');e.className=`tx-bubble ${cls}`
    e.innerHTML=`<div class="tx-who">${label}</div><span class="tx-text"></span><span class="tx-cursor"></span>`
    const feed=el('feed-ar');if(feed)feed.insertBefore(e,feed.firstChild);arTranscripts.set(segId,e)
  }
  const t=e.querySelector('.tx-text');if(t)t.textContent=text
  if(isFinal){e.classList.add('tx-done');arTranscripts.delete(segId)}
  const dw=el('arDialerTranscript')
  if(dw){
    let dlEl=arDialerTxMap.get(segId)
    if(!dlEl){
      dlEl=document.createElement('div');dlEl.className='dialer-t-line '+(isAgent?'dialer-t-aria':'dialer-t-human')
      dlEl.innerHTML=`<span class="dialer-t-label">${isAgent?'Aria':'Contact'}:</span><span class="dialer-t-text"></span>`
      dw.appendChild(dlEl);arDialerTxMap.set(segId,dlEl)
    }
    const dt=dlEl.querySelector('.dialer-t-text');if(dt)dt.textContent=text
    dw.scrollTop=dw.scrollHeight;if(isFinal)arDialerTxMap.delete(segId)
  }
}

// ── Load Tender data ──────────────────────────────────────────
function renderLoads(){
  const nc=loads.filter(l=>l.status==='new').length
  const lc=el('lt-count');if(lc)lc.textContent=loads.length+' loads'+(nc?` · ${nc} new`:'')
  const body=el('lt-table-body');if(!body)return
  if(!loads.length){body.innerHTML='<div class="feed-empty">No loads found.</div>';return}
  body.innerHTML=loads.map(l=>`<div class="table-row lt-cols${l.status==='new'?' row-highlight':''}"><div><div class="cell-primary">${l.shipper}</div><div class="cell-ref">${l.ref}</div></div><div class="cell-muted" style="font-size:var(--text-xs)">${l.route}</div><div class="cell-muted">${l.service}</div><div>${statusChip(l.status)}</div><div>${l.created_by==='aria'?'<span style="font-size:var(--text-xs);font-weight:var(--weight-semibold);color:var(--amber-700)">⚡ Aria AI</span>':`<span class="cell-muted">${l.created_by}</span>`}</div></div>`).join('')
}
async function loadData(){
  const [lr,fr]=await Promise.all([
    db.from('demo_loads').select('*').order('created_at',{ascending:true}),
    db.from('demo_feed').select('*').order('created_at',{ascending:false})
  ])
  if(lr.error||fr.error){console.error(lr.error||fr.error);return}
  loads=lr.data||[];hasNewLoad=loads.some(l=>l.status==='new');renderLoads()
  const flt=el('feed-lt');if(flt)flt.innerHTML='';feedCounts.lt=0
  ;(fr.data||[]).forEach((r: any)=>{renderFeedCard(r,'feed-lt',false);feedCounts.lt++})
  if(activeTab==='lt'){const fc=el('feedCount');if(fc)fc.textContent=feedCounts.lt+' events'}
}
function subscribeRealtime(){
  db.channel('demo-loads')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'demo_loads'},(p: any)=>{
      loads.unshift(p.new);hasNewLoad=true;renderLoads()
      const k1=el('k1');if(k1)k1.textContent=String(parseInt(k1.textContent||'0')+1)
      const k3=el('k3');if(k3)k3.textContent=String(parseInt(k3.textContent||'0')+1)
    })
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'demo_loads'},(p: any)=>{
      loads=loads.filter(l=>l.ref!==p.old.ref);hasNewLoad=loads.some(l=>l.status==='new');renderLoads()
    })
    .subscribe((status: string)=>{
      const pill=el('statusPill'),txt=el('statusText')
      if(status==='SUBSCRIBED'&&pill&&txt){pill.className='status-pill live';txt.textContent='Live'}
    })
  db.channel('demo-feed')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'demo_feed'},(p: any)=>{renderFeedCard(p.new,'feed-lt',true);incFeed('lt')})
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'demo_feed'},()=>loadData())
    .subscribe()
}

// ── LT call modal ─────────────────────────────────────────────
function showCallModal(name: string,sub: string){
  if(callModalTimerInt)clearInterval(callModalTimerInt)
  if(activeTab==='lt'){
    const ldc=el('ltDialerCard'),ln=el('ltDialerName'),ls=el('ltDialerSub'),lt=el('ltDialerTimer'),ltr=el('ltDialerTranscript')
    if(ln)ln.textContent=name;if(ls)ls.textContent=sub
    if(lt)lt.textContent='0:00';if(ltr)ltr.innerHTML='';ltDialerTxMap.clear()
    if(ldc)ldc.classList.add('visible')
    let secs=0
    callModalTimerInt=setInterval(()=>{secs++;const m=Math.floor(secs/60),s=secs%60;if(lt)lt.textContent=m+':'+String(s).padStart(2,'0')},1000)
    return
  }
  const cn=el('callName'),cs=el('callSub'),ct=el('callTimer'),ctr=el('callTranscript'),co=el('callOverlay')
  if(cn)cn.textContent=name;if(cs)cs.textContent=sub
  if(ct)ct.textContent='0:00';if(ctr)ctr.innerHTML=''
  if(co)co.classList.add('visible')
  let secs=0
  callModalTimerInt=setInterval(()=>{secs++;const m=Math.floor(secs/60),s=secs%60;if(ct)ct.textContent=m+':'+String(s).padStart(2,'0')},1000)
}
function hideCallModal(){
  if(callModalTimerInt)clearInterval(callModalTimerInt)
  const co=el('callOverlay');if(co)co.classList.remove('visible')
  const ldc=el('ltDialerCard');if(ldc)ldc.classList.remove('visible')
}

async function startCall(){
  callState='connecting';setTopbarCallState('connecting');showError('');dbg('Starting LT call…')
  try {
    const LK=await getLK()
    const room=newRoomName('lt')
    const token=await makeParticipantToken(room)
    dbg('Token ready · '+room)
    lkRoom=new LK.Room({adaptiveStream:true,dynacast:true})
    lkRoom.on(LK.RoomEvent.Disconnected,()=>{callState='idle';setTopbarCallState('idle');hideCallModal()})
    lkRoom.on(LK.RoomEvent.TrackSubscribed,(track: any,_pub: any,participant: any)=>{
      if(track.kind===LK.Track.Kind.Audio){const ae=track.attach();ae.dataset.lkParticipant=participant.sid;document.body.appendChild(ae);dbg('Audio attached')}
    })
    lkRoom.on(LK.RoomEvent.TrackUnsubscribed,(track: any)=>track.detach().forEach((e: any)=>e.remove()))
    lkRoom.on(LK.RoomEvent.ActiveSpeakersChanged,(spk: any[])=>{if(activeTab==='lt')updateAudioBars(spk.some(p=>p!==lkRoom.localParticipant))})
    await lkRoom.connect(LK_WS_URL,token);dbg('Connected')
    if(typeof lkRoom.registerTextStreamHandler==='function'){
      lkRoom.registerTextStreamHandler('lk.transcription',async(reader: any,pInfo: any)=>{
        const attrs=(reader.info?.attributes)||{};const segId=attrs['lk.segment_id'],isFinal=attrs['lk.transcription_final']!=='false'
        const isAgent=pInfo.identity!==lkRoom.localParticipant.identity;if(!segId&&!isFinal)return
        try{const text=await reader.readAll();updateTranscriptEl(segId||('ts-'+Date.now()),text,isAgent,isFinal,'feed-lt')}catch(e){}
      })
      lkRoom.registerTextStreamHandler('lk.chat',async(reader: any,pInfo: any)=>{
        const isAgent=pInfo.identity!==lkRoom.localParticipant.identity
        try{const text=await reader.readAll();updateTranscriptEl('chat-'+Date.now(),text,isAgent,true,'feed-lt')}catch(e){}
      })
    }
    await dispatchAgent(room,{use_case:'load_tender'})
    await lkRoom.startAudio();await lkRoom.localParticipant.setMicrophoneEnabled(true)
    callState='active';setTopbarCallState('active')
    showCallModal('Incoming — Carrier on the line','Inbound · Load Tender');dbg('Call live')
  } catch(err:any){dbg('ERROR: '+(err.message||err));callState='idle';setTopbarCallState('idle');showError(err.message||'Connection failed')}
}
async function endCall(){
  if(lkRoom){await lkRoom.disconnect();lkRoom=null}
  document.querySelectorAll('audio[data-lk-participant]').forEach((e:any)=>e.remove())
  activeTranscripts.forEach(e=>e.classList.add('tx-done'));activeTranscripts.clear();modalTranscripts.clear();ltDialerTxMap.clear()
  callState='idle';setTopbarCallState('idle');hideCallModal()
  if(hasNewLoad){const r=el('reset-btn');if(r)r.style.display='flex'}
}
async function toggleCall(){if(callState==='idle')await startCall();else if(callState==='active')await endCall()}

// ── CC data ───────────────────────────────────────────────────
function renderCCLoads(){
  const demRefs=new Set(CC_DEMO_CARRIERS.map(c=>c.load))
  const otherLoads=ccLoads.filter(l=>!demRefs.has(l.ref))
  const doneCount=ccDoneSet.size
  const pendingCount=CC_DEMO_CARRIERS.filter((_,i)=>!ccDoneSet.has(i)).length+otherLoads.filter(l=>l.status==='pending_check').length
  const k2=el('cc-k2');if(k2)k2.textContent=String(doneCount+otherLoads.filter(l=>l.status==='confirmed').length)
  const k3=el('cc-k3');if(k3)k3.textContent=String(pendingCount)
  const cc=el('cc-count');if(cc)cc.textContent=(CC_DEMO_CARRIERS.length+otherLoads.length+1)+' carriers'
  const body=el('cc-table-body');if(!body)return
  let html=''
  CC_DEMO_CARRIERS.forEach((c,i)=>{
    const done=ccDoneSet.has(i),active=ccAutoRunning&&ccDemoIdx===i&&!done
    const dbRow=ccLoads.find(l=>l.ref===c.load)
    const dbDone=dbRow?.call_status==='completed'
    const callSt=(done||dbDone)?'completed':active?'in_progress':'not_called'
    const st=(done||dbDone)?(dbRow?.status||'confirmed'):'pending_check'
    const isBreakdown=c.alertType==='driver_initiated_vehicle_breakdown'
    const rowCls=(done||dbDone)?' row-highlight':(!active&&isBreakdown?' cc-alert-row':'')
    const phone=dbRow?.driver_phone||''
    const summary=dbRow?.call_summary||''
    const newEta=dbRow?.last_eta||''
    const alertCol=isBreakdown
      ?`<span class="chip chip-danger"><span class="chip-dot"></span>Vehicle Breakdown · ${c.gpsIdleMins} min</span>`
      :`<span class="chip chip-warning"><span class="chip-dot"></span>GPS Idle · ${c.gpsIdleMins} min</span>`
    let summaryCol
    if(summary||newEta){
      const etaHtml=newEta?`<div class="cell-eta"><span class="cell-eta-orig">${c.pickup}</span><span class="cell-eta-sep">→</span><span class="cell-eta-new">${newEta}</span></div>`:''
      summaryCol=`<div>${etaHtml}${summary?`<div class="cell-summary">"${summary}"</div>`:''}</div>`
    } else {
      summaryCol=statusChip(st)
    }
    html+=`<div class="table-row cc-cols${rowCls}"><div><div class="cell-primary">${c.name}</div><div class="cell-ref">${c.load}</div>${phone?`<div class="cell-phone">${phone}</div>`:''}</div><div class="cell-muted" style="font-size:var(--text-xs)">${c.route}</div><div>${alertCol}</div><div>${callStatusChip(callSt)}</div><div>${summaryCol}</div></div>`
  })
  otherLoads.forEach(l=>{
    html+=`<div class="table-row cc-cols${l.status==='confirmed'?' row-highlight':''}"><div><div class="cell-primary">${l.driver_name||l.carrier}</div><div class="cell-ref">${l.ref}</div>${l.driver_phone?`<div class="cell-phone">${l.driver_phone}</div>`:''}</div><div class="cell-muted" style="font-size:var(--text-xs)">${l.route||(l.origin+' → '+l.destination)}</div><div class="cell-muted" style="font-size:var(--text-xs)">${l.pickup_time}</div><div>${callStatusChip(l.call_status)}</div><div>${l.call_summary?`<div class="cell-summary">"${l.call_summary}"</div>`:statusChip(l.status)}</div></div>`
  })
  html+=`<div class="cc-alert-sep"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 2L1.5 13.5h13L8 2z"/><path d="M8 7v3.5M8 12.5v.5" stroke-linecap="round"/></svg>Driver Alerts — Immediate Action Required</div>`
  html+=`<div class="table-row cc-cols cc-warn-row"><div><div class="cell-primary">Tony Rivera</div><div class="cell-ref">CC-051</div><div class="cell-phone">+1-555-0721</div></div><div class="cell-muted" style="font-size:var(--text-xs)">Houston TX → Baton Rouge LA</div><div><span class="chip chip-warning"><span class="chip-dot"></span>Driver Initiated · 2h+</span></div><div>${callStatusChip('not_called')}</div><div><span class="chip chip-warning"><span class="chip-dot"></span>Load Not Staged</span></div></div>`
  body.innerHTML=html
}
async function loadCCData(){
  const [lr,fr]=await Promise.all([
    db.from('carrier_check_loads').select('*').order('created_at',{ascending:true}),
    db.from('carrier_check_feed').select('*').order('created_at',{ascending:false})
  ])
  if(lr.error||fr.error){console.error(lr.error||fr.error);return}
  ccLoads=lr.data||[];ccHasCallMade=ccLoads.some(l=>l.call_status==='completed')
  const k1=el('cc-k1');if(k1)k1.textContent=String(ccLoads.filter(l=>l.call_status==='completed').length)
  renderCCLoads()
  const fcc=el('feed-cc');if(fcc)fcc.innerHTML='';feedCounts.cc=0
  ;(fr.data||[]).forEach((r: any)=>{renderFeedCard(r,'feed-cc',false);feedCounts.cc++})
  if(activeTab==='cc'){const fc=el('feedCount');if(fc)fc.textContent=feedCounts.cc+' events'}
}
function subscribeCCRealtime(){
  db.channel('cc-loads')
    .on('postgres_changes',{event:'*',schema:'public',table:'carrier_check_loads'},(p: any)=>{
      if(p.eventType==='INSERT')ccLoads.push(p.new)
      else if(p.eventType==='UPDATE'){
        const i=ccLoads.findIndex(l=>l.id===p.new.id);if(i>-1)ccLoads[i]=p.new
        if(p.new.call_status==='completed'&&p.new.call_summary&&!_ccFeedRefs.has(p.new.ref)){
          _ccFeedRefs.add(p.new.ref)
          const now=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})
          renderFeedCard({title:(p.new.driver_name||p.new.carrier)+' — Status Updated',who:'aria',time_str:now,quote:p.new.call_summary,badge_type:'auto',tool:'update_carrier_status'},'feed-cc',true);incFeed('cc')
        }
      } else if(p.eventType==='DELETE')ccLoads=ccLoads.filter(l=>l.id!==p.old.id)
      ccHasCallMade=ccLoads.some(l=>l.call_status==='completed')
      const k1=el('cc-k1');if(k1)k1.textContent=String(ccLoads.filter(l=>l.call_status==='completed').length)
      renderCCLoads()
      if(p.eventType==='UPDATE'&&p.new.call_status==='completed'&&ccAutoRunning&&CC_DEMO_CARRIERS[ccDemoIdx]?.load===p.new.ref)ccStartCountdownToNext()
    }).subscribe()
  db.channel('cc-feed')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'carrier_check_feed'},(p: any)=>{renderFeedCard(p.new,'feed-cc',true);incFeed('cc')})
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'carrier_check_feed'},()=>loadCCData())
    .subscribe()
}
function syncCCBtn(){
  const btn=el('call-btn'),lbl=el('call-label');if(!btn||!lbl)return
  const active=ccCallState==='active'||ccAutoRunning
  btn.className='btn-call'+(active?' call-active':ccCallState==='connecting'?' call-connecting':'')
  ;(btn as HTMLButtonElement).disabled=ccCallState==='connecting'
  lbl.textContent=ccCallState==='connecting'?'Connecting…':active?'End Sequence':'Initialize Use Case'
}

// ── CC call sequence ──────────────────────────────────────────
function updateCCDemoDialer(){
  const c=CC_DEMO_CARRIERS[ccDemoIdx];if(!c)return
  const di=el('dialerInitial'),dn=el('dialerName'),dm=el('dialerMeta'),dc=el('dialerCurrent'),dt=el('dialerTotal'),dnx=el('dialerNext'),dti=el('dialerTimer'),dtr=el('dialerTranscript'),ldc=el('liveDialerCard')
  if(di)di.textContent=c.initial;if(dn)dn.textContent=c.name;if(dm)dm.textContent=c.load+' · '+c.route
  if(dc)dc.textContent=String(ccDemoIdx+1);if(dt)dt.textContent=String(CC_DEMO_CARRIERS.length)
  const next=CC_DEMO_CARRIERS[ccDemoIdx+1];if(dnx)dnx.textContent=next?next.name:'Sequence Complete'
  if(dti)dti.textContent='0:00';if(dtr)dtr.innerHTML='';ccDialerTxMap.clear()
  if(ldc)ldc.classList.add('visible')
}
function ccInitializeUseCase(){
  if(ccAutoRunning){stopCCSequence();return}
  ccDemoIdx=0;ccDoneSet=new Set();_ccFeedRefs.clear()
  const fcc=el('feed-cc');if(fcc)fcc.innerHTML='';feedCounts.cc=0
  if(activeTab==='cc'){const fc=el('feedCount');if(fc)fc.textContent='0 events'}
  updateCCDemoDialer();ccStartCallForCarrier(CC_DEMO_CARRIERS[0])
}
async function ccStartCallForCarrier(carrier: typeof CC_DEMO_CARRIERS[0]){
  ccCallState='connecting';ccAutoRunning=true;syncCCBtn();showError('');dbg('CC → '+carrier.name)
  const initBtn=el('cc-init-btn')
  if(initBtn){initBtn.innerHTML='<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3h2v10H5zM9 3h2v10H9z"/></svg> End Sequence';initBtn.classList.add('running')}
  try {
    const LK=await getLK()
    const roomName=newRoomName('cc')
    const token=await makeParticipantToken(roomName)
    if(ccLkRoom){const old=ccLkRoom;ccLkRoom=null;await old.disconnect()}
    ccTranscripts.forEach(e=>e.classList.add('tx-done'));ccTranscripts.clear();ccDialerTxMap.clear()
    const thisRoom=new LK.Room({adaptiveStream:true,dynacast:true})
    ccLkRoom=thisRoom
    thisRoom.on(LK.RoomEvent.Disconnected,()=>{
      if(ccLkRoom!==thisRoom)return
      ccLkRoom=null;ccCallState='idle';if(ccDialerInt)clearInterval(ccDialerInt)
      document.querySelectorAll('audio[data-lk-participant^="cc-"]').forEach((e:any)=>e.remove())
      if(ccAutoRunning&&ccDemoIdx<CC_DEMO_CARRIERS.length-1)ccStartCountdownToNext()
      else if(ccAutoRunning)ccSequenceComplete()
    })
    thisRoom.on(LK.RoomEvent.TrackSubscribed,(track: any,_pub: any,p: any)=>{
      if(track.kind===LK.Track.Kind.Audio){const ae=track.attach();ae.dataset.lkParticipant='cc-'+p.sid;document.body.appendChild(ae);dbg('[CC] Audio attached — '+p.identity)}
    })
    thisRoom.on(LK.RoomEvent.TrackUnsubscribed,(track: any)=>track.detach().forEach((e: any)=>e.remove()))
    thisRoom.on(LK.RoomEvent.ActiveSpeakersChanged,(spk: any[])=>{if(activeTab==='cc')updateAudioBars(spk.some(p=>p!==thisRoom.localParticipant))})
    thisRoom.on(LK.RoomEvent.ParticipantDisconnected,(_p: any)=>{
      if(ccLkRoom===thisRoom)thisRoom.disconnect()
    })
    await thisRoom.connect(LK_WS_URL,token);dbg('[CC] Connected · '+carrier.name)
    await thisRoom.startAudio();await thisRoom.localParticipant.setMicrophoneEnabled(true);dbg('[CC] Audio unlocked')
    if(typeof thisRoom.registerTextStreamHandler==='function'){
      thisRoom.registerTextStreamHandler('lk.transcription',async(reader: any,pInfo: any)=>{
        const attrs=(reader.info?.attributes)||{};const segId=attrs['lk.segment_id'],isFinal=attrs['lk.transcription_final']!=='false'
        const isAgent=pInfo.identity!==thisRoom.localParticipant.identity;if(!segId&&!isFinal)return
        try{const text=await reader.readAll();ccUpdateTranscript(segId||('cc-'+Date.now()),text,isAgent,isFinal)}catch(e){}
      })
      thisRoom.registerTextStreamHandler('lk.chat',async(reader: any,pInfo: any)=>{
        const isAgent=pInfo.identity!==thisRoom.localParticipant.identity
        try{const text=await reader.readAll();ccUpdateTranscript('chat-'+Date.now(),text,isAgent,true)}catch(e){}
      })
    }
    await dispatchAgent(roomName,{use_case:'carrier_check',driver_name:carrier.name,ref:carrier.load,route:carrier.route,gps_idle_mins:carrier.gpsIdleMins,alert_type:carrier.alertType})
    ccCallState='active';syncCCBtn();if(ccDialerInt)clearInterval(ccDialerInt);ccDialerSecs=0
    ccDialerInt=setInterval(()=>{ccDialerSecs++;const m=Math.floor(ccDialerSecs/60),s=ccDialerSecs%60;const dti=el('dialerTimer');if(dti)dti.textContent=m+':'+String(s).padStart(2,'0')},1000)
    renderCCLoads();dbg('[CC] Live — '+carrier.name)
  } catch(err:any){
    dbg('[CC] ERROR: '+(err.message||err));ccCallState='idle';ccAutoRunning=false;syncCCBtn();showError(err.message||'CC call failed')
    const b=el('cc-init-btn');if(b){b.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/></svg> Initialize Use Case';b.classList.remove('running');(b as HTMLButtonElement).disabled=false}
  }
}
function ccStartCountdownToNext(){
  if(ccDoneSet.has(ccDemoIdx))return
  ccDoneSet.add(ccDemoIdx);renderCCLoads()
  const nextCarrier=CC_DEMO_CARRIERS[ccDemoIdx+1];let secs=8
  const dn=el('dialerName'),dm=el('dialerMeta'),dti=el('dialerTimer'),dtr=el('dialerTranscript'),ldc=el('liveDialerCard')
  if(dn)dn.textContent='✓ '+CC_DEMO_CARRIERS[ccDemoIdx].name+' — Complete'
  if(dm)dm.textContent='Calling '+nextCarrier.name+' in '+secs+'…'
  if(dti)dti.textContent=String(secs);if(dtr)dtr.innerHTML='';ccDialerTxMap.clear()
  if(ldc)ldc.classList.add('visible');if(ccCountdownInt)clearInterval(ccCountdownInt)
  ccCountdownInt=setInterval(()=>{
    secs--;if(secs>0){if(dm)dm.textContent='Calling '+nextCarrier.name+' in '+secs+'…';if(dti)dti.textContent=String(secs)}
    else{if(ccCountdownInt)clearInterval(ccCountdownInt);ccDemoIdx++;ccDialerSecs=0;updateCCDemoDialer();renderCCLoads();ccStartCallForCarrier(CC_DEMO_CARRIERS[ccDemoIdx])}
  },1000)
}
function ccSequenceComplete(){
  ccDoneSet.add(ccDemoIdx);if(ccDialerInt)clearInterval(ccDialerInt);if(ccCountdownInt)clearInterval(ccCountdownInt)
  ccAutoRunning=false
  const dn=el('dialerName'),dm=el('dialerMeta'),dti=el('dialerTimer'),dnx=el('dialerNext'),ldc=el('liveDialerCard'),rst=el('reset-btn')
  if(dn)dn.textContent='✓ Sequence Complete';if(dm)dm.textContent=CC_DEMO_CARRIERS.length+' carriers checked — demo done'
  if(dti)dti.textContent='—';if(dnx)dnx.textContent='Done'
  renderCCLoads();syncCCBtn()
  const b=el('cc-init-btn');if(b){b.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/></svg> Initialize Use Case';b.classList.remove('running');(b as HTMLButtonElement).disabled=false}
  if(rst)rst.style.display='flex';setTimeout(()=>{if(ldc)ldc.classList.remove('visible')},4000)
}
function stopCCSequence(){
  if(ccDialerInt)clearInterval(ccDialerInt);if(ccCountdownInt)clearInterval(ccCountdownInt);ccCountdownInt=null
  ccDemoIdx=-1;ccDoneSet=new Set();ccAutoRunning=false;ccCallState='idle'
  if(ccLkRoom){const r=ccLkRoom;ccLkRoom=null;r.disconnect()}
  document.querySelectorAll('audio[data-lk-participant^="cc-"]').forEach((e:any)=>e.remove())
  ccTranscripts.forEach(e=>e.classList.add('tx-done'));ccTranscripts.clear();ccDialerTxMap.clear()
  const b=el('cc-init-btn');if(b){b.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/></svg> Initialize Use Case';b.classList.remove('running');(b as HTMLButtonElement).disabled=false}
  const ldc=el('liveDialerCard');if(ldc)ldc.classList.remove('visible');renderCCLoads();syncCCBtn()
}
async function resetCCDemo(){
  stopCCSequence()
  await Promise.all([
    db.from('carrier_check_loads').update({
      status:'pending_check',call_status:'not_called',eta_confirmed:null,
      last_eta:null,call_summary:null,last_location:null,driver_phone:null,notes:null
    }).eq('is_demo_row',true),
    db.from('carrier_check_calls').delete().eq('is_demo_row',true),
    db.from('carrier_check_feed').delete().eq('is_demo_row',true)
  ])
  ccHasCallMade=false;const r=el('reset-btn');if(r)r.style.display='none';await loadCCData()
}

// ── AR data & call ────────────────────────────────────────────
function fmtDollars(n: any){return n?'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0}):'$0'}
function renderARAccounts(){
  const promised=arAccounts.filter(a=>a.status==='payment_promised')
  const collected=arAccounts.filter(a=>a.status==='paid')
  const k2=el('ar-k2');if(k2)k2.textContent=fmtDollars(promised.reduce((s: number,a: any)=>s+Number(a.amount_due||0),0)).replace('$','')
  const k3=el('ar-k3');if(k3)k3.textContent=fmtDollars(collected.reduce((s: number,a: any)=>s+Number(a.amount_due||0),0)).replace('$','')
  const ac=el('ar-count');if(ac)ac.textContent=arAccounts.length+' accounts'
  const body=el('ar-table-body');if(!body)return
  if(!arAccounts.length){body.innerHTML='<div class="feed-empty">No accounts found.</div>';return}
  body.innerHTML=arAccounts.map((a: any)=>{
    const isDone=a.call_status==='completed'
    const isActive=arAutoRunning&&arDemoIdx>=0&&arDemoAccounts[arDemoIdx]?.invoice_no===a.invoice_no
    const callSt=isDone?'completed':isActive?'in_progress':a.call_status==='in_progress'?'in_progress':'not_called'
    const summaryCol=a.call_summary?`<div class="cell-summary">"${a.call_summary}"</div>`:statusChip(a.status)
    return `<div class="table-row ar-cols${isDone?' row-highlight':''}"><div><div class="cell-primary">${a.customer}</div><div class="cell-ref">${a.invoice_no}</div>${a.contact_name?`<div class="cell-phone">${a.contact_name}</div>`:''}</div><div class="cell-amount">$${Number(a.amount_due).toLocaleString()}</div><div style="color:${a.days_overdue>60?'var(--danger-fg)':a.days_overdue>30?'var(--warning-fg)':'var(--text-muted)'}">${a.days_overdue}d</div><div>${callStatusChip(callSt)}</div><div>${summaryCol}</div></div>`
  }).join('')
}
async function loadARData(){
  const [ar,fr]=await Promise.all([
    db.from('ar_accounts').select('*').order('days_overdue',{ascending:false}),
    db.from('ar_feed').select('*').order('created_at',{ascending:false})
  ])
  if(ar.error||fr.error){console.error(ar.error||fr.error);return}
  arAccounts=ar.data||[];arHasCallMade=arAccounts.some((a: any)=>a.call_status==='completed')
  const k1=el('ar-k1');if(k1)k1.textContent=String(arAccounts.filter((a: any)=>a.call_status==='completed').length)
  renderARAccounts()
  const far=el('feed-ar');if(far)far.innerHTML='';feedCounts.ar=0
  ;(fr.data||[]).forEach((r: any)=>{renderFeedCard(r,'feed-ar',false);feedCounts.ar++})
  if(activeTab==='ar'){const fc=el('feedCount');if(fc)fc.textContent=feedCounts.ar+' events'}
}
function subscribeARRealtime(){
  db.channel('ar-accounts')
    .on('postgres_changes',{event:'*',schema:'public',table:'ar_accounts'},(p: any)=>{
      if(p.eventType==='UPDATE'){
        const i=arAccounts.findIndex((a: any)=>a.id===p.new.id);if(i>-1)arAccounts[i]=p.new
        if(p.new.call_status==='completed'&&p.new.call_summary&&!_arFeedRefs.has(p.new.invoice_no)){
          _arFeedRefs.add(p.new.invoice_no)
          const now=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})
          const tool=p.new.status==='escalated'?'escalate_account':'log_promise_to_pay'
          renderFeedCard({title:p.new.customer+' — '+p.new.invoice_no,who:'aria',time_str:now,quote:p.new.call_summary,badge_type:'auto',tool},'feed-ar',true);incFeed('ar')
          if(arAutoRunning&&arDemoAccounts[arDemoIdx]?.invoice_no===p.new.invoice_no)arStartCountdownToNext()
        }
      } else if(p.eventType==='INSERT')arAccounts.push(p.new)
      else if(p.eventType==='DELETE')arAccounts=arAccounts.filter((a: any)=>a.id!==p.old.id)
      arHasCallMade=arAccounts.some((a: any)=>a.call_status==='completed')
      const k1=el('ar-k1');if(k1)k1.textContent=String(arAccounts.filter((a: any)=>a.call_status==='completed').length)
      renderARAccounts()
    }).subscribe()
  db.channel('ar-feed')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'ar_feed'},(p: any)=>{renderFeedCard(p.new,'feed-ar',true);incFeed('ar')})
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'ar_feed'},()=>loadARData())
    .subscribe()
}
function syncARBtn(){
  const btn=el('call-btn'),lbl=el('call-label');if(!btn||!lbl)return
  const active=arCallState==='active'||arAutoRunning
  btn.className='btn-call'+(active?' call-active':arCallState==='connecting'?' call-connecting':'')
  ;(btn as HTMLButtonElement).disabled=arCallState==='connecting'
  lbl.textContent=arCallState==='connecting'?'Connecting…':active?'End Sequence':TAB_BTN_LABEL.ar
}
function updateARDemoDialer(){
  const a=arDemoAccounts[arDemoIdx];if(!a)return
  const dn=el('arDialerName'),dm=el('arDialerMeta'),dc=el('arDialerCurrent'),dt=el('arDialerTotal'),dnx=el('arDialerNext'),dti=el('arDialerTimer'),dtr=el('arDialerTranscript'),ldc=el('arDialerCard')
  if(dn)dn.textContent=a.customer;if(dm)dm.textContent=a.invoice_no+' · $'+Number(a.amount_due).toLocaleString()+' · '+a.days_overdue+'d overdue'
  if(dc)dc.textContent=String(arDemoIdx+1);if(dt)dt.textContent=String(arDemoAccounts.length)
  const next=arDemoAccounts[arDemoIdx+1];if(dnx)dnx.textContent=next?next.customer:'Sequence Complete'
  if(dti)dti.textContent='0:00';if(dtr)dtr.innerHTML='';arDialerTxMap.clear()
  if(ldc)ldc.classList.add('visible')
}
async function arInitializeUseCase(){
  if(arAutoRunning){stopARSequence();return}
  const {data}=await db.from('ar_accounts').select('*').eq('status','pending_call').order('days_overdue',{ascending:false})
  arDemoAccounts=data||[]
  if(!arDemoAccounts.length){dbg('[AR] No pending accounts to call');return}
  arDemoIdx=0;arDoneSet=new Set();_arFeedRefs.clear()
  const far=el('feed-ar');if(far)far.innerHTML='';feedCounts.ar=0
  if(activeTab==='ar'){const fc=el('feedCount');if(fc)fc.textContent='0 events'}
  updateARDemoDialer();arStartCallForAccount(arDemoAccounts[0])
}
async function arStartCallForAccount(account: any){
  arCallState='connecting';arAutoRunning=true;syncARBtn();showError('');dbg('[AR] → '+account.customer)
  const initBtn=el('ar-init-btn')
  if(initBtn){initBtn.innerHTML='<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3h2v10H5zM9 3h2v10H9z"/></svg> End Sequence';initBtn.classList.add('running')}
  try {
    const LK=await getLK()
    const roomName=newRoomName('ar');const token=await makeParticipantToken(roomName)
    if(arLkRoom){const old=arLkRoom;arLkRoom=null;await old.disconnect()}
    arTranscripts.forEach(e=>e.classList.add('tx-done'));arTranscripts.clear();arDialerTxMap.clear()
    const thisRoom=new LK.Room({adaptiveStream:true,dynacast:true})
    arLkRoom=thisRoom
    thisRoom.on(LK.RoomEvent.Disconnected,()=>{
      if(arLkRoom!==thisRoom)return
      arLkRoom=null;arCallState='idle';if(arDialerInt)clearInterval(arDialerInt)
      document.querySelectorAll('audio[data-lk-participant^="ar-"]').forEach((e:any)=>e.remove())
      if(arAutoRunning&&arDemoIdx<arDemoAccounts.length-1)arStartCountdownToNext()
      else if(arAutoRunning)arSequenceComplete()
    })
    thisRoom.on(LK.RoomEvent.TrackSubscribed,(track: any,_pub: any,p: any)=>{
      if(track.kind===LK.Track.Kind.Audio){const ae=track.attach();ae.dataset.lkParticipant='ar-'+p.sid;document.body.appendChild(ae);dbg('[AR] Audio attached')}
    })
    thisRoom.on(LK.RoomEvent.TrackUnsubscribed,(track: any)=>track.detach().forEach((e: any)=>e.remove()))
    thisRoom.on(LK.RoomEvent.ActiveSpeakersChanged,(spk: any[])=>{if(activeTab==='ar')updateAudioBars(spk.some(p=>p!==thisRoom.localParticipant))})
    thisRoom.on(LK.RoomEvent.ParticipantDisconnected,()=>{if(arLkRoom===thisRoom)thisRoom.disconnect()})
    await thisRoom.connect(LK_WS_URL,token);dbg('[AR] Connected · '+account.customer)
    await thisRoom.startAudio();await thisRoom.localParticipant.setMicrophoneEnabled(true);dbg('[AR] Audio unlocked')
    if(typeof thisRoom.registerTextStreamHandler==='function'){
      thisRoom.registerTextStreamHandler('lk.transcription',async(reader: any,pInfo: any)=>{
        const attrs=(reader.info?.attributes)||{};const segId=attrs['lk.segment_id'],isFinal=attrs['lk.transcription_final']!=='false'
        const isAgent=pInfo.identity!==thisRoom.localParticipant.identity;if(!segId&&!isFinal)return
        try{const text=await reader.readAll();arUpdateTranscript(segId||('ar-'+Date.now()),text,isAgent,isFinal)}catch(e){}
      })
      thisRoom.registerTextStreamHandler('lk.chat',async(reader: any,pInfo: any)=>{
        const isAgent=pInfo.identity!==thisRoom.localParticipant.identity
        try{const text=await reader.readAll();arUpdateTranscript('chat-'+Date.now(),text,isAgent,true)}catch(e){}
      })
    }
    await dispatchAgent(roomName,{use_case:'ar_collections'})
    arCallState='active';syncARBtn();if(arDialerInt)clearInterval(arDialerInt);arDialerSecs=0
    arDialerInt=setInterval(()=>{arDialerSecs++;const m=Math.floor(arDialerSecs/60),s=arDialerSecs%60;const dti=el('arDialerTimer');if(dti)dti.textContent=m+':'+String(s).padStart(2,'0')},1000)
    renderARAccounts();dbg('[AR] Live — '+account.customer)
  } catch(err:any){
    dbg('[AR] ERROR: '+(err.message||err));arCallState='idle';arAutoRunning=false;syncARBtn();showError(err.message||'AR call failed')
    const b=el('ar-init-btn');if(b){b.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/></svg> Call Aria · AR Collections';b.classList.remove('running');(b as HTMLButtonElement).disabled=false}
  }
}
function arStartCountdownToNext(){
  if(arDoneSet.has(arDemoIdx))return
  arDoneSet.add(arDemoIdx);renderARAccounts()
  const nextAccount=arDemoAccounts[arDemoIdx+1];let secs=8
  const dn=el('arDialerName'),dm=el('arDialerMeta'),dti=el('arDialerTimer'),dtr=el('arDialerTranscript')
  if(dn)dn.textContent='✓ '+arDemoAccounts[arDemoIdx].customer+' — Complete'
  if(dm)dm.textContent='Calling '+(nextAccount?nextAccount.customer:'...')+' in '+secs+'…'
  if(dti)dti.textContent=String(secs);if(dtr)dtr.innerHTML='';arDialerTxMap.clear()
  if(arCountdownInt)clearInterval(arCountdownInt)
  arCountdownInt=setInterval(()=>{
    secs--;if(secs>0){if(dm)dm.textContent='Calling '+(nextAccount?nextAccount.customer:'...')+' in '+secs+'…';if(dti)dti.textContent=String(secs)}
    else{if(arCountdownInt)clearInterval(arCountdownInt);arDemoIdx++;arDialerSecs=0;updateARDemoDialer();renderARAccounts();arStartCallForAccount(arDemoAccounts[arDemoIdx])}
  },1000)
}
function arSequenceComplete(){
  arDoneSet.add(arDemoIdx);if(arDialerInt)clearInterval(arDialerInt);if(arCountdownInt)clearInterval(arCountdownInt)
  arAutoRunning=false
  const dn=el('arDialerName'),dm=el('arDialerMeta'),dti=el('arDialerTimer'),dnx=el('arDialerNext'),ldc=el('arDialerCard'),rst=el('reset-btn')
  if(dn)dn.textContent='✓ Sequence Complete';if(dm)dm.textContent=arDemoAccounts.length+' accounts called — demo done'
  if(dti)dti.textContent='—';if(dnx)dnx.textContent='Done'
  renderARAccounts();syncARBtn()
  const b=el('ar-init-btn');if(b){b.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/></svg> Call Aria · AR Collections';b.classList.remove('running');(b as HTMLButtonElement).disabled=false}
  if(rst)rst.style.display='flex';setTimeout(()=>{if(ldc)ldc.classList.remove('visible')},4000)
}
function stopARSequence(){
  if(arDialerInt)clearInterval(arDialerInt);if(arCountdownInt)clearInterval(arCountdownInt);arCountdownInt=null
  arDemoIdx=-1;arDoneSet=new Set();arAutoRunning=false;arCallState='idle'
  if(arLkRoom){const r=arLkRoom;arLkRoom=null;r.disconnect()}
  document.querySelectorAll('audio[data-lk-participant^="ar-"]').forEach((e:any)=>e.remove())
  arTranscripts.forEach(e=>e.classList.add('tx-done'));arTranscripts.clear();arDialerTxMap.clear()
  const b=el('ar-init-btn');if(b){b.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/></svg> Call Aria · AR Collections';b.classList.remove('running');(b as HTMLButtonElement).disabled=false}
  const ldc=el('arDialerCard');if(ldc)ldc.classList.remove('visible');renderARAccounts();syncARBtn()
}
async function resetARDemo(){
  stopARSequence()
  await db.from('ar_accounts').update({
    status:'pending_call',call_status:'not_called',payment_date:null,call_summary:null,notes:null
  }).eq('is_demo_row',true)
  arHasCallMade=false;const r=el('reset-btn');if(r)r.style.display='none';await loadARData()
}
async function resetDemo(){
  await Promise.all([
    db.from('demo_loads').update({status:'new',created_by:'Dispatcher'}).eq('created_by','aria'),
    db.from('demo_loads').delete().eq('is_demo_row',true),
    db.from('demo_feed').delete().eq('is_demo_row',true)
  ])
  hasNewLoad=false;const r=el('reset-btn');if(r)r.style.display='none'
  const flt=el('feed-lt');if(flt)flt.innerHTML='';feedCounts.lt=0
  if(activeTab==='lt'){const fc=el('feedCount');if(fc)fc.textContent='0 events'}
  await loadData()
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(tab: string){
  activeTab=tab
  ;['lt','cc','ar'].forEach(t=>{
    const btn=el('t'+(t==='lt'?1:t==='cc'?2:3)),panel=el('panel-'+t),feed=el('feed-'+t)
    if(btn)btn.className='tab-btn'+(t===tab?' active':'')
    if(panel)panel.style.display=t===tab?'flex':'none'
    if(feed)feed.style.display=t===tab?'flex':'none'
  })
  const titles={lt:'Load Tender Feed',cc:'Carrier Check Feed',ar:'AR Collections Feed'}
  const ft=el('feedTitle'),fc=el('feedCount')
  if(ft)ft.textContent=titles[tab as keyof typeof titles]
  const n=feedCounts[tab as keyof typeof feedCounts]
  if(fc)fc.textContent=n+' event'+(n!==1?'s':'')
  if(tab==='lt')setTopbarCallState(callState)
  else if(tab==='cc')syncCCBtn()
  else syncARBtn()
}
function activeToggleCall(){
  if(activeTab==='lt')toggleCall()
  else if(activeTab==='cc'){if(ccAutoRunning)stopCCSequence();else ccInitializeUseCase()}
  else{if(arAutoRunning)stopARSequence();else arInitializeUseCase()}
}
function activeEndCall(){if(activeTab==='lt')endCall();else if(activeTab==='ar')stopARSequence();else hideCallModal()}
function activeResetDemo(){if(activeTab==='lt')resetDemo();else if(activeTab==='cc')resetCCDemo();else resetARDemo()}

// ── React component ───────────────────────────────────────────
export default function Page() {
  useEffect(() => {
    loadData(); subscribeRealtime()
    loadCCData(); subscribeCCRealtime()
    loadARData(); subscribeARRealtime()
    setTimeout(()=>{
      const pill=el('statusPill'),txt=el('statusText')
      if(pill&&txt&&pill.className.includes('connecting')){pill.className='status-pill idle';txt.textContent='Ready'}
    },3000)
  }, [])

  return (
    <>
      <header className="topbar">
        <a className="topbar-logo" href="#">
          <div className="logo-mark">
            <svg width="15" height="15" viewBox="0 0 28 28" fill="none">
              <path d="M16.2 2.5 6.4 15.1c-.5.64-.04 1.57.77 1.57h4.06l-1.6 8.06c-.18.9.97 1.43 1.53.7L21.6 12.4c.5-.65.04-1.58-.77-1.58h-4.2l1.65-7.55c.2-.9-.94-1.46-1.5-.77Z" fill="#fff"/>
            </svg>
          </div>
          <span className="logo-text">TRAK</span>
          <span className="logo-sub">&nbsp;by Flowgentic</span>
        </a>
        <div className="topbar-divider"></div>
        <span className="topbar-client">CSA Demo</span>
        <div className="topbar-spacer"></div>
        <div id="statusPill" className="status-pill connecting">
          <span className="status-dot"></span>
          <span id="statusText">Connecting…</span>
        </div>
        <button className="btn-call" id="call-btn" onClick={()=>activeToggleCall()}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.38a1.5 1.5 0 0 1 1.429 1.035l.5 1.5a1.5 1.5 0 0 1-.418 1.59l-.558.49a7.518 7.518 0 0 0 3.952 3.952l.49-.558a1.5 1.5 0 0 1 1.59-.418l1.5.5A1.5 1.5 0 0 1 14 11.62V13a1.5 1.5 0 0 1-1.5 1.5C6.201 14.5 1.5 9.799 1.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <path d="M10 2l1.5 1.5L10 5M11.5 3.5H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span id="call-label">Initialize Use Case</span>
        </button>
        <button className="btn-reset" id="reset-btn" onClick={()=>activeResetDemo()} style={{display:'none'}}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2 7A5 5 0 1 0 7 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M7 2 5 4.5 7.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Reset
        </button>
        <div className="audio-bars">
          {[0,1,2,3].map(i=><div key={i} className="audio-bar" style={{animationDelay:`${i*0.1}s`}}></div>)}
        </div>
      </header>

      <div className="tabs-bar">
        <button className="tab-btn" id="t1" onClick={()=>switchTab('lt')}>
          <svg className="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 7h6M5 10h4"/>
          </svg>
          Load Tender
        </button>
        <button className="tab-btn active" id="t2" onClick={()=>switchTab('cc')}>
          <svg className="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8h3l2-5 3 10 2-5h2"/>
          </svg>
          Track &amp; Trace
        </button>
        <button className="tab-btn" id="t3" onClick={()=>switchTab('ar')}>
          <svg className="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2v12M5 5h4.5a1.5 1.5 0 0 1 0 3H6a1.5 1.5 0 0 0 0 3H11"/>
          </svg>
          AR Collections
        </button>
      </div>

      <div className="main">
        <div className="left-panel">

          {/* LOAD TENDER */}
          <div id="panel-lt" style={{display:'none',flexDirection:'column',gap:'var(--space-5)'}}>
            <div className="info-banner">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flexShrink:0}}><circle cx="8" cy="8" r="5.5"/><path d="M8 7v4M8 5v.5" strokeLinecap="round"/></svg>
              <span><strong>Inbound agent.</strong> Carriers call Aria to book load tenders — Aria handles the conversation end-to-end without a human dispatcher.</span>
            </div>
            <div className="metrics-row">
              <div className="metric-card highlight">
                <div className="metric-eyebrow">Calls Today</div><div className="metric-desc">Inbound calls from carriers booking loads</div>
                <div className="metric-value" id="k1">12</div><div className="metric-delta delta-up">↑ 4 more than yesterday</div>
              </div>
              <div className="metric-card">
                <div className="metric-eyebrow">AI Handle Rate</div><div className="metric-desc">Calls closed by Aria — no dispatcher needed</div>
                <div className="metric-value"><span id="k2">91</span><span className="metric-unit">%</span></div>
                <div className="metric-delta delta-up">↑ 2 points vs last week</div>
              </div>
              <div className="metric-card">
                <div className="metric-eyebrow">Actions Taken</div><div className="metric-desc">Loads booked or actions completed by Aria</div>
                <div className="metric-value" id="k3">9</div><div className="metric-delta delta-flat">of 12 calls resulted in a booking</div>
              </div>
            </div>
            <div className="live-dialer-card" id="ltDialerCard">
              <div className="dialer-top">
                <div className="dialer-avatar"><span>A</span><div className="dialer-avatar-ring"></div></div>
                <div className="dialer-info">
                  <div className="dialer-badge"><span className="dialer-badge-dot"></span>Aria is answering</div>
                  <div className="dialer-name" id="ltDialerName">—</div>
                  <div className="dialer-meta" id="ltDialerSub">Inbound · Load Tender</div>
                </div>
                <div className="dialer-waveform">
                  {[0,.15,.3,.45,.6].map((d,i)=><div key={i} className="dialer-wave-bar" style={{animationDelay:`${d}s`}}></div>)}
                </div>
                <div className="dialer-timer" id="ltDialerTimer">0:00</div>
              </div>
              <div className="dialer-transcript" id="ltDialerTranscript"></div>
              <div className="dialer-end-row">
                <button className="btn-end-call" onClick={()=>endCall()}>End Call</button>
              </div>
            </div>
            <div>
              <div className="section-hdr">
                <div className="section-title">Active Loads — Saturn Freight Systems</div>
                <div style={{display:'flex',alignItems:'center',gap:'var(--space-2)'}}>
                  <span className="section-badge" id="lt-count">—</span>
                  <button className="btn-reset-inline" onClick={()=>resetDemo()}>↺ Reset</button>
                </div>
              </div>
              <div className="table-card">
                <div className="table-head lt-cols"><span>Shipper / Ref</span><span>Route</span><span>Service</span><span>Status</span><span>Created By</span></div>
                <div id="lt-table-body"><div className="feed-empty">Connecting to Supabase…</div></div>
              </div>
            </div>
          </div>

          {/* TRACK & TRACE */}
          <div id="panel-cc" style={{display:'flex',flexDirection:'column',gap:'var(--space-5)'}}>
            <div className="brand-banner">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flexShrink:0}}><path d="M2 8h3l2-5 3 10 2-5h2"/></svg>
              <span><strong>Outbound auto-dialer.</strong> Aria calls each carrier in sequence, logs status &amp; ETA, then moves to the next — no dispatcher needed.</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',flexWrap:'wrap'}}>
              <button className="btn-init-uc" id="cc-init-btn" onClick={()=>ccInitializeUseCase()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/>
                </svg>
                Initialize Use Case
              </button>
              <button className="btn-reset-inline" onClick={()=>resetCCDemo()}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 7A5 5 0 1 0 7 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M7 2 5 4.5 7.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Reset ETA / Summary
              </button>
              <span style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Auto-dials Marcus → Sandra → James (3 carriers)</span>
            </div>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-eyebrow">Calls Made</div><div className="metric-desc">Check-in calls placed by Aria</div>
                <div className="metric-value" id="cc-k1">0</div><div className="metric-delta delta-flat">Press Initialize to start</div>
              </div>
              <div className="metric-card">
                <div className="metric-eyebrow">Confirmed</div><div className="metric-desc">Carriers confirmed location &amp; ETA</div>
                <div className="metric-value" id="cc-k2">0</div><div className="metric-delta delta-flat">On track</div>
              </div>
              <div className="metric-card">
                <div className="metric-eyebrow">Pending</div><div className="metric-desc">Awaiting callback or no answer</div>
                <div className="metric-value" id="cc-k3">0</div><div className="metric-delta delta-flat">Flagged for follow-up</div>
              </div>
            </div>
            <div className="live-dialer-card" id="liveDialerCard">
              <div className="dialer-top">
                <div className="dialer-avatar"><span id="dialerInitial">A</span><div className="dialer-avatar-ring"></div></div>
                <div className="dialer-info">
                  <div className="dialer-badge"><span className="dialer-badge-dot"></span>Aria is calling</div>
                  <div className="dialer-name" id="dialerName">—</div>
                  <div className="dialer-meta" id="dialerMeta">—</div>
                </div>
                <div className="dialer-waveform">
                  {[0,.15,.3,.45,.6].map((d,i)=><div key={i} className="dialer-wave-bar" style={{animationDelay:`${d}s`}}></div>)}
                </div>
                <div className="dialer-timer" id="dialerTimer">0:00</div>
              </div>
              <div className="dialer-transcript" id="dialerTranscript"></div>
              <div className="dialer-progress-row">
                <span className="dialer-progress-text">Carrier <strong id="dialerCurrent">1</strong> of <strong id="dialerTotal">—</strong></span>
                <span className="dialer-next-text">Next: <strong id="dialerNext">—</strong></span>
              </div>
            </div>
            <div>
              <div className="section-hdr">
                <div className="section-title">Carrier Check Log</div>
                <span className="section-badge" id="cc-count">—</span>
              </div>
              <div className="table-card">
                <div className="table-head cc-cols"><span>Carrier / Ref</span><span>Route</span><span>Alert</span><span>Call Status</span><span>ETA / Summary</span></div>
                <div id="cc-table-body"><div className="feed-empty">Loading carrier data…</div></div>
              </div>
            </div>
          </div>

          {/* AR COLLECTIONS */}
          <div id="panel-ar" style={{display:'none',flexDirection:'column',gap:'var(--space-5)'}}>
            <div className="brand-banner">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flexShrink:0}}><path d="M8 2v12M5 5h4.5a1.5 1.5 0 0 1 0 3H6a1.5 1.5 0 0 0 0 3H11"/></svg>
              <span><strong>Outbound auto-dialer.</strong> Aria calls each overdue account in priority order, secures payment commitments, and escalates disputes — no AR specialist needed.</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',flexWrap:'wrap'}}>
              <button className="btn-init-uc" id="ar-init-btn" onClick={()=>arInitializeUseCase()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none"/>
                </svg>
                Call Aria · AR Collections
              </button>
              <button className="btn-reset-inline" onClick={()=>resetARDemo()}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 7A5 5 0 1 0 7 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M7 2 5 4.5 7.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Reset Demo
              </button>
              <span style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Auto-dials overdue accounts by priority</span>
            </div>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-eyebrow">Calls Made</div><div className="metric-desc">Collection calls placed this session</div>
                <div className="metric-value" id="ar-k1">0</div><div className="metric-delta delta-flat">Press Call Aria to start</div>
              </div>
              <div className="metric-card">
                <div className="metric-eyebrow">Promise to Pay</div><div className="metric-desc">Verbal commitments secured by Aria</div>
                <div className="metric-value"><span className="metric-unit">$</span><span id="ar-k2">0</span></div>
                <div className="metric-delta delta-flat">Committed</div>
              </div>
              <div className="metric-card">
                <div className="metric-eyebrow">Collected</div><div className="metric-desc">Payments confirmed received</div>
                <div className="metric-value"><span className="metric-unit">$</span><span id="ar-k3">0</span></div>
                <div className="metric-delta delta-flat">Cash in</div>
              </div>
            </div>
            <div className="live-dialer-card" id="arDialerCard">
              <div className="dialer-top">
                <div className="dialer-avatar"><span>A</span><div className="dialer-avatar-ring"></div></div>
                <div className="dialer-info">
                  <div className="dialer-badge"><span className="dialer-badge-dot"></span>Aria is calling</div>
                  <div className="dialer-name" id="arDialerName">—</div>
                  <div className="dialer-meta" id="arDialerMeta">—</div>
                </div>
                <div className="dialer-waveform">
                  {[0,.15,.3,.45,.6].map((d,i)=><div key={i} className="dialer-wave-bar" style={{animationDelay:`${d}s`}}></div>)}
                </div>
                <div className="dialer-timer" id="arDialerTimer">0:00</div>
              </div>
              <div className="dialer-transcript" id="arDialerTranscript"></div>
              <div className="dialer-progress-row">
                <span className="dialer-progress-text">Account <strong id="arDialerCurrent">1</strong> of <strong id="arDialerTotal">—</strong></span>
                <span className="dialer-next-text">Next: <strong id="arDialerNext">—</strong></span>
              </div>
            </div>
            <div>
              <div className="section-hdr">
                <div className="section-title">AR Accounts — Saturn Freight Systems</div>
                <span className="section-badge" id="ar-count">—</span>
              </div>
              <div className="table-card">
                <div className="table-head ar-cols"><span>Customer / Invoice</span><span>Amount Due</span><span>Days O/D</span><span>Call Status</span><span>Outcome / Summary</span></div>
                <div id="ar-table-body"><div className="feed-empty">Loading AR data…</div></div>
              </div>
            </div>
          </div>

        </div>

        <div className="right-panel">
          <div className="feed-header">
            <span className="feed-title" id="feedTitle">Carrier Check Feed</span>
            <span className="feed-count" id="feedCount">0 events</span>
          </div>
          <div className="feed-body" id="feed-lt" style={{display:'none'}}></div>
          <div className="feed-body" id="feed-cc"></div>
          <div className="feed-body" id="feed-ar" style={{display:'none'}}></div>
        </div>
      </div>

      <div className="call-overlay" id="callOverlay">
        <div className="call-modal">
          <div className="call-modal-header">
            <span className="call-modal-title">Live Call — Aria</span>
            <button className="call-close" onClick={()=>activeEndCall()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>
          <div className="call-avatar">
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <path d="M16.2 2.5 6.4 15.1c-.5.64-.04 1.57.77 1.57h4.06l-1.6 8.06c-.18.9.97 1.43 1.53.7L21.6 12.4c.5-.65.04-1.58-.77-1.58h-4.2l1.65-7.55c.2-.9-.94-1.46-1.5-.77Z" fill="var(--amber-500)"/>
            </svg>
          </div>
          <div className="call-name" id="callName">Aria</div>
          <div className="call-sub" id="callSub">Live Call</div>
          <div className="call-timer" id="callTimer">0:00</div>
          <div className="call-waveform">
            {[0,.12,.24,.36,.48,.6,.72].map((d,i)=><div key={i} className="wave-bar" style={{animationDelay:`${d}s`}}></div>)}
          </div>
          <div className="call-transcript-wrap" id="callTranscript"></div>
          <button className="btn-end-call" onClick={()=>activeEndCall()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 11.5v-1.38a1.5 1.5 0 0 0-1.035-1.429l-1.5-.5a1.5 1.5 0 0 0-1.59.418l-.35.4C8.11 9.05 7.09 9.05 5.975 8.535l-.1-.05C4.76 7.97 3.97 7.19 3.49 6.475l.41-.36a1.5 1.5 0 0 0 .418-1.59l-.5-1.5A1.5 1.5 0 0 0 2.38 2H1" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M12 4l-4 4M8 4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            End Call
          </button>
        </div>
      </div>
    </>
  )
}
