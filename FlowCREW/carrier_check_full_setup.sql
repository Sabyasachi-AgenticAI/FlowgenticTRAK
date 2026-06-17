-- Carrier Check Demo: Full Setup + Seed
-- Paste into: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql

-- 1. Tables

CREATE TABLE IF NOT EXISTS public.carrier_check_loads (
  id            SERIAL PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  carrier       TEXT,
  carrier_phone TEXT,
  origin        TEXT,
  destination   TEXT,
  route         TEXT,
  pickup_time   TEXT,
  service       TEXT DEFAULT 'FTL',
  weight        TEXT,
  pallets       INTEGER,
  status        TEXT DEFAULT 'pending_check',
  call_status   TEXT DEFAULT 'not_called',
  eta_confirmed TEXT,
  notes         TEXT,
  is_demo_row   BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.carrier_check_calls (
  id            SERIAL PRIMARY KEY,
  load_ref      TEXT,
  carrier       TEXT,
  outcome       TEXT,
  eta_confirmed TEXT,
  notes         TEXT,
  is_demo_row   BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.carrier_check_feed (
  id          SERIAL PRIMARY KEY,
  title       TEXT,
  who         TEXT DEFAULT 'aria',
  quote       TEXT,
  tool        TEXT,
  badge_type  TEXT DEFAULT 'auto',
  time_str    TEXT,
  is_demo_row BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Realtime

ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_loads;
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_feed;

-- 3. RLS

ALTER TABLE public.carrier_check_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_check_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_check_feed  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS all_access_loads ON public.carrier_check_loads;
CREATE POLICY all_access_loads ON public.carrier_check_loads FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS all_access_calls ON public.carrier_check_calls;
CREATE POLICY all_access_calls ON public.carrier_check_calls FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS all_access_feed ON public.carrier_check_feed;
CREATE POLICY all_access_feed ON public.carrier_check_feed FOR ALL USING (true) WITH CHECK (true);

-- 4. Seed loads

INSERT INTO public.carrier_check_loads (ref, carrier, carrier_phone, origin, destination, route, pickup_time, service, weight, pallets, status, call_status, eta_confirmed, notes, is_demo_row)
VALUES ('REF-29468', 'Swift Freight Solutions', '+1-555-0203', 'DFW Distribution Center', 'ATL Receiving Dock', 'DFW - ATL', '6:30 AM Thursday', 'FTL', '7,800 lbs', 6, 'confirmed', 'completed', 'Thu 15:30', 'Driver confirmed, truck already at dock', false)
ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.carrier_check_loads (ref, carrier, carrier_phone, origin, destination, route, pickup_time, service, weight, pallets, status, call_status, eta_confirmed, notes, is_demo_row)
VALUES ('REF-29465', 'Eagle Logistics Inc.', '+1-555-0391', 'ORD Cargo Hub', 'JFK Air Freight Terminal', 'ORD - JFK', '11:00 PM Wednesday', 'FTL', '5,100 lbs', 4, 'confirmed', 'completed', 'Thu 07:45', 'Overnight run, driver en route', false)
ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.carrier_check_loads (ref, carrier, carrier_phone, origin, destination, route, pickup_time, service, weight, pallets, status, call_status, eta_confirmed, notes, is_demo_row)
VALUES ('REF-29472', 'Blue Ridge Carriers', '+1-555-0518', 'MIA Port Warehouse', 'LAX Fulfillment Center', 'MIA - LAX', '7:00 AM Thursday', 'FTL', '9,300 lbs', 8, 'rescheduled', 'completed', 'Fri 10:00', 'Primary driver sick - dispatched backup, pickup moved to Friday 7am', false)
ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.carrier_check_loads (ref, carrier, carrier_phone, origin, destination, route, pickup_time, service, weight, pallets, status, call_status, eta_confirmed, notes, is_demo_row)
VALUES ('REF-29471', 'Mike''s Cartage', '+1-555-0147', 'LAX Warehouse', 'ORD Consignee', 'LAX - ORD', '8:00 AM Thursday', 'FTL', '4,200 lbs', 3, 'pending_check', 'not_called', NULL, '3 pallets, standard freight, no hazmat', false)
ON CONFLICT (ref) DO NOTHING;

-- 5. Seed feed history

INSERT INTO public.carrier_check_feed (title, who, quote, tool, badge_type, time_str, is_demo_row) VALUES
  ('Check Call Queue Loaded', 'sys', '4 loads scheduled for carrier check today. Starting outbound call sequence.', NULL, 'auto', '07:45', false),
  ('Carrier Confirmed - REF-29468', 'aria', 'Swift Freight confirmed pickup for 6:30am Thursday. Driver already at the DFW dock. ETA Atlanta 3:30pm.', 'update_dispatch_trak', 'auto', '07:58', false),
  ('Carrier Confirmed - REF-29465', 'aria', 'Eagle Logistics confirmed. Driver Tony departing ORD at 11pm. ETA JFK Thursday 7:45am.', 'update_dispatch_trak', 'auto', '08:22', false),
  ('Issue Raised - REF-29472', 'aria', 'Driver Marcus is out sick today. Dispatched backup but pickup moves to Friday 7am. Rescheduling now.', 'update_dispatch_trak', 'auto', '08:47', false);
