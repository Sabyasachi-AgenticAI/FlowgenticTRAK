-- AR Collections: Schema only (no seed data)
-- Paste into: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql

CREATE TABLE IF NOT EXISTS public.ar_accounts (
  id             SERIAL PRIMARY KEY,
  invoice_no     TEXT NOT NULL UNIQUE,
  customer       TEXT,
  customer_phone TEXT,
  amount_due     NUMERIC(10,2),
  due_date       TEXT,
  days_overdue   INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'pending_call',
  call_status    TEXT DEFAULT 'not_called',
  payment_date   TEXT,
  notes          TEXT,
  is_demo_row    BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ar_feed (
  id          SERIAL PRIMARY KEY,
  title       TEXT,
  who         TEXT DEFAULT 'aria',
  quote       TEXT,
  tool        TEXT,
  badge_type  TEXT DEFAULT 'auto',
  time_str    TEXT,
  is_demo_row BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE ar_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE ar_feed;

ALTER TABLE public.ar_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_feed     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS all_access_ar_accounts ON public.ar_accounts;
CREATE POLICY all_access_ar_accounts
  ON public.ar_accounts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS all_access_ar_feed ON public.ar_feed;
CREATE POLICY all_access_ar_feed
  ON public.ar_feed FOR ALL USING (true) WITH CHECK (true);
