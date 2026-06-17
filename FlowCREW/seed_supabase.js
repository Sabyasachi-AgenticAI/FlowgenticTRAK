// Seeds Supabase demo_loads and demo_feed with the hardcoded data from the HTML dashboard
// Run: node seed_supabase.js

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
  console.log('Seeding Supabase demo tables...\n');

  // ── demo_loads: 3 background rows from D1 in the HTML ──
  await upsert('demo_loads', [
    {
      ref: 'ST-8821',
      shipper: 'TradeShow Pro LLC',
      route: 'LAX→ORD',
      service: 'Next-Day Air',
      weight: '850 lbs',
      status: 'act',
      carrier: 'Forward Air',
      eta: 'Thu 06:00',
      created_by: 'Manual',
      is_demo_row: false
    },
    {
      ref: 'ST-8820',
      shipper: 'Pacific Rim Imports',
      route: 'SFO→JFK',
      service: 'Deferred Air',
      weight: '1,200 lbs',
      status: 'act',
      carrier: 'United Cargo',
      eta: 'Fri 14:00',
      created_by: 'Manual',
      is_demo_row: false
    },
    {
      ref: 'ST-8819',
      shipper: 'MedDevice Corp',
      route: 'LAX→MIA',
      service: 'Next-Day Air',
      weight: '310 lbs',
      status: 'don',
      carrier: 'AA Cargo',
      eta: 'Wed 09:00',
      created_by: 'Manual',
      is_demo_row: false
    }
  ]);

  // ── demo_feed: 4 pre-existing activity cards ──
  await upsert('demo_feed', [
    {
      title: 'Appt. Scheduling',
      who: 'sys',
      quote: 'Thursday 10am confirmed. Dock 4B.',
      tool: 'update_dispatch_trak ✓',
      badge_type: 'auto',
      time_str: '08:41',
      is_demo_row: false
    },
    {
      title: 'AR Collections',
      who: 'sys',
      quote: 'Processing $980 payment by Thursday.',
      tool: 'update_account_trak ✓',
      badge_type: 'auto',
      time_str: '08:14',
      is_demo_row: false
    },
    {
      title: 'Carrier Check Call',
      who: 'sys',
      quote: 'Pickup confirmed. ETA ORD Thu 14:00.',
      tool: 'update_dispatch_trak ✓',
      badge_type: 'auto',
      time_str: '07:52',
      is_demo_row: false
    },
    {
      title: 'Load Tender · Escalated',
      who: 'sys',
      quote: 'Caller mentioned lithium batteries — needs specialist.',
      tool: 'escalate_to_human',
      badge_type: 'esc',
      time_str: '07:31',
      is_demo_row: false
    }
  ]);

  console.log('\nDone! Tables seeded. Dashboard can now read from Supabase.');
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
