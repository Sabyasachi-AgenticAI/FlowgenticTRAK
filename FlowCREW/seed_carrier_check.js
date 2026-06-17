// Seeds carrier check demo tables with background loads + feed history
// Run: node seed_carrier_check.js
// Supabase project: xfhegmlpfqqbipzngjcu

const SUPA_URL = 'https://xfhegmlpfqqbipzngjcu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmaGVnbWxwZnFxYmlwem5namN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDIzNjMxMCwiZXhwIjoyMDk1ODEyMzEwfQ.1yroybb6DGaNRS4gsJCrVbieEw6zv5x7Ztxu7gjnxxA';

const headers = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=minimal'
};

async function upsert(table, rows) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${table} insert failed: ${res.status} — ${err}`);
  }
  console.log(`✓ ${table}: ${rows.length} row(s) upserted`);
}

async function seed() {
  console.log('Seeding carrier check demo tables...\n');

  // ── carrier_check_loads ────────────────────────────────────────────────────
  // The LIVE demo load (REF-29471 — Mike's Cartage, LAX→ORD) — Aria calls this one
  // Three background loads already processed, to make the queue look real
  await upsert('carrier_check_loads', [
    // ── LIVE DEMO LOAD — stays pending until Aria calls during the demo ──
    {
      ref:           'REF-29471',
      carrier:       "Mike's Cartage",
      carrier_phone: '+1-555-0147',
      origin:        'LAX Warehouse',
      destination:   'ORD Consignee',
      route:         'LAX → ORD',
      pickup_time:   '8:00 AM Thursday',
      service:       'FTL',
      weight:        '4,200 lbs',
      pallets:       3,
      status:        'pending_check',
      call_status:   'not_called',
      eta_confirmed: null,
      notes:         '3 pallets, standard freight — no hazmat',
      is_demo_row:   false
    },

    // ── Background load 1: already confirmed earlier today ──
    {
      ref:           'REF-29468',
      carrier:       'Swift Freight Solutions',
      carrier_phone: '+1-555-0203',
      origin:        'DFW Distribution Center',
      destination:   'ATL Receiving Dock',
      route:         'DFW → ATL',
      pickup_time:   '6:30 AM Thursday',
      service:       'FTL',
      weight:        '7,800 lbs',
      pallets:       6,
      status:        'confirmed',
      call_status:   'completed',
      eta_confirmed: 'Thu 15:30',
      notes:         'Driver confirmed — truck already at dock',
      is_demo_row:   false
    },

    // ── Background load 2: confirmed, overnight run ──
    {
      ref:           'REF-29465',
      carrier:       'Eagle Logistics Inc.',
      carrier_phone: '+1-555-0391',
      origin:        'ORD Cargo Hub',
      destination:   'JFK Air Freight Terminal',
      route:         'ORD → JFK',
      pickup_time:   '11:00 PM Wednesday',
      service:       'FTL',
      weight:        '5,100 lbs',
      pallets:       4,
      status:        'confirmed',
      call_status:   'completed',
      eta_confirmed: 'Thu 07:45',
      notes:         'Overnight run, driver en route',
      is_demo_row:   false
    },

    // ── Background load 3: issue raised — driver unavailable, rescheduled ──
    {
      ref:           'REF-29472',
      carrier:       'Blue Ridge Carriers',
      carrier_phone: '+1-555-0518',
      origin:        'MIA Port Warehouse',
      destination:   'LAX Fulfillment Center',
      route:         'MIA → LAX',
      pickup_time:   '7:00 AM Thursday',
      service:       'FTL',
      weight:        '9,300 lbs',
      pallets:       8,
      status:        'rescheduled',
      call_status:   'completed',
      eta_confirmed: 'Fri 10:00',
      notes:         'Primary driver called in sick — dispatched backup, pickup moved to Friday 7am',
      is_demo_row:   false
    }
  ]);

  // ── carrier_check_feed: pre-existing activity history ─────────────────────
  await upsert('carrier_check_feed', [
    {
      title:      'Issue Raised — REF-29472',
      who:        'aria',
      quote:      "Driver Marcus is out sick today. We've dispatched a backup but pickup will need to move to Friday 7am. Rescheduling now.",
      tool:       'update_dispatch_trak ✓',
      badge_type: 'auto',
      time_str:   '08:47',
      is_demo_row: false
    },
    {
      title:      'Carrier Confirmed — REF-29465',
      who:        'aria',
      quote:      "Eagle Logistics confirmed. Driver Tony is fueled up and departing ORD at 11pm. ETA JFK Thursday 7:45am.",
      tool:       'update_dispatch_trak ✓',
      badge_type: 'auto',
      time_str:   '08:22',
      is_demo_row: false
    },
    {
      title:      'Carrier Confirmed — REF-29468',
      who:        'aria',
      quote:      "Swift Freight confirmed pickup for 6:30am Thursday. Driver already at the DFW dock. ETA Atlanta 3:30pm.",
      tool:       'update_dispatch_trak ✓',
      badge_type: 'auto',
      time_str:   '07:58',
      is_demo_row: false
    },
    {
      title:      'Check Call Queue Loaded',
      who:        'sys',
      quote:      '4 loads scheduled for carrier check today. Starting outbound call sequence.',
      tool:       null,
      badge_type: 'auto',
      time_str:   '07:45',
      is_demo_row: false
    }
  ]);

  console.log('\nDone! Carrier check tables seeded.');
  console.log('REF-29471 (Mike\'s Cartage) is pending — ready for the live Aria demo call.');
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
