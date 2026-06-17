// Seeds ar_accounts and ar_feed with demo data
// Run AFTER pasting ar_collections_setup.sql in Supabase
// Usage: node seed_ar_collections.js

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
    throw new Error(`${table} failed: ${res.status} — ${err}`);
  }
  console.log(`✓ ${table}: ${rows.length} row(s) inserted`);
}

async function seed() {
  console.log('Seeding AR Collections demo data...\n');

  await upsert('ar_accounts', [
    {
      invoice_no: 'INV-4798', customer: 'Eastern Freight Co.',
      customer_phone: '+1-555-0712', amount_due: 19500.00,
      due_date: 'Mar 3 2026', days_overdue: 90,
      status: 'escalated', call_status: 'completed',
      payment_date: null,
      notes: 'Disputed - pallet damage claim. Escalated to claims team.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4779', customer: 'Great Plains Transport',
      customer_phone: '+1-555-0634', amount_due: 2800.00,
      due_date: 'Mar 18 2026', days_overdue: 75,
      status: 'paid', call_status: 'completed',
      payment_date: 'May 14 2026',
      notes: 'Payment received via ACH. Account cleared.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4812', customer: 'Pacific Coast Imports',
      customer_phone: '+1-555-0489', amount_due: 3200.00,
      due_date: 'Apr 2 2026', days_overdue: 60,
      status: 'paid', call_status: 'completed',
      payment_date: 'May 28 2026',
      notes: 'Check received and deposited. Account closed.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4821', customer: 'TechCorp Logistics',
      customer_phone: '+1-555-0355', amount_due: 12400.00,
      due_date: 'Apr 17 2026', days_overdue: 45,
      status: 'payment_promised', call_status: 'completed',
      payment_date: null,
      notes: 'Wire transfer confirmed by Thursday. Ref TC-8821.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4835', customer: 'Midwest Distributors',
      customer_phone: '+1-555-0276', amount_due: 8750.00,
      due_date: 'May 2 2026', days_overdue: 30,
      status: 'payment_promised', call_status: 'completed',
      payment_date: null,
      notes: 'Check in the mail. Controller confirmed sent yesterday.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4841', customer: 'Southern Logistics LLC',
      customer_phone: '+1-555-0198', amount_due: 7300.00,
      due_date: 'May 10 2026', days_overdue: 22,
      status: 'payment_promised', call_status: 'completed',
      payment_date: null,
      notes: 'ACH scheduled for Friday per treasury team.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4856', customer: 'Gulf Coast Shipping',
      customer_phone: '+1-555-0143', amount_due: 5600.00,
      due_date: 'May 17 2026', days_overdue: 15,
      status: 'payment_promised', call_status: 'completed',
      payment_date: null,
      notes: 'Processing today via online portal. AP confirmed.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4872', customer: 'Northern Express Co.',
      customer_phone: '+1-555-0091', amount_due: 6500.00,
      due_date: 'May 20 2026', days_overdue: 12,
      status: 'pending_call', call_status: 'not_called',
      payment_date: null,
      notes: 'Second notice sent. No response yet.',
      is_demo_row: false
    },
    {
      invoice_no: 'INV-4867', customer: 'Rocky Mountain Carriers',
      customer_phone: '+1-555-0522', amount_due: 4100.00,
      due_date: 'May 25 2026', days_overdue: 7,
      status: 'pending_call', call_status: 'not_called',
      payment_date: null,
      notes: 'First overdue notice. Good payment history.',
      is_demo_row: false
    }
  ]);

  await upsert('ar_feed', [
    {
      title: 'AR Call Queue Loaded', who: 'sys',
      quote: '9 overdue accounts queued for collection calls today.',
      tool: null, badge_type: 'auto', time_str: '07:30', is_demo_row: false
    },
    {
      title: 'Collected - INV-4779', who: 'aria',
      quote: 'Great Plains ACH of $2,800 cleared this morning. Account marked paid.',
      tool: 'update_account_trak', badge_type: 'auto', time_str: '07:51', is_demo_row: false
    },
    {
      title: 'Collected - INV-4812', who: 'aria',
      quote: 'Pacific Coast check received. $3,200 deposited. Account closed.',
      tool: 'update_account_trak', badge_type: 'auto', time_str: '08:04', is_demo_row: false
    },
    {
      title: 'Payment Promised - INV-4856', who: 'aria',
      quote: 'Gulf Coast Shipping processing $5,600 today. Confirmed with AP.',
      tool: 'update_account_trak', badge_type: 'auto', time_str: '08:19', is_demo_row: false
    },
    {
      title: 'Payment Promised - INV-4841', who: 'aria',
      quote: 'Southern Logistics ACH of $7,300 scheduled Friday. Treasury confirmed.',
      tool: 'update_account_trak', badge_type: 'auto', time_str: '08:33', is_demo_row: false
    },
    {
      title: 'Payment Promised - INV-4835', who: 'aria',
      quote: 'Midwest Distributors check mailed. Controller confirmed $8,750 sent.',
      tool: 'update_account_trak', badge_type: 'auto', time_str: '08:47', is_demo_row: false
    },
    {
      title: 'Payment Promised - INV-4821', who: 'aria',
      quote: 'TechCorp wire of $12,400 confirmed for Thursday. Ref TC-8821.',
      tool: 'update_account_trak', badge_type: 'auto', time_str: '09:02', is_demo_row: false
    },
    {
      title: 'Escalated - INV-4798', who: 'aria',
      quote: 'Eastern Freight disputing $19,500 - pallet damage claim. Escalating.',
      tool: 'escalate_to_human', badge_type: 'esc', time_str: '09:18', is_demo_row: false
    }
  ]);

  console.log('\nDone! AR Collections data seeded successfully.');
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
