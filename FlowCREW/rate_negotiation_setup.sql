-- Rate Negotiation Demo: Full Setup + Seed
-- Paste into: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql

-- 1. Tables

CREATE TABLE IF NOT EXISTS public.lane_rates (
  id           SERIAL PRIMARY KEY,
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  floor_rate   NUMERIC(10,2),
  target_rate  NUMERIC(10,2),
  ceiling_rate NUMERIC(10,2),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (origin, destination)
);

CREATE TABLE IF NOT EXISTS public.carrier_rate_history (
  id            SERIAL PRIMARY KEY,
  carrier_name  TEXT NOT NULL,
  origin        TEXT NOT NULL,
  destination   TEXT NOT NULL,
  rate          NUMERIC(10,2),
  load_date     DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rate_negotiations (
  id               SERIAL PRIMARY KEY,
  origin           TEXT,
  destination      TEXT,
  weight_lbs       INTEGER,
  commodity        TEXT,
  carrier_name     TEXT,
  floor_rate       NUMERIC(10,2),
  target_rate      NUMERIC(10,2),
  ceiling_rate     NUMERIC(10,2),
  carrier_offer    NUMERIC(10,2),
  final_rate       NUMERIC(10,2),
  status           TEXT DEFAULT 'negotiating',
  boss_call_status TEXT DEFAULT 'not_called',
  boss_decision    TEXT,
  call_summary     TEXT,
  notes            TEXT,
  is_demo_row      BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Realtime

ALTER PUBLICATION supabase_realtime ADD TABLE lane_rates;
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_rate_history;
ALTER PUBLICATION supabase_realtime ADD TABLE rate_negotiations;

-- 3. RLS

ALTER TABLE public.lane_rates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_rate_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_negotiations     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS all_access_lane_rates ON public.lane_rates;
CREATE POLICY all_access_lane_rates ON public.lane_rates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS all_access_carrier_rate_history ON public.carrier_rate_history;
CREATE POLICY all_access_carrier_rate_history ON public.carrier_rate_history FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS all_access_rate_negotiations ON public.rate_negotiations;
CREATE POLICY all_access_rate_negotiations ON public.rate_negotiations FOR ALL USING (true) WITH CHECK (true);

-- 4. Seed lane corridor (matches the dashboard placeholder example lane)

INSERT INTO public.lane_rates (origin, destination, floor_rate, target_rate, ceiling_rate)
VALUES ('Chicago, IL', 'Dallas, TX', 1800, 2200, 2600)
ON CONFLICT (origin, destination) DO NOTHING;

-- 5. Seed carrier rate history for that lane

INSERT INTO public.carrier_rate_history (carrier_name, origin, destination, rate, load_date) VALUES
  ('Blue Ridge Carriers',        'Chicago, IL', 'Dallas, TX', 2100, '2026-06-02'),
  ('Blue Ridge Carriers',        'Chicago, IL', 'Dallas, TX', 2050, '2026-05-14'),
  ('Eagle Logistics Inc.',       'Chicago, IL', 'Dallas, TX', 2300, '2026-06-10'),
  ('Swift Freight Solutions',    'Chicago, IL', 'Dallas, TX', 1950, '2026-06-18'),
  ('Swift Freight Solutions',    'Chicago, IL', 'Dallas, TX', 2000, '2026-05-01'),
  ('Mike''s Cartage',            'Chicago, IL', 'Dallas, TX', 2450, '2026-05-27');
