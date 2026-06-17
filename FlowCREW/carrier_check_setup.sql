-- ── Carrier Check Demo Tables ────────────────────────────────────────────────
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql

-- 1. Loads Aria calls carriers about
CREATE TABLE IF NOT EXISTS public.carrier_check_loads (
  id            SERIAL PRIMARY KEY,
  ref           TEXT NOT NULL,
  carrier       TEXT,
  carrier_phone TEXT,
  origin        TEXT,
  destination   TEXT,
  route         TEXT,
  pickup_time   TEXT,
  service       TEXT DEFAULT 'FTL',
  weight        TEXT,
  pallets       INTEGER,
  status        TEXT DEFAULT 'pending_check', -- pending_check | confirmed | issue_raised | rescheduled
  call_status   TEXT DEFAULT 'not_called',    -- not_called | in_progress | completed
  eta_confirmed TEXT,
  notes         TEXT,
  is_demo_row   BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Log of each outbound call Aria makes
CREATE TABLE IF NOT EXISTS public.carrier_check_calls (
  id            SERIAL PRIMARY KEY,
  load_ref      TEXT,
  carrier       TEXT,
  outcome       TEXT,  -- confirmed | no_answer | will_call_back | issue_raised
  eta_confirmed TEXT,
  notes         TEXT,
  is_demo_row   BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Live activity feed (mirrors demo_feed structure)
CREATE TABLE IF NOT EXISTS public.carrier_check_feed (
  id          SERIAL PRIMARY KEY,
  title       TEXT,
  who         TEXT DEFAULT 'aria',  -- aria | system | carrier
  quote       TEXT,
  tool        TEXT,
  badge_type  TEXT DEFAULT 'auto',  -- auto | live | esc
  time_str    TEXT,
  is_demo_row BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime on all three tables
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_loads;
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_feed;

-- Seed the demo load (REF-29471 — Mike's Cartage, LAX→ORD)
INSERT INTO public.carrier_check_loads
  (ref, carrier, carrier_phone, origin, destination, route, pickup_time, service, weight, pallets, status, call_status, is_demo_row)
VALUES
  ('REF-29471', 'Mike''s Cartage', '+1-555-0147', 'LAX Warehouse', 'ORD Consignee',
   'LAX → ORD', '8am Thursday', 'FTL', '4,200 lbs', 3, 'pending_check', 'not_called', true)
ON CONFLICT DO NOTHING;
