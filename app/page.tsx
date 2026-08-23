'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Show, UserButton } from '@clerk/nextjs'
import { TrakMark } from './trak-mark'
import './landing.css'

// Replace with a Calendly/booking link when one exists.
const DEMO_URL = 'mailto:sabyarjit.ghosh@gmail.com?subject=FlowgenticTRAK%20demo%20request'

// ── The life of a load — TRAK is on it from requirement to delivery ──
const STEPS = [
  {
    title: 'Requirement placed',
    body: 'A load lands — by call, email, or straight from your TMS. TRAK picks it up on minute one and checks the lane.',
  },
  {
    title: 'Covered and booked',
    body: 'Carriers contacted, rates negotiated against your lane data, the best option locked in — and the booking written back.',
  },
  {
    title: 'Watched in transit',
    body: 'Every movement tracked across land, ocean, and air. When something slips, an agent acts before your customer notices.',
  },
  {
    title: 'Delivered and closed',
    body: 'Proof of delivery in, outcome logged, invoice followed to payment. The load closes itself; your team handles only what escalates.',
  },
]

const FAQS = [
  {
    q: 'Does TRAK replace our TMS?',
    a: 'No. TRAK reads loads, invoices, and lane rates from your existing TMS and writes every outcome back. Your TMS stays the system of record.',
  },
  {
    q: 'What happens when an agent gets stuck?',
    a: 'It escalates. Anything outside its playbook — a dispute, an unusual rate, a hard exception — is handed to your team with the full context and transcript attached.',
  },
  {
    q: 'Which modes does TRAK cover?',
    a: 'Land, ocean, and air: PRO-level truck tracking, container milestones from booking to gate-out, and AWB tracking across every leg and transfer.',
  },
  {
    q: 'Can we tune how the agents behave?',
    a: 'Yes. Escalation rules, tracking cadence, negotiation guardrails, and tone are configurable per customer and per lane.',
  },
  {
    q: 'How is our data handled?',
    a: 'TRAK connects to your systems over encrypted channels, acts only within the permissions you grant, and keeps your TMS as the single source of truth.',
  },
]

// ── Hero live-board content, one per mode ─────────────────────
const MODES = [
  {
    key: 'truck',
    label: 'Land',
    ref: 'PRO 29472-8',
    lane: ['MIA', 'LAX'],
    laneNames: ['Miami FL', 'Los Angeles CA'],
    meta: "53' dry van · 42,300 lbs · linehaul day 2 of 3",
    pct: 58,
    alert: 'GPS idle 97 min — I-10 W, El Paso TX',
    aria: 'called the driver. Blown tire repaired, rolling again — new ETA Jun 23, 14:30 PT. Customer notified.',
    stamp: 'CHECK CALL LOGGED · 11:42 CT',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 6h13v10H1zM14 9h4l4 4v3h-8z" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" />
      </svg>
    ),
  },
  {
    key: 'ocean',
    label: 'Ocean',
    ref: 'MBL MAEU 220841557 · MSKU 8301142',
    lane: ['CNSHA', 'USLGB'],
    laneNames: ['Shanghai', 'Long Beach CA'],
    meta: "40' HC · Ever Ace V.081E · transship SGSIN",
    pct: 34,
    alert: 'Rollover risk at Singapore — vessel cutoff moved up 12 h',
    aria: 'confirmed with the co-loader: container protected on V.081E. ETA holds Jul 28 — demurrage clock unaffected.',
    stamp: 'MILESTONE UPDATED · 03:15 SGT',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 14l1.5 5h15L21 14M3 14h18M5 14V9h14v5M9 9V6h6v3" /><path d="M2 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" />
      </svg>
    ),
  },
  {
    key: 'air',
    label: 'Air',
    ref: 'MAWB 176-4821 0093',
    lane: ['HKG', 'ORD'],
    laneNames: ['Hong Kong', 'Chicago IL'],
    meta: '6 pcs · 412 kg chargeable · via ANC',
    pct: 81,
    alert: 'Short-shipped 1 pc at transfer — ANC',
    aria: 'called the ground handler at ANC. Missing piece located, boarding CX 084 tonight — recovery at ORD 06:12.',
    stamp: 'RECOVERY CONFIRMED · 22:04 HKT',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
      </svg>
    ),
  },
]

const USE_CASES = [
  {
    name: 'Load Tender',
    tool: 'create_load_tender',
    badge: 'Inbound',
    body: 'Carriers call in; TRAK takes the tender, checks the lane, and books the load into your TMS before the caller hangs up.',
  },
  {
    name: 'Track & Trace Check Calls',
    tool: 'update_carrier_status',
    badge: 'Automated',
    body: 'GPS goes quiet, TRAK dials the driver, logs the new ETA, and updates the board — before your customer notices anything.',
  },
  {
    name: 'AR Collections',
    tool: 'log_promise_to_pay',
    badge: 'Automated',
    body: 'Overdue invoices get a polite, persistent caller. Promises to pay are logged; disputes are routed straight to your team.',
  },
  {
    name: 'Rate Negotiation',
    tool: 'negotiate_rate',
    badge: 'Automated',
    body: 'TRAK works the carrier list against your lane rates and brings back the best confirmed offer, with the full transcript.',
  },
]

export default function Landing() {
  const [mode, setMode] = useState(0)
  const [step, setStep] = useState(0)
  const paused = useRef(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => {
      if (!paused.current && !document.hidden) setMode((m) => (m + 1) % MODES.length)
    }, 6000)
    const s = setInterval(() => {
      if (!document.hidden) setStep((x) => (x + 1) % STEPS.length)
    }, 3000)
    return () => { clearInterval(t); clearInterval(s) }
  }, [])

  const m = MODES[mode]

  return (
    <div className="ld-page">
      {/* ── Topbar ── */}
      <header className="ld-topbar">
        <div className="ld-wrap ld-topbar-in">
          <div className="ld-mark">
            <TrakMark size={24} />
            <span className="ld-mark-flow">Flowgentic</span>
            <span className="ld-mark-trak">TRAK</span>
          </div>
          <nav className="ld-nav" aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#modes">Coverage</a>
            <a href="#aria">Agents</a>
            <a href="#integration">Integration</a>
          </nav>
          <Show when="signed-out">
            <Link href="/signin" className="ld-nav-signin">Sign in</Link>
            <a href={DEMO_URL} className="ld-btn ld-btn-topbar">Book a demo</a>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" className="ld-btn ld-btn-topbar">Open dashboard</Link>
            <UserButton />
          </Show>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="ld-hero">
        <div className="ld-wrap ld-hero-in">
          <div className="ld-hero-copy">
            <p className="ld-eyebrow">Land · Ocean · Air</p>
            <h1 className="ld-h1">
              The <em>agentic AI&nbsp;OS</em>
              <br />
              for freight operations.
            </h1>
            <p className="ld-lead">
              Real-time tracking on every shipment, AI agents on every exception — TRAK runs your
              freight desk end to end and writes each outcome back to your TMS.
            </p>
            <div className="ld-cta-row">
              <a href={DEMO_URL} className="ld-btn">Book a demo</a>
              <Show when="signed-out">
                <Link href="/signin" className="ld-btn ld-btn-ghost">Sign in to TRAK</Link>
              </Show>
              <Show when="signed-in">
                <Link href="/dashboard" className="ld-btn ld-btn-ghost">Open dashboard</Link>
              </Show>
            </div>
          </div>

          <div className="ld-board">
            <div className="ld-tabs" role="tablist" aria-label="Freight mode">
              {MODES.map((t, i) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={i === mode}
                  className={'ld-tab' + (i === mode ? ' active' : '')}
                  onClick={() => { paused.current = true; setMode(i) }}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
              <span className="ld-tabs-live"><span className="ld-live-dot" />Live board</span>
            </div>

            <article className="ld-ticket" key={m.key} aria-label={`${m.label} shipment`}>
              <div className="ld-ticket-head">
                <span className="ld-ticket-kind">Dispatch ticket · {m.label}</span>
                <span className="ld-ticket-ref">{m.ref}</span>
              </div>
              <div className="ld-ticket-lane">
                <div className="ld-lane-end">
                  <span className="ld-lane-code">{m.lane[0]}</span>
                  <span className="ld-lane-name">{m.laneNames[0]}</span>
                </div>
                <div className="ld-lane-track" aria-hidden="true">
                  <div className="ld-lane-fill" style={{ width: m.pct + '%' }} />
                  <div className="ld-lane-dot" style={{ left: m.pct + '%' }} />
                </div>
                <div className="ld-lane-end ld-lane-dest">
                  <span className="ld-lane-code">{m.lane[1]}</span>
                  <span className="ld-lane-name">{m.laneNames[1]}</span>
                </div>
              </div>
              <p className="ld-ticket-meta">{m.meta}</p>
              <p className="ld-ticket-alert">{m.alert}</p>
              <p className="ld-ticket-aria"><span className="ld-aria-flash">TRAK</span> {m.aria}</p>
              <div className="ld-ticket-stamp">{m.stamp}</div>
            </article>
          </div>
        </div>
      </section>

      {/* ── How it works: the life of one load ── */}
      <section className="ld-how" id="how">
        <div className="ld-wrap">
          <p className="ld-eyebrow">How it works</p>
          <h2 className="ld-h2">On the load from the moment it exists.</h2>
          <p className="ld-lead">
            TRAK doesn&apos;t wait for something to break. It picks up every load when the
            requirement is placed — and stays on it until the delivery is closed.
          </p>
          <div className="ld-how-track">
            {STEPS.map((s, i) => (
              <div className={'ld-step' + (i === step ? ' active' : '')} key={s.title}>
                <span className="ld-step-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coverage ── */}
      <section className="ld-modes" id="modes">
        <div className="ld-wrap">
          <p className="ld-eyebrow">Coverage</p>
          <h2 className="ld-h2">Three modes. One desk.</h2>
          <div className="ld-modes-grid">
            <div className="ld-mode-card">
              <div className="ld-mode-head">{MODES[0].icon}<h3>Land</h3></div>
              <p>
                PRO-level visibility on every load. GPS-idle alerts, driver check calls, breakdown
                escalation — TRAK dials the driver before your customer dials you.
              </p>
              <code className="ld-mode-wire">PRO 29472 · MIA → LAX · idle 97 min → called · ETA 14:30</code>
            </div>
            <div className="ld-mode-card">
              <div className="ld-mode-head">{MODES[1].icon}<h3>Ocean</h3></div>
              <p>
                Container milestones from booking to gate-out. Rollovers, port congestion, and
                demurrage clocks are flagged — and phoned in, not just emailed.
              </p>
              <code className="ld-mode-wire">MSKU 8301142 · CNSHA → USLGB · protected on V.081E</code>
            </div>
            <div className="ld-mode-card">
              <div className="ld-mode-head">{MODES[2].icon}<h3>Air</h3></div>
              <p>
                AWB tracking across every leg and transfer. A missed recovery or short-shipment gets
                a call to the handler, not a ticket in a queue.
              </p>
              <code className="ld-mode-wire">AWB 176-4821 0093 · HKG → ORD · recovered 06:12</code>
            </div>
          </div>
        </div>
      </section>

      {/* ── Agents ── */}
      <section className="ld-aria" id="aria">
        <div className="ld-wrap">
          <p className="ld-eyebrow">Multi-agent AI</p>
          <h2 className="ld-h2">Agents on every workflow.</h2>
          <p className="ld-lead">
            TRAK&apos;s AI agents integrate with your existing TMS and deliver value in real time —
            tenders booked, exceptions resolved, invoices collected, and every outcome written
            back as it happens.
          </p>
          <div className="ld-aria-grid">
            {USE_CASES.map((u) => (
              <div className="ld-uc-card" key={u.name}>
                <div className="ld-uc-top">
                  <h3>{u.name}</h3>
                  <span className={'ld-uc-badge' + (u.badge === 'Inbound' ? ' inbound' : '')}>{u.badge}</span>
                </div>
                <p>{u.body}</p>
                <code className="ld-uc-tool">{u.tool}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="ld-faq" id="faq">
        <div className="ld-wrap">
          <p className="ld-eyebrow">FAQ</p>
          <h2 className="ld-h2">Questions, answered.</h2>
          <div className="ld-faq-list">
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integration band ── */}
      <section className="ld-csa" id="integration">
        <div className="ld-wrap">
          <p className="ld-eyebrow">Works with your TMS</p>
          <h2 className="ld-h2">No new system of record.</h2>
          <p className="ld-lead">
            TRAK reads loads, invoices, and lane rates straight from your TMS and writes every call
            outcome back. Your data stays where your team already works.
          </p>
          <a href={DEMO_URL} className="ld-btn">Book a demo</a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="ld-footer">
        <div className="ld-wrap ld-footer-in">
          <div className="ld-mark ld-mark-footer">
            <TrakMark size={19} />
            <span className="ld-mark-flow">Flowgentic</span>
            <span className="ld-mark-trak">TRAK</span>
          </div>
          <span className="ld-footer-mid">Land · Ocean · Air · © 2026 Flowgentic</span>
        </div>
      </footer>
    </div>
  )
}
