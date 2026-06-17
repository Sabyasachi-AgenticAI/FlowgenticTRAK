-- ============================================================
-- FlowCREW Demo — Supabase Setup
-- Run this in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── 1. demo_loads table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_loads (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ref          text NOT NULL UNIQUE,
  shipper      text NOT NULL,
  route        text NOT NULL,
  service      text NOT NULL,
  weight       text NOT NULL,
  status       text NOT NULL DEFAULT 'act',  -- act | new | don
  carrier      text NOT NULL,
  eta          text NOT NULL,
  created_by   text NOT NULL DEFAULT 'Manual',
  is_demo_row  boolean NOT NULL DEFAULT false,  -- true = created during live demo (deletable on reset)
  created_at   timestamptz DEFAULT now()
);

-- ── 2. demo_feed table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_feed (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title        text NOT NULL,
  who          text NOT NULL,     -- sys | aria | cal
  quote        text NOT NULL,
  tool         text,
  badge_type   text NOT NULL DEFAULT 'auto',  -- auto | live | esc
  time_str     text NOT NULL,
  is_demo_row  boolean NOT NULL DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

-- ── 3. Enable Row Level Security (open for service role) ─────
ALTER TABLE public.demo_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_feed  ENABLE ROW LEVEL SECURITY;

-- Allow all access via service role (used by n8n)
CREATE POLICY "service_role_all_loads" ON public.demo_loads
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_feed" ON public.demo_feed
  FOR ALL USING (true) WITH CHECK (true);

-- Allow anonymous read (used by dashboard JS)
CREATE POLICY "anon_read_loads" ON public.demo_loads
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_feed" ON public.demo_feed
  FOR SELECT TO anon USING (true);

-- ── 4. Enable Realtime ───────────────────────────────────────
-- (Also enable in Supabase Dashboard → Database → Replication → demo_loads + demo_feed)
ALTER PUBLICATION supabase_realtime ADD TABLE public.demo_loads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.demo_feed;
