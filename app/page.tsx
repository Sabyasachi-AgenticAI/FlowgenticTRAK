'use client'

import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

// ── TYPES ──────────────────────────────────────────────
interface DriverRow {
  name: string; initial: string; truck: string; load: string
  route: string; location: string; eta: string; status: string; checkedAt: string
}
interface ScriptLine { speaker: string; text: string }
interface FeedItem { name: string; body: string; chips?: [string, string][]; time: string }
interface ARRow { debtor: string; invoice: string; balance: string; days: string; time: string; outcome: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiveRow = any

// ── SUPABASE CLIENT ────────────────────────────────────
const _sb = createClient(
  'https://xfhegmlpfqqbipzngjcu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmaGVnbWxwZnFxYmlwem5namN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzYzMTAsImV4cCI6MjA5NTgxMjMxMH0.4HTDuQ_pB9A3XNQa4wsbubrBwfE0l24FznFnFzQ1rfE'
)

// ── SEED DATA ──────────────────────────────────────────
const ltData = [
  { shipper:'Apex Freight Co.',   loadId:'LT-8821', origin:'Chicago, IL',      dest:'Dallas, TX',       pickup:'Jun 19', rate:'$2,400', status:'confirmed' },
  { shipper:'Midwest Cargo',      loadId:'LT-8822', origin:'St. Louis, MO',    dest:'Memphis, TN',      pickup:'Jun 19', rate:'$1,850', status:'pending'   },
  { shipper:'Eagle Logistics',    loadId:'LT-8823', origin:'Atlanta, GA',       dest:'Miami, FL',        pickup:'Jun 20', rate:'$3,100', status:'confirmed' },
  { shipper:'Titan Transport',    loadId:'LT-8824', origin:'Denver, CO',        dest:'Phoenix, AZ',      pickup:'Jun 20', rate:'$2,750', status:'callback'  },
  { shipper:'Summit Shipping',    loadId:'LT-8825', origin:'Seattle, WA',       dest:'Portland, OR',     pickup:'Jun 21', rate:'$1,200', status:'confirmed' },
  { shipper:'Pacific Haul',       loadId:'LT-8826', origin:'Los Angeles, CA',   dest:'Las Vegas, NV',    pickup:'Jun 21', rate:'$980',   status:'declined'  },
  { shipper:'BlueLine Co.',       loadId:'LT-8827', origin:'Houston, TX',       dest:'New Orleans, LA',  pickup:'Jun 22', rate:'$1,600', status:'pending'   },
  { shipper:'Keystone Trucking',  loadId:'LT-8828', origin:'Philadelphia, PA',  dest:'Boston, MA',       pickup:'Jun 22', rate:'$2,100', status:'confirmed' },
]

const driverData: DriverRow[] = [
  { name:'Marcus Johnson', initial:'M', truck:'TRK-441', load:'LT-8821', route:'Chicago → Dallas',      location:'Joplin, MO',         eta:'4:30 PM',  status:'pending', checkedAt:'' },
  { name:'Daria Reyes',    initial:'D', truck:'TRK-559', load:'LT-8823', route:'Atlanta → Miami',       location:'Gainesville, FL',    eta:'2:15 PM',  status:'pending', checkedAt:'' },
  { name:'Tommy Briggs',   initial:'T', truck:'TRK-782', load:'LT-8825', route:'Seattle → Portland',    location:'Tacoma, WA',         eta:'11:45 AM', status:'pending', checkedAt:'' },
  { name:'Sandeep Patel',  initial:'S', truck:'TRK-203', load:'LT-8828', route:'Philadelphia → Boston', location:'Hartford, CT',        eta:'3:00 PM',  status:'pending', checkedAt:'' },
  { name:'Linda Wu',       initial:'L', truck:'TRK-671', load:'LT-8822', route:'St. Louis → Memphis',   location:'Cape Girardeau, MO', eta:'2:00 PM',  status:'pending', checkedAt:'' },
  { name:'Carlos Mendez',  initial:'C', truck:'TRK-318', load:'LT-8827', route:'Houston → New Orleans', location:'Baton Rouge, LA',    eta:'12:45 PM', status:'pending', checkedAt:'' },
]
const driverOutcomes = ['acknowledged','acknowledged','no-answer','acknowledged','delayed','acknowledged']

const ccLiveScripts: ScriptLine[][] = [
  [
    { speaker:'aria',  text:'Hi James, Aria from Saturn Freight. Quick check on REF-29468, DFW to Atlanta — can you confirm your location and ETA?' },
    { speaker:'human', text:'Hey Aria, just past the Texas border. Should hit the Atlanta dock around 3:30 this afternoon.' },
    { speaker:'aria',  text:'Logged — on track for Thu 15:30 Atlanta. Drive safe James!' },
  ],
  [
    { speaker:'aria',  text:"Tony, Aria calling from Saturn Freight on REF-29465, ORD to JFK. Can you confirm you're en route?" },
    { speaker:'human', text:'Yes, just rolled through Gary Indiana. On schedule for JFK 7:45 tomorrow morning.' },
    { speaker:'aria',  text:'Confirmed — Gary IN, ETA Thu 07:45 JFK. All good. Thanks Tony!' },
  ],
  [
    { speaker:'aria',  text:"Marcus, this is Aria from Saturn Freight. REF-29472, Miami to LAX — our GPS shows no movement in over 90 minutes. Is everything okay?" },
    { speaker:'human', text:'' },
    { speaker:'aria',  text:'No answer from Marcus Webb — REF-29472 GPS inactive 97 minutes. Flagging for immediate manual dispatcher follow-up.' },
  ],
  [
    { speaker:'aria',  text:"Sandra, Aria here from Saturn Freight. REF-29471, LAX to Chicago — we're showing a temperature alert, 8.4 degrees versus a 5 degree threshold. Can you check the reefer?" },
    { speaker:'human', text:'On it — looks like the compressor cycled off. Resetting it now.' },
    { speaker:'aria',  text:'Temp breach logged on REF-29471. Sandra resetting reefer. Flagging for dispatcher review. ETA Chicago 14:00 unchanged.' },
  ],
]
const ccLiveOutcomes = ['acknowledged','acknowledged','no-answer','delayed']

const driverScripts: ScriptLine[][] = [
  [{ speaker:'aria',text:'Hi Marcus, Aria from CSA dispatch. Quick check-in on LT-8821 to Dallas — can you confirm your location and ETA?' },{ speaker:'human',text:'Hey Aria, just passed Joplin MO. Should roll into Dallas around 4:30 PM.' },{ speaker:'aria',text:'Logged — Joplin MO, ETA 4:30 PM. You are on track. Drive safe Marcus!' }],
  [{ speaker:'aria',text:'Hi Daria, Aria here from CSA. Checking in on LT-8823 to Miami. Where are you right now?' },{ speaker:'human',text:'Just past Gainesville Florida. Delivery around 2:15 this afternoon.' },{ speaker:'aria',text:'Got it — Gainesville FL, ETA 2:15 PM. All logged. Thanks Daria!' }],
  [{ speaker:'aria',text:'Hi Tommy, Aria from CSA. Check-in on LT-8825 Portland delivery. What is your current position?' },{ speaker:'human',text:'' },{ speaker:'aria',text:'No answer from Tommy Briggs on TRK-782. Leaving voicemail — flagging LT-8825 for manual follow-up.' }],
  [{ speaker:'aria',text:'Hi Sandeep, Aria calling from CSA about LT-8828 to Boston. Can you give me your location and ETA?' },{ speaker:'human',text:'I am in Hartford Connecticut. Estimating 3 PM arrival in Boston.' },{ speaker:'aria',text:'Logged — Hartford CT, ETA 3:00 PM. Right on schedule. Thanks Sandeep!' }],
  [{ speaker:'aria',text:'Hi Linda, Aria here from CSA. Checking in on LT-8822 Memphis run. Where are you and what is your ETA?' },{ speaker:'human',text:'Near Cape Girardeau. Had a tire issue — might be 30 minutes late, closer to 2 PM.' },{ speaker:'aria',text:'Understood — Cape Girardeau MO, revised ETA 2:00 PM, minor delay flagged. Thanks Linda!' }],
  [{ speaker:'aria',text:'Hi Carlos, Aria from CSA. Location check on LT-8827 New Orleans delivery.' },{ speaker:'human',text:'Hey, in Baton Rouge right now. Should be at the dock by 12:45.' },{ speaker:'aria',text:'Excellent — Baton Rouge LA, ETA 12:45 PM. All set. Talk soon Carlos!' }],
]

const arData: ARRow[] = [
  { debtor:'Pinnacle Foods Corp.',   invoice:'INV-3341', balance:'$14,200', days:'47', time:'8:55 AM',  outcome:'promise'  },
  { debtor:'Lakewood Distributors',  invoice:'INV-3298', balance:'$8,750',  days:'61', time:'9:10 AM',  outcome:'dispute'  },
  { debtor:'Hartwell Industries',    invoice:'INV-3315', balance:'$22,500', days:'33', time:'9:28 AM',  outcome:'paid'     },
  { debtor:'Greenfield Markets',     invoice:'INV-3307', balance:'$6,900',  days:'55', time:'9:45 AM',  outcome:'promise'  },
  { debtor:'Coastal Fresh LLC',      invoice:'INV-3352', balance:'$11,400', days:'29', time:'10:05 AM', outcome:'voicemail'},
]

const transcripts: Record<string, ScriptLine[]> = {
  lt: [
    { speaker:'human', text:"Hi, I'm calling about booking a load — I saw the posting for Indianapolis to Nashville." },
    { speaker:'aria',  text:"Hi! Thanks for calling CSA. I'm Aria, your booking assistant. That's load LT-8829, picking up June 20th, dry van, $2,200 all-in. Ready to confirm?" },
    { speaker:'human', text:'Yes, MC number is 443201, we have a 53-foot dry van available.' },
    { speaker:'aria',  text:"Perfect — MC-443201 verified. Booking confirmed for June 20th pickup in Indianapolis. I'll send the rate confirmation to your email now. Anything else?" },
    { speaker:'human', text:"No that's all, thank you." },
    { speaker:'aria',  text:"Great — you're all set! Safe travels." },
  ],
  cc: [
    { speaker:'aria',  text:"Hi, this is Aria from CSA dispatch. I'm looking for available dry van capacity on the Chicago to Dallas lane for June 19th." },
    { speaker:'human', text:"We might have something. What's the weight?" },
    { speaker:'aria',  text:"It's 42,000 lbs, full truckload. Rate is $2,400 all-in." },
    { speaker:'human', text:'Let me check with our driver. Can I call you back in 20 minutes?' },
    { speaker:'aria',  text:"Absolutely. I'll log you as pending. We'll await your callback. Thank you!" },
  ],
  ar: [
    { speaker:'aria',  text:"Good morning, this is Aria calling from CSA regarding invoice INV-3360 for $9,800 which is 38 days past due." },
    { speaker:'human', text:"I'm aware of that invoice." },
    { speaker:'aria',  text:"Wonderful. Could you arrange payment this week to avoid a late fee? We accept ACH, check, or credit card." },
    { speaker:'human', text:'We can do ACH by Friday.' },
    { speaker:'aria',  text:"Friday ACH noted. I'll update our records and send you a payment link. Thank you!" },
  ],
}

// ── MODULE STATE ───────────────────────────────────────
let ccLiveData: LiveRow[] = []
let activeTab = 'lt'
let callActive = false
let callSeconds = 0
let callTimerInterval: ReturnType<typeof setInterval> | null = null
let transcriptLines: ScriptLine[] = []
let feedItems: FeedItem[] = []
let arRows: ARRow[] = []
let ccAutoRunning = false
let ccDriverIdx = 0
let ccDialerInt: ReturnType<typeof setInterval> | null = null
let ccDialerSecs = 0
let ccTransLines: ScriptLine[] = []

// ── HELPERS ────────────────────────────────────────────
function chip(label: string, cls: string) {
  return `<span class="chip ${cls}"><span class="chip-dot"></span>${label}</span>`
}
function statusChip(s: string) {
  const map: Record<string, string> = {
    confirmed:  chip('Confirmed', 'chip-success'),
    pending:    chip('Pending',   'chip-warning'),
    callback:   chip('Callback',  'chip-info'),
    declined:   chip('Declined',  'chip-danger'),
    'no-answer':chip('No Answer', 'chip-neutral'),
    promise:    chip('Promise',   'chip-success'),
    dispute:    chip('Dispute',   'chip-danger'),
    paid:       chip('Paid',      'chip-success'),
    voicemail:  chip('Voicemail', 'chip-neutral'),
  }
  return map[s] || chip(s, 'chip-neutral')
}
function nowTime() {
  const d = new Date()
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0')
}
function el(id: string) { return document.getElementById(id)! }

// ── ALERT HELPERS ─────────────────────────────────────
function computeAlerts(row: LiveRow) {
  const alerts: { type: string; mins?: number; temp?: number; thr?: number }[] = []
  if (row.gps_last_moved_at) {
    const mins = (Date.now() - new Date(row.gps_last_moved_at).getTime()) / 60000
    if (mins >= 90) alerts.push({ type:'gps', mins: Math.round(mins) })
  }
  if (row.temp_c != null && row.temp_threshold_c != null &&
      parseFloat(row.temp_c) > parseFloat(row.temp_threshold_c)) {
    alerts.push({ type:'temp', temp: row.temp_c, thr: row.temp_threshold_c })
  }
  return alerts
}

// ── SUPABASE ───────────────────────────────────────────
async function loadCCLive() {
  const { data } = await _sb.from('carrier_check_loads').select('*').order('id', { ascending:true })
  if (data && data.length) {
    ccLiveData = data
    renderDriverTable()
    updateCCMetrics()
  }
}
function updateCCMetrics() {
  const called    = ccLiveData.filter(r => r.call_status === 'completed').length
  const confirmed = ccLiveData.filter(r => r.call_status === 'completed' && (r.status === 'confirmed' || r.status === 'delayed')).length
  const noAns     = ccLiveData.filter(r => r.status === 'rescheduled').length
  el('cc-calls').textContent     = String(called)
  el('cc-confirmed').textContent = String(confirmed)
  el('cc-pending').textContent   = String(noAns)
  el('cc-count').textContent     = confirmed + ' of ' + ccLiveData.length + ' drivers'
}

// ── RENDER FUNCTIONS ───────────────────────────────────
function renderLT() {
  el('lt-table-body').innerHTML = ltData.map(r => `
    <div class="table-row">
      <div><div class="cell-primary">${r.shipper}</div><div class="cell-mono">${r.loadId}</div></div>
      <div class="cell-muted" style="font-size:var(--text-xs)">${r.origin} → ${r.dest}</div>
      <div class="cell-muted">${r.pickup}</div>
      <div style="font-family:var(--font-mono);font-size:var(--text-sm);color:var(--text-secondary);font-weight:600">${r.rate}</div>
      <div>${statusChip(r.status)}</div>
    </div>`).join('')
  el('lt-count').textContent = ltData.length + ' loads'
}

function renderDriverTable() {
  const body = document.getElementById('cc-table-body')
  if (!body) return
  if (!ccLiveData.length) {
    body.innerHTML = '<div class="feed-empty">Connecting to live data… <span class="live-dot"></span></div>'
    return
  }
  const simMap: Record<string, string> = {}
  if (ccAutoRunning) driverData.forEach((d, i) => { if (ccLiveData[i]) simMap[ccLiveData[i].ref] = d.status })

  const stLabel: Record<string,string> = {
    confirmed:'Confirmed',completed:'Confirmed',pending_check:'Pending',not_called:'Queued',
    rescheduled:'Rescheduled',issue_raised:'Issue Raised',acknowledged:'Checked In',
    delayed:'Delay Noted','no-answer':'No Answer',pending:'Queued',calling:'Calling…',
  }
  const stCls: Record<string,string> = {
    confirmed:'chip-success',completed:'chip-success',pending_check:'chip-warning',not_called:'chip-neutral',
    rescheduled:'chip-info',issue_raised:'chip-danger',acknowledged:'chip-success',
    delayed:'chip-warning','no-answer':'chip-neutral',pending:'chip-neutral',
  }

  body.innerHTML = ccLiveData.map((row: LiveRow) => {
    const alerts  = computeAlerts(row)
    const hasGPS  = alerts.some(a => a.type === 'gps')
    const hasTemp = alerts.some(a => a.type === 'temp')
    const simSt   = simMap[row.ref]
    const idle    = !ccAutoRunning && !hasGPS && !hasTemp && (row.call_status === 'not_called' || row.call_status === 'pending_check')
    let rowCls    = 'table-row'
    if (hasGPS) rowCls += ' row-alert-gps'
    else if (hasTemp) rowCls += ' row-alert-temp'
    const rowStyle = simSt === 'calling' ? 'background:rgba(245,158,11,0.09);' : idle ? 'opacity:.6;' : ''
    const alertHtml = alerts.length
      ? alerts.map(a => a.type==='gps'
          ? `<span class="chip chip-danger"><span class="chip-dot"></span>GPS&nbsp;${a.mins}m&nbsp;idle</span>`
          : `<span class="chip chip-warning"><span class="chip-dot"></span>${a.temp}°C&nbsp;&gt;&nbsp;${a.thr}°C</span>`
        ).join('<br style="margin:2px 0">')
      : `<span style="color:var(--text-muted);font-size:11px">—</span>`
    const effSt = simSt || row.call_status || row.status || 'not_called'
    const statusHtml = effSt === 'calling'
      ? `<span class="chip chip-warning"><span class="chip-dot" style="animation:pulseDot 1s infinite"></span>Calling…</span>`
      : `<span class="chip ${stCls[effSt]||'chip-neutral'}"><span class="chip-dot"></span>${stLabel[effSt]||effSt}</span>`
    const name    = row.driver_name || row.carrier
    const phone   = row.driver_phone || row.carrier_phone || '—'
    const loc     = row.last_location || '—'
    const eta     = row.last_eta || row.eta_confirmed || '—'
    const summary = row.call_summary || `<span style="color:var(--text-muted);font-style:italic">Awaiting call…</span>`
    const route   = row.route || (row.origin + ' → ' + row.destination)
    return `<div class="${rowCls}" style="${rowStyle}">
      <div class="cell-primary">${name}</div>
      <div class="cell-mono" style="color:var(--amber-500);font-size:11px;word-break:break-all">${phone}</div>
      <div><div class="cell-primary" style="font-size:var(--text-xs)">${route}</div><div class="cell-mono">${row.ref}</div></div>
      <div><div class="cell-muted" style="font-size:var(--text-xs)">${loc}</div><div class="cell-mono" style="font-size:11px">${eta}</div></div>
      <div style="font-size:var(--text-xs);line-height:1.45;color:var(--text-secondary)">${summary}</div>
      <div>${alertHtml}</div>
      <div>${statusHtml}</div>
    </div>`
  }).join('')
}

function renderAR() {
  if (!arRows.length) {
    el('ar-table-body').innerHTML = '<div class="feed-empty">No collection calls yet. Click <strong>Call Aria</strong> to begin.</div>'
    return
  }
  el('ar-table-body').innerHTML = arRows.map(r => `
    <div class="table-row">
      <div><div class="cell-primary">${r.debtor}</div><div class="cell-mono">${r.invoice}</div></div>
      <div style="font-family:var(--font-mono);font-size:var(--text-sm);color:var(--text-secondary);font-weight:600">${r.balance}</div>
      <div class="cell-muted">${r.days}d</div>
      <div class="cell-mono">${r.time}</div>
      <div>${statusChip(r.outcome)}</div>
    </div>`).join('')
  el('ar-count').textContent = arRows.length + ' accounts'
}

function addFeedItem(name: string, body: string, chips?: [string, string][]) {
  feedItems.unshift({ name, body, chips, time: nowTime() })
  renderFeed()
}
function renderFeed() {
  const feedEl = el('feedBody')
  if (!feedItems.length) {
    feedEl.innerHTML = '<div class="feed-empty">No activity yet.</div>'
    el('feedCount').textContent = '0 events'
    return
  }
  feedEl.innerHTML = feedItems.map(f => `
    <div class="feed-item">
      <div class="feed-item-top">
        <span class="feed-item-name">${f.name}</span>
        <span class="feed-item-time">${f.time}</span>
      </div>
      <div class="feed-item-body">${f.body}</div>
      ${f.chips ? `<div class="feed-item-chips">${f.chips.map(c => chip(c[0], c[1])).join('')}</div>` : ''}
    </div>`).join('')
  el('feedCount').textContent = feedItems.length + ' event' + (feedItems.length !== 1 ? 's' : '')
}

// ── TAB SWITCH ────────────────────────────────────────
function switchTab(tab: string, btn: HTMLElement) {
  activeTab = tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  ;(['lt','cc','ar'] as const).forEach(t => {
    const p = document.getElementById('panel-' + t)
    if (p) p.style.display = t === tab ? 'flex' : 'none'
  })
  const titles: Record<string,string> = { lt:'Load Tender Feed', cc:'Carrier Check Feed', ar:'AR Collections Feed' }
  el('feedTitle').textContent = titles[tab]
}

// ── CALL MODAL ────────────────────────────────────────
const callSubtitles: Record<string,string> = { lt:'Inbound · Carrier Booking', ar:'Outbound · AR Collections' }
const callNames: Record<string,string>     = { lt:'Incoming — Carrier on the line', ar:'INV-3360 · $9,800 Due' }

function startCall() {
  callActive = true; callSeconds = 0; transcriptLines = []
  el('callOverlay').classList.add('visible')
  el('callName').textContent  = callNames[activeTab] || 'Aria'
  el('callSub').textContent   = callSubtitles[activeTab]
  el('callTranscript').innerHTML = ''
  el('callTimer').textContent = '0:00'
  el('statusPill').className  = 'status-pill live'
  el('statusText').textContent = 'Live'
  el('callBtnText').textContent = 'End Call'
  el('callBtn').classList.add('active')
  if (callTimerInterval) clearInterval(callTimerInterval)
  callTimerInterval = setInterval(() => {
    callSeconds++
    el('callTimer').textContent = Math.floor(callSeconds/60) + ':' + String(callSeconds%60).padStart(2,'0')
  }, 1000)
  ;(transcripts[activeTab] || transcripts.lt).forEach((line, i) => {
    setTimeout(() => {
      transcriptLines.push(line)
      const t = el('callTranscript')
      t.innerHTML = transcriptLines.map(l => `
        <div class="transcript-line ${l.speaker==='aria'?'transcript-aria':'transcript-human'}">
          <span class="transcript-label">${l.speaker==='aria'?'⚡ Aria':'👤 Contact'}:</span>${l.text}
        </div>`).join('')
      t.scrollTop = t.scrollHeight
    }, (i+1)*2800)
  })
}

function endCall() {
  if (!callActive) return
  callActive = false
  if (callTimerInterval) clearInterval(callTimerInterval)
  el('callOverlay').classList.remove('visible')
  el('statusPill').className   = 'status-pill idle'
  el('statusText').textContent = 'Idle'
  el('callBtnText').textContent = 'Call Aria'
  el('callBtn').classList.remove('active')
  const durStr = Math.floor(callSeconds/60) + ':' + String(callSeconds%60).padStart(2,'0')
  if (activeTab === 'lt') {
    el('lt-calls').textContent   = String(parseInt(el('lt-calls').textContent!) + 1)
    el('lt-actions').textContent = String(parseInt(el('lt-actions').textContent!) + 1)
    addFeedItem('Load Tender · LT-8829', 'Aria tendered Indy → Nashville, $2,200 dry van. Contact confirmed.', [['Confirmed','chip-success'],['$2,200','chip-info']])
  } else if (activeTab === 'ar') {
    const idx = arRows.length
    if (idx < arData.length) arRows.push(arData[idx])
    else {
      const amt = (Math.floor(Math.random()*20)+5)*1000
      arRows.push({ debtor:'Debtor Corp '+(idx+1), invoice:'INV-'+(3360+idx), balance:'$'+amt.toLocaleString(), days:String(Math.floor(Math.random()*60)+20), time:nowTime(), outcome:['promise','voicemail','paid'][Math.floor(Math.random()*3)] })
    }
    const row = arRows[arRows.length-1]
    el('ar-calls').textContent = String(arRows.length)
    const promised  = arRows.filter(r=>r.outcome==='promise').reduce((s,r)=>s+parseInt(r.balance.replace(/[^0-9]/g,'')),0)
    const collected = arRows.filter(r=>r.outcome==='paid').reduce((s,r)=>s+parseInt(r.balance.replace(/[^0-9]/g,'')),0)
    el('ar-promised').textContent  = promised.toLocaleString()
    el('ar-collected').textContent = collected.toLocaleString()
    renderAR()
    addFeedItem('AR Collections · '+row.debtor, `Collection attempt on ${row.invoice} (${row.balance}, ${row.days}d overdue). Duration: ${durStr}.`, [[row.outcome==='promise'?'Promise to Pay':row.outcome==='paid'?'Paid':'Voicemail',row.outcome==='paid'?'chip-success':row.outcome==='promise'?'chip-info':'chip-neutral']])
  }
  setTimeout(() => {
    el('statusPill').className   = 'status-pill connecting'
    el('statusText').textContent = 'Ready'
  }, 1500)
}

// ── CC AUTO-DIALER ────────────────────────────────────
function startCCSequence() {
  ccAutoRunning = true; ccDriverIdx = 0
  if (ccLiveData.length) {
    driverData.length = 0
    ccLiveData.forEach((row: LiveRow) => driverData.push({
      name: row.driver_name || row.carrier,
      initial: (row.driver_name || row.carrier || 'X')[0].toUpperCase(),
      truck: row.ref, load: row.ref,
      route: row.route || (row.origin+' → '+row.destination),
      location: row.last_location || '—', eta: row.last_eta || row.eta_confirmed || '—',
      status:'pending', checkedAt:'',
    }))
  } else { driverData.forEach(d => { d.status='pending'; d.checkedAt='' }) }
  ;(['cc-calls','cc-confirmed','cc-pending'] as const).forEach(id => { el(id).textContent='0' })
  el('cc-count').textContent = '0 of '+driverData.length+' drivers'
  renderDriverTable()
  el('callBtnText').textContent = 'Stop Sequence'
  el('callBtn').classList.add('active')
  el('statusPill').className   = 'status-pill live'
  el('statusText').textContent = 'Live'
  dialNextDriver()
}

function dialNextDriver() {
  if (!ccAutoRunning) return
  if (ccDriverIdx >= driverData.length) { stopCCSequence(); return }
  const driver = driverData[ccDriverIdx], next = driverData[ccDriverIdx+1]
  driver.status='calling'; ccDialerSecs=0; ccTransLines=[]
  renderDriverTable()
  el('liveDialerCard').classList.add('visible')
  el('dialerInitial').textContent = driver.initial
  el('dialerName').textContent    = driver.name
  el('dialerMeta').textContent    = driver.truck+' · '+driver.load+' · '+driver.route
  el('dialerCurrent').textContent = String(ccDriverIdx+1)
  el('dialerTotal').textContent   = String(driverData.length)
  el('dialerNext').textContent    = next ? next.name : 'Last driver'
  el('dialerTimer').textContent   = '0:00'
  el('dialerTranscript').innerHTML= ''
  if (ccDialerInt) clearInterval(ccDialerInt)
  ccDialerInt = setInterval(() => {
    ccDialerSecs++
    el('dialerTimer').textContent = Math.floor(ccDialerSecs/60)+':'+String(ccDialerSecs%60).padStart(2,'0')
  }, 1000)
  const scripts = ccLiveData.length ? ccLiveScripts : driverScripts
  ;(scripts[ccDriverIdx]||[]).forEach((line,i) => setTimeout(() => {
    if (!ccAutoRunning) return
    ccTransLines.push(line)
    const t = el('dialerTranscript')
    t.innerHTML = ccTransLines.map(l =>
      `<div class="dialer-transcript-line ${l.speaker==='aria'?'dialer-t-aria':'dialer-t-human'}"><span class="dialer-t-label">${l.speaker==='aria'?'⚡ Aria':'👤 Driver'}:</span>${l.text}</div>`
    ).join('')
    t.scrollTop = t.scrollHeight
  }, (i+1)*2800))
  setTimeout(() => completeDriverCall(driver), 10000)
}

function completeDriverCall(driver: DriverRow) {
  if (ccDialerInt) clearInterval(ccDialerInt)
  if (!ccAutoRunning) return
  const outcomes = ccLiveData.length ? ccLiveOutcomes : driverOutcomes
  const outcome  = outcomes[ccDriverIdx] || 'acknowledged'
  driver.status  = outcome; driver.checkedAt = nowTime()
  if (ccLiveData[ccDriverIdx]) {
    const row       = ccLiveData[ccDriverIdx]
    const newStatus = outcome==='acknowledged'||outcome==='delayed' ? 'confirmed' : 'rescheduled'
    const sc        = (ccLiveData.length ? ccLiveScripts : driverScripts)[ccDriverIdx] || []
    _sb.from('carrier_check_loads').update({
      call_status:'completed', status:newStatus, call_summary: sc.length ? sc[sc.length-1].text : '',
    }).eq('ref', row.ref).then(() => loadCCLive())
  }
  el('cc-calls').textContent     = String(ccDriverIdx+1)
  el('cc-confirmed').textContent = String(driverData.filter(d=>d.status==='acknowledged'||d.status==='delayed').length)
  el('cc-pending').textContent   = String(driverData.filter(d=>d.status==='no-answer').length)
  el('cc-count').textContent     = (ccDriverIdx+1)+' of '+driverData.length+' drivers'
  renderDriverTable()
  const label = outcome==='acknowledged'?'On Track':outcome==='delayed'?'Minor Delay':'No Answer'
  const cls   = outcome==='acknowledged'?'chip-success':outcome==='delayed'?'chip-warning':'chip-neutral'
  addFeedItem('Check-in · '+driver.name, driver.truck+' on '+driver.load+'. Location: '+driver.location+'. ETA: '+driver.eta+'.', [[label,cls]])
  ccDriverIdx++
  if (ccDriverIdx < driverData.length) setTimeout(()=>dialNextDriver(),1800)
  else setTimeout(()=>stopCCSequence(),1200)
}

function stopCCSequence() {
  ccAutoRunning=false
  if (ccDialerInt) clearInterval(ccDialerInt)
  el('liveDialerCard').classList.remove('visible')
  el('callBtnText').textContent = 'Initialize Use Case'
  el('callBtn').classList.remove('active')
  el('statusPill').className   = 'status-pill connecting'
  el('statusText').textContent = 'Ready'
}

function toggleCall() {
  if (activeTab==='cc') { ccAutoRunning ? stopCCSequence() : startCCSequence(); return }
  if (callActive) { endCall(); return }
  startCall()
}

function resetDashboard() {
  arRows=[]; feedItems=[]
  driverData.forEach(d=>{ d.status='pending'; d.checkedAt='' })
  if (ccAutoRunning) stopCCSequence()
  el('liveDialerCard').classList.remove('visible')
  if (ccLiveData.length) {
    ccLiveData.forEach((row: LiveRow) =>
      _sb.from('carrier_check_loads').update({ call_status:'not_called', status:'pending_check', call_summary:null }).eq('ref', row.ref)
    )
    setTimeout(loadCCLive, 600)
  }
  el('cc-count').textContent     = '0 of '+driverData.length+' drivers'
  el('lt-calls').textContent     = '12'
  el('lt-actions').textContent   = '9'
  el('lt-contained').textContent = '91'
  el('cc-calls').textContent     = '0'
  el('cc-confirmed').textContent = '0'
  el('cc-pending').textContent   = '0'
  el('ar-calls').textContent     = '0'
  el('ar-promised').textContent  = '0'
  el('ar-collected').textContent = '0'
  renderDriverTable(); renderAR(); renderFeed()
}

// ── COMPONENT ─────────────────────────────────────────
export default function Dashboard() {
  useEffect(() => {
    renderLT()
    renderAR()
    loadCCLive()

    const channel = _sb.channel('cc-realtime')
      .on('postgres_changes', { event:'*', schema:'public', table:'carrier_check_loads' }, () => loadCCLive())
      .subscribe()

    setTimeout(() => {
      el('statusPill').className   = 'status-pill connecting'
      el('statusText').textContent = 'Ready'
    }, 1500)

    setTimeout(() => {
      addFeedItem('Load Tender · LT-8821', 'Aria reached Apex Freight Co. Load confirmed — Chicago → Dallas, Jun 19, $2,400.', [['Confirmed','chip-success'],['$2,400','chip-info']])
      addFeedItem('Load Tender · LT-8823', 'Eagle Logistics accepted Atlanta → Miami load. Rate confirmed at $3,100.',          [['Confirmed','chip-success'],['$3,100','chip-info']])
      addFeedItem('Load Tender · LT-8824', 'Titan Transport requested callback. Load LT-8824 Denver → Phoenix pending.',        [['Callback Requested','chip-warning']])
      addFeedItem('Load Tender · LT-8826', 'Pacific Haul declined LA → Las Vegas at $980. Seeking alternative carrier.',        [['Declined','chip-danger']])
      renderFeed()
    }, 600)

    return () => { _sb.removeChannel(channel) }
  }, [])

  return (
    <>
      <header className="topbar">
        <a className="topbar-logo" href="#">
          <div className="logo-mark" style={{background:'var(--blue-600)'}}>
            <svg width="15" height="15" viewBox="0 0 28 28" fill="none">
              <path d="M16.2 2.5 6.4 15.1c-.5.64-.04 1.57.77 1.57h4.06l-1.6 8.06c-.18.9.97 1.43 1.53.7L21.6 12.4c.5-.65.04-1.58-.77-1.58h-4.2l1.65-7.55c.2-.9-.94-1.46-1.5-.77Z" fill="#fff" />
            </svg>
          </div>
          <span className="logo-text">TRAK</span>
          <span className="logo-sub">by Flowgentic</span>
        </a>
        <div className="topbar-divider"></div>
        <span className="topbar-client">CSA Demo</span>
        <div className="topbar-spacer"></div>
        <div id="statusPill" className="status-pill connecting">
          <span className="status-dot"></span>
          <span id="statusText">Connecting…</span>
        </div>
        <button className="btn-call" id="callBtn" onClick={() => toggleCall()}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.38a1.5 1.5 0 0 1 1.429 1.035l.5 1.5a1.5 1.5 0 0 1-.418 1.59l-.558.49a7.518 7.518 0 0 0 3.952 3.952l.49-.558a1.5 1.5 0 0 1 1.59-.418l1.5.5A1.5 1.5 0 0 1 14 11.62V13a1.5 1.5 0 0 1-1.5 1.5C6.201 14.5 1.5 9.799 1.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <path d="M10 2l1.5 1.5L10 5M11.5 3.5H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span id="callBtnText">Initialize Use Case</span>
        </button>
        <button className="btn-reset" onClick={() => resetDashboard()}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2 7A5 5 0 1 0 7 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M7 2 5 4.5 7.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Reset
        </button>
      </header>

      <div className="tabs-bar">
        <button className="tab-btn active" onClick={(e) => switchTab('lt', e.currentTarget as HTMLElement)}>
          <svg className="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 7h6M5 10h4"/>
          </svg>
          Load Tender
        </button>
        <button className="tab-btn" onClick={(e) => switchTab('cc', e.currentTarget as HTMLElement)}>
          <svg className="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8h3l2-5 3 10 2-5h2"/>
          </svg>
          Track &amp; Trace
        </button>
        <button className="tab-btn" onClick={(e) => switchTab('ar', e.currentTarget as HTMLElement)}>
          <svg className="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2v12M5 5h4.5a1.5 1.5 0 0 1 0 3H6a1.5 1.5 0 0 0 0 3H11"/>
          </svg>
          AR Collections
        </button>
      </div>

      <div className="main">
        <div className="left-panel">

          {/* LOAD TENDER */}
          <div id="panel-lt" className="tab-panel active" style={{display:'flex',flexDirection:'column',gap:'var(--space-5)'}}>
            <div style={{background:'var(--info-bg)',border:'1px solid var(--blue-100)',borderRadius:'var(--radius-md)',padding:'var(--space-3) var(--space-4)',display:'flex',alignItems:'center',gap:'var(--space-3)',fontSize:'var(--text-sm)',color:'var(--info-fg)'}}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flexShrink:0}}><circle cx="8" cy="8" r="5.5"/><path d="M8 7v4M8 5v.5" strokeLinecap="round"/></svg>
              <span><strong>Inbound agent.</strong> Carriers call Aria to book load tenders — Aria handles the conversation end-to-end without a human dispatcher.</span>
            </div>
            <div className="metrics-row">
              <div className="metric-card highlight">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 3.5A1.5 1.5 0 0 0 11.5 2h-1.38a1.5 1.5 0 0 0-1.429 1.035l-.5 1.5a1.5 1.5 0 0 0 .418 1.59l.558.49a7.518 7.518 0 0 1-3.952 3.952l-.49-.558a1.5 1.5 0 0 0-1.59-.418l-1.5.5A1.5 1.5 0 0 0 1 11.62V13a1.5 1.5 0 0 0 1.5 1.5c6.299 0 11-4.701 11-10.5V3.5Z"/></svg></div>
                <div className="metric-eyebrow">Tenders Received</div>
                <div className="metric-desc">Inbound calls from carriers booking loads today</div>
                <div className="metric-value" id="lt-calls">12</div>
                <div className="metric-delta delta-up">↑ 4 more than yesterday</div>
              </div>
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8l2 2 3-3"/></svg></div>
                <div className="metric-eyebrow">AI Handle Rate</div>
                <div className="metric-desc">Inbound calls closed by Aria — no dispatcher needed</div>
                <div className="contained-wrap">
                  <div><div className="metric-value"><span id="lt-contained">91</span><span className="metric-unit">%</span></div></div>
                  <svg className="donut-svg" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="20" fill="none" stroke="var(--border-subtle)" strokeWidth="5"/>
                    <circle id="lt-donut" cx="26" cy="26" r="20" fill="none" stroke="var(--amber-500)" strokeWidth="5" strokeDasharray="114.6 125.7" strokeDashoffset="31.4" strokeLinecap="round" transform="rotate(-90 26 26)"/>
                  </svg>
                </div>
                <div className="metric-delta delta-up">↑ 2 points vs last week</div>
              </div>
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8h10M9 4l4 4-4 4"/></svg></div>
                <div className="metric-eyebrow">Bookings Completed</div>
                <div className="metric-desc">Loads successfully booked by Aria on this call</div>
                <div className="metric-value" id="lt-actions">9</div>
                <div className="metric-delta delta-flat">of 12 inbound calls resulted in a booking</div>
              </div>
            </div>
            <div>
              <div className="section-header" style={{marginBottom:'var(--space-3)'}}>
                <div className="section-title">Load Tenders</div>
                <span className="section-badge" id="lt-count">12 loads</span>
              </div>
              <div className="table-card lt-table">
                <div className="table-head">
                  <span>Shipper / Load ID</span><span>Origin → Dest</span><span>Pickup</span><span>Rate</span><span>Status</span>
                </div>
                <div id="lt-table-body"></div>
              </div>
            </div>
          </div>

          {/* TRACK & TRACE */}
          <div id="panel-cc" style={{display:'none',flexDirection:'column',gap:'var(--space-5)'}}>
            <div style={{background:'var(--surface-brand-tint)',border:'1px solid var(--amber-100)',borderRadius:'var(--radius-md)',padding:'var(--space-3) var(--space-4)',display:'flex',alignItems:'center',gap:'var(--space-3)',fontSize:'var(--text-sm)',color:'var(--text-brand)'}}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flexShrink:0}}><path d="M2 8h3l2-5 3 10 2-5h2"/></svg>
              <span><strong>Outbound auto-dialer.</strong> Aria calls each active driver in sequence, logs their location &amp; ETA, then moves to the next automatically — no dispatcher needed.</span>
            </div>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5c0 5.799 4.701 10.5 10.5 10.5A1.5 1.5 0 0 0 14 12.5v-1.38a1.5 1.5 0 0 0-1.035-1.429l-1.5-.5a1.5 1.5 0 0 0-1.59.418l-.49.558a7.518 7.518 0 0 1-3.952-3.952l.558-.49a1.5 1.5 0 0 0 .418-1.59l-.5-1.5A1.5 1.5 0 0 0 4.88 2H3.5Z"/></svg></div>
                <div className="metric-eyebrow">Drivers Called</div>
                <div className="metric-desc">Check-in calls placed by Aria this session</div>
                <div className="metric-value" id="cc-calls">0</div>
                <div className="metric-delta delta-flat">Press Initialize to start sequence</div>
              </div>
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8l2 2 3-3"/></svg></div>
                <div className="metric-eyebrow">Check-ins Logged</div>
                <div className="metric-desc">Drivers confirmed location &amp; ETA with Aria</div>
                <div className="metric-value" id="cc-confirmed">0</div>
                <div className="metric-delta delta-flat">Acknowledged &amp; on track</div>
              </div>
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3M8 11v.5"/></svg></div>
                <div className="metric-eyebrow">No Answer</div>
                <div className="metric-desc">Driver did not pick up — voicemail left</div>
                <div className="metric-value" id="cc-pending">0</div>
                <div className="metric-delta delta-flat">Flagged for manual follow-up</div>
              </div>
            </div>

            <div className="live-dialer-card" id="liveDialerCard">
              <div className="dialer-top">
                <div className="dialer-avatar"><span id="dialerInitial">M</span><div className="dialer-avatar-ring"></div></div>
                <div className="dialer-info">
                  <div className="dialer-badge"><span className="dialer-badge-dot"></span>Aria is calling</div>
                  <div className="dialer-name" id="dialerName">Driver Name</div>
                  <div className="dialer-meta" id="dialerMeta">TRK-000 · Load · Route</div>
                </div>
                <div className="dialer-waveform">
                  {[0,.15,.3,.45,.6,.75].map((d,i) => <div key={i} className="dialer-wave-bar" style={{animationDelay:`${d}s`}}></div>)}
                </div>
                <div className="dialer-timer" id="dialerTimer">0:00</div>
              </div>
              <div className="dialer-transcript" id="dialerTranscript"></div>
              <div className="dialer-progress-row">
                <span className="dialer-progress-text">Driver <strong id="dialerCurrent">1</strong> of <strong id="dialerTotal">6</strong></span>
                <span className="dialer-next-text">Next up: <strong id="dialerNext">—</strong></span>
              </div>
            </div>

            <div>
              <div className="section-header" style={{marginBottom:'var(--space-3)'}}>
                <div className="section-title">Driver Check-in Log</div>
                <span className="section-badge" id="cc-count">0 of 6 drivers</span>
              </div>
              <div className="table-card tt-table">
                <div className="table-head">
                  <span>Driver</span><span>Phone</span><span>Route / Ref</span><span>Location / ETA</span><span>Call Summary</span><span>Alert</span><span>Status</span>
                </div>
                <div id="cc-table-body">
                  <div className="feed-empty">Click <strong>Initialize Use Case</strong> to begin auto check-in sequence.</div>
                </div>
              </div>
            </div>
          </div>

          {/* AR COLLECTIONS */}
          <div id="panel-ar" style={{display:'none',flexDirection:'column',gap:'var(--space-5)'}}>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5c0 5.799 4.701 10.5 10.5 10.5A1.5 1.5 0 0 0 14 12.5v-1.38a1.5 1.5 0 0 0-1.035-1.429l-1.5-.5a1.5 1.5 0 0 0-1.59.418l-.49.558a7.518 7.518 0 0 1-3.952-3.952l.558-.49a1.5 1.5 0 0 0 .418-1.59l-.5-1.5A1.5 1.5 0 0 0 4.88 2H3.5Z"/></svg></div>
                <div className="metric-eyebrow">Debtors Contacted</div>
                <div className="metric-desc">Outbound collection calls placed this session</div>
                <div className="metric-value" id="ar-calls">0</div>
                <div className="metric-delta delta-flat">Press Call Aria to start collecting</div>
              </div>
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v12M5 5h4.5a1.5 1.5 0 0 1 0 3H6a1.5 1.5 0 0 0 0 3H11"/></svg></div>
                <div className="metric-eyebrow">Promise to Pay</div>
                <div className="metric-desc">Total $ debtors verbally committed to send</div>
                <div className="metric-value"><span className="metric-unit">$</span><span id="ar-promised">0</span></div>
                <div className="metric-delta delta-flat">Verbal commitments secured</div>
              </div>
              <div className="metric-card">
                <div className="metric-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8l2 2 3-3"/></svg></div>
                <div className="metric-eyebrow">Cash Collected</div>
                <div className="metric-desc">Payments confirmed received in this session</div>
                <div className="metric-value"><span className="metric-unit">$</span><span id="ar-collected">0</span></div>
                <div className="metric-delta delta-flat">Actual money in</div>
              </div>
            </div>
            <div>
              <div className="section-header" style={{marginBottom:'var(--space-3)'}}>
                <div className="section-title">AR Collections Log</div>
                <span className="section-badge" id="ar-count">0 accounts</span>
              </div>
              <div className="table-card ar-table">
                <div className="table-head">
                  <span>Debtor / Invoice</span><span>Balance</span><span>Days O/D</span><span>Called At</span><span>Outcome</span>
                </div>
                <div id="ar-table-body">
                  <div className="feed-empty">No collection calls yet. Click <strong>Call Aria</strong> to begin.</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT — FEED */}
        <div className="right-panel">
          <div className="feed-header">
            <span className="feed-title" id="feedTitle">Activity Feed</span>
            <span className="feed-count" id="feedCount">0 events</span>
          </div>
          <div className="feed-body" id="feedBody">
            <div className="feed-empty">Connecting to Supabase…</div>
          </div>
        </div>
      </div>

      {/* CALL MODAL */}
      <div className="call-overlay" id="callOverlay">
        <div className="call-modal">
          <div className="call-modal-header">
            <span className="call-modal-title">Live Call</span>
            <button className="call-close" onClick={() => endCall()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>
          <div className="call-avatar">
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <path d="M16.2 2.5 6.4 15.1c-.5.64-.04 1.57.77 1.57h4.06l-1.6 8.06c-.18.9.97 1.43 1.53.7L21.6 12.4c.5-.65.04-1.58-.77-1.58h-4.2l1.65-7.55c.2-.9-.94-1.46-1.5-.77Z" fill="var(--amber-500)"/>
            </svg>
          </div>
          <div className="call-name" id="callName">Aria</div>
          <div className="call-sub"  id="callSub">Outbound · Load Tender</div>
          <div className="call-timer" id="callTimer">0:00</div>
          <div className="call-waveform" id="callWave">
            {[0,.12,.24,.36,.48,.60,.72,.84].map((d,i) => <div key={i} className="wave-bar" style={{animationDelay:`${d}s`}}></div>)}
          </div>
          <div className="call-transcript" id="callTranscript"></div>
          <div className="call-controls">
            <button className="btn-call active" onClick={() => endCall()} style={{background:'var(--danger-solid)',color:'#fff',justifyContent:'center',padding:'12px',flex:1}}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 11.5v-1.38a1.5 1.5 0 0 0-1.035-1.429l-1.5-.5a1.5 1.5 0 0 0-1.59.418l-.35.4C8.11 9.05 7.09 9.05 5.975 8.535l-.1-.05C4.76 7.97 3.97 7.19 3.49 6.475l.41-.36a1.5 1.5 0 0 0 .418-1.59l-.5-1.5A1.5 1.5 0 0 0 2.38 2H1a1 1 0 0 0 0 2l.1-.001C1.38 9.3 6.7 14 13.5 14a1.5 1.5 0 0 0 1.5-1.5v-.001" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                <path d="M12 4l-4 4M8 4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              End Call
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
