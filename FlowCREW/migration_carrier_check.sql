-- Track & Trace schema migration
-- Run once in: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql/new

ALTER TABLE carrier_check_loads
  ADD COLUMN IF NOT EXISTS driver_name        text,
  ADD COLUMN IF NOT EXISTS driver_phone       text,
  ADD COLUMN IF NOT EXISTS gps_last_moved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS temp_c             numeric(4,1),
  ADD COLUMN IF NOT EXISTS temp_threshold_c   numeric(4,1),
  ADD COLUMN IF NOT EXISTS last_location      text,
  ADD COLUMN IF NOT EXISTS last_eta           text,
  ADD COLUMN IF NOT EXISTS call_summary       text;

-- Seed driver names + phones + demo alert state
UPDATE carrier_check_loads SET
  driver_name        = 'James Crawford',
  driver_phone       = '+1-555-0203',
  gps_last_moved_at  = NOW() - INTERVAL '12 minutes',
  last_location      = 'Dallas, TX (en route)',
  last_eta           = 'Thu 15:30',
  call_summary       = 'Driver confirmed en route. Truck will be at ATL dock by 3:30 PM. No issues.'
WHERE ref = 'REF-29468';

UPDATE carrier_check_loads SET
  driver_name        = 'Tony Vasquez',
  driver_phone       = '+1-555-0391',
  gps_last_moved_at  = NOW() - INTERVAL '7 minutes',
  last_location      = 'Gary, IN (overnight)',
  last_eta           = 'Thu 07:45',
  call_summary       = 'Overnight run confirmed. Passing Gary IN on schedule. ETA JFK 07:45 AM.'
WHERE ref = 'REF-29465';

-- GPS NOT MOVED since 97 min → RED alert
UPDATE carrier_check_loads SET
  driver_name        = 'Marcus Webb',
  driver_phone       = '+1-555-0518',
  gps_last_moved_at  = NOW() - INTERVAL '97 minutes',
  last_location      = 'Beaumont, TX (STOPPED)',
  last_eta           = 'Delayed',
  call_summary       = 'No answer. GPS inactive 97 minutes. Flagged for immediate manual dispatcher follow-up.'
WHERE ref = 'REF-29472';

-- Temperature threshold breached → AMBER alert
UPDATE carrier_check_loads SET
  driver_name        = 'Sandra Patel',
  driver_phone       = '+1-555-0147',
  gps_last_moved_at  = NOW() - INTERVAL '6 minutes',
  last_location      = 'Barstow, CA (en route)',
  last_eta           = 'Thu 14:00',
  temp_c             = 8.4,
  temp_threshold_c   = 5.0,
  call_summary       = 'Temp breach 8.4°C vs 5°C threshold. Driver resetting reefer compressor. ETA Chicago 14:00 unchanged.'
WHERE ref = 'REF-29471';

-- Also reset call statuses so the demo sequence can replay
UPDATE carrier_check_loads SET call_status = 'not_called', status = 'pending_check'
WHERE ref IN ('REF-29468','REF-29465','REF-29472','REF-29471');

-- Enable Realtime on this table (run this too)
ALTER PUBLICATION supabase_realtime ADD TABLE carrier_check_loads;
