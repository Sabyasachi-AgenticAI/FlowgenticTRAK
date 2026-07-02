-- Rate Negotiation: booking depth + persuasion playbook
-- Run once in: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql/new
-- Requires rate_negotiation_setup.sql to already be applied.

-- 1. Extend rate_negotiations with booking/compliance fields

ALTER TABLE rate_negotiations
  ADD COLUMN IF NOT EXISTS load_ref            text,
  ADD COLUMN IF NOT EXISTS pickup_address      text,
  ADD COLUMN IF NOT EXISTS delivery_address    text,
  ADD COLUMN IF NOT EXISTS pickup_time         text,
  ADD COLUMN IF NOT EXISTS delivery_time       text,
  ADD COLUMN IF NOT EXISTS detention_terms     text,
  ADD COLUMN IF NOT EXISTS quick_pay_pct       numeric(5,2),
  ADD COLUMN IF NOT EXISTS mc_number           text,
  ADD COLUMN IF NOT EXISTS insurance_verified  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_name         text,
  ADD COLUMN IF NOT EXISTS driver_phone        text,
  ADD COLUMN IF NOT EXISTS call_list_position  integer,
  ADD COLUMN IF NOT EXISTS call_list_total     integer,
  ADD COLUMN IF NOT EXISTS decline_reason      text;

-- 2. Persuasion playbook — tactics the agent can pull mid-call by trigger

CREATE TABLE IF NOT EXISTS public.persuasion_playbook (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  trigger        TEXT NOT NULL,
  script_line    TEXT,
  example        TEXT,
  effectiveness  INTEGER,
  conditions     JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.persuasion_playbook ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS all_access_persuasion_playbook ON public.persuasion_playbook;
CREATE POLICY all_access_persuasion_playbook
  ON public.persuasion_playbook FOR ALL USING (true) WITH CHECK (true);

INSERT INTO persuasion_playbook
  (name, trigger, script_line, example, effectiveness, conditions)
VALUES

-- ── RELATIONSHIP ANGLES ─────────────────────
(
  'Prior loads reference',
  'carrier_hesitating',
  'We''ve worked together before — {{prior_loads}} loads,
   all clean. You know how we operate.',
  'Marcus: "We''ve worked together twice, both loads went
   smooth. You know we pay on time and we don''t give
   you problems."',
  82,
  '{"prior_loads_min": 1}'
),

(
  'On-time compliment',
  'carrier_hesitating',
  'Your on-time record with us is {{on_time_pct}}% —
   that''s why you''re at the top of our list.',
  'Marcus: "Every load you''ve done for us has been clean.
   That''s exactly why I called you first."',
  78,
  '{"on_time_pct_min": 90}'
),

-- ── GEOGRAPHIC ANGLES ───────────────────────
(
  'Proximity to pickup',
  'carrier_above_ceiling',
  'You''re already in {{carrier_home_city}} —
   that''s practically next door to the pickup.
   No deadhead cost on your end.',
  'Marcus: "You''re in Gary right now — that''s 40 miles
   from Bolingbrook. You''re not burning diesel to get
   to the freight. That changes the math."',
  85,
  '{"home_state_matches_origin": true}'
),

(
  'Reload market strength',
  'carrier_above_ceiling',
  '{{dest_city}} is a strong reload market right now.
   You''re not going to sit down there.',
  'Marcus: "Columbus is running hot — you''ll have
   your next load before you''re done unloading.
   That''s round-trip money, not a one-way."',
  80,
  '{"reload_market_strength": "strong"}'
),

(
  'Home city backhaul',
  'carrier_above_ceiling',
  'This gets you back toward home.
   {{dest_city}} is closer to {{carrier_home_city}}
   than where you are now.',
  'Marcus: "This runs you toward Texas — you''re
   heading home anyway. Beats sitting."',
  77,
  '{"dest_toward_home": true}'
),

-- ── MARKET DATA ANGLES ──────────────────────
(
  'DAT rate reference',
  'carrier_above_ceiling',
  'DAT is showing {{market_rate}} on this lane today.
   We''re at {{our_rate}} — that''s solid.',
  'Marcus: "DAT is showing $1,780 on IL to GA today.
   We''re at $1,850 — we''re above market and
   the freight is easy."',
  75,
  '{"our_rate_above_dat": true}'
),

(
  'Market softening',
  'carrier_above_ceiling',
  'The spot market has softened this week on this
   lane. We''re actually above what''s posting
   on the boards right now.',
  'Marcus: "Spot rates dropped this week on Midwest
   to Southeast. We''re still offering above board
   rate. This is the best you''ll find today."',
  72,
  '{"market_below_target": true}'
),

-- ── LOAD QUALITY ANGLES ─────────────────────
(
  'No touch freight',
  'carrier_hesitating',
  'No touch — your driver doesn''t lift a finger.
   In and out.',
  'Marcus: "It''s no touch freight. Driver shows up,
   confirms piece count, gets the BOL, and rolls.
   Easy money."',
  74,
  '{"no_touch": true}'
),

(
  'Clean commodity',
  'carrier_hesitating',
  'Packaged consumer goods — no hazmat, no food grade,
   no special equipment. Straight dry van.',
  'Marcus: "Dry goods in boxes. Standard pallets.
   No surprises, no extra certifications needed."',
  65,
  null
),

(
  'Flexible pickup window',
  'carrier_above_ceiling',
  'Pickup window is flexible — you can come anytime
   between {{pickup_time_start}} and {{pickup_time_end}}.',
  'Marcus: "Pickup is flexible — you can roll in
   anytime between 7 and 11. No hard appointment
   pressure on your driver."',
  68,
  '{"pickup_flexible": true}'
),

-- ── FINANCIAL ANGLES ────────────────────────
(
  'Quick pay offer',
  'owner_operator_tough',
  'We offer quick pay at {{quick_pay_pct}}% —
   you''ll have your money in 48 hours.',
  'Marcus: "We do quick pay at 2%. You''ll have
   the money in 48 hours after delivery. No
   waiting 30 days on your invoice."',
  83,
  '{"quick_pay_enrolled": true, "carrier_type": "owner_operator"}'
),

(
  'Volume promise',
  'carrier_hesitating',
  'We run 3-4 loads a week on this lane.
   Take good care of this one and you''ll
   hear from us every week.',
  'Marcus: "We move 3 to 4 loads a week on
   this lane. This is an audition, not a
   one-time thing. You book this right and
   you''ll be hearing from me every Monday."',
  79,
  '{"loads_per_week_on_lane_min": 3}'
),

(
  'Fast payment history',
  'carrier_tough_negotiator',
  'Check your payment history with us —
   we''ve never been late.',
  'Marcus: "Pull up your payment records from
   the last two loads. We paid in {{avg_pay_days}}
   days both times. You know we''re good for it."',
  76,
  '{"prior_loads_min": 1}'
),

-- ── URGENCY ANGLES ──────────────────────────
(
  'Soft urgency',
  'carrier_hesitating',
  'I''ve got a couple other trucks looking
   at this right now. I''d rather give it
   to you — but I need to know soon.',
  'Marcus: "I''m talking to a few carriers right
   now and I need to have this covered in the
   next hour. You''re my first call because
   of your track record with us."',
  71,
  null
),

(
  'Shipper deadline',
  'carrier_above_ceiling',
  'This shipper has a hard deadline —
   tradeshow opens Thursday 8am.
   They need someone reliable, not just cheap.',
  'Marcus: "Shipper has a convention setup
   Thursday morning. They''re not price-shopping —
   they want a carrier they can count on.
   That''s why I''m calling you first."',
  69,
  '{"delivery_hard_deadline": true}'
),

-- ── PUSHBACK HANDLING ───────────────────────
(
  'Acknowledge fuel concern',
  'carrier_mentions_fuel',
  'I hear you on fuel — it''s been rough
   this week. Let me see what I can do.',
  'Marcus: "I know diesel is up this week —
   I''m not going to pretend otherwise.
   Let me see if I can get you to ${{adjusted_rate}}
   and still make this work on my end."',
  73,
  null
),

(
  'Acknowledge load difficulty',
  'carrier_mentions_concerns',
  'Fair point. Let me factor that in
   and come back to you.',
  'Marcus: "That''s a fair concern. Let me
   account for that and see if I can adjust
   the rate. Give me 60 seconds."',
  70,
  null
),

(
  'Split the difference close',
  'carrier_final_counter',
  'Meet me in the middle at {{split_rate}}
   and we''re done.',
  'Marcus: "You''re at $2,100, I''m at $1,850.
   Meet me at $1,975 and we book it right now.
   No more back and forth."',
  81,
  null
),

(
  'Final offer close',
  'carrier_above_ceiling',
  'This is my final number — {{our_rate}}.
   I can''t move from here.',
  'Marcus: "I''ve gone as far as I can go.
   $1,950 is my absolute ceiling on this load.
   If that works, we''re done. If not,
   I understand and I''ll try the next truck."',
  67,
  null
);

-- 3. Simulate 2 prior declines on the Chicago,IL -> Dallas,TX demo lane so the
--    live demo call books as "carrier 3 of 4" — no extra real calls needed.
--    Carrier order matches the dashboard's ascending-avg-rate sort.

INSERT INTO public.rate_negotiations
  (origin, destination, carrier_name, floor_rate, target_rate, ceiling_rate,
   status, decline_reason, call_list_position, call_list_total,
   call_summary, is_demo_row)
VALUES
  ('Chicago, IL', 'Dallas, TX', 'Swift Freight Solutions', 1800, 2200, 2600,
   'failed', 'no_capacity', 1, 4,
   'Carrier had no available capacity for this lane.', true),
  ('Chicago, IL', 'Dallas, TX', 'Blue Ridge Carriers', 1800, 2200, 2600,
   'failed', 'rate_too_low', 2, 4,
   'Carrier wanted $2,700 — above ceiling, no deal.', true);
