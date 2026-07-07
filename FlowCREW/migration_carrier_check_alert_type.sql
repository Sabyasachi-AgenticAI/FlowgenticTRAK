-- Track & Trace: persist the pre-call alert type so the fleet-query widget
-- (FleetQueryAgent.get_carrier_check_status) can actually see it — previously
-- "Vehicle Breakdown" only existed in the frontend's CC_DEMO_CARRIERS constant
-- and was never written to the database.
-- Run once in: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql/new

ALTER TABLE carrier_check_loads
  ADD COLUMN IF NOT EXISTS alert_type text;

UPDATE carrier_check_loads SET alert_type = 'driver_initiated_vehicle_breakdown'
WHERE ref = 'CC-038';

UPDATE carrier_check_loads SET alert_type = 'gps_idle'
WHERE ref IN ('REF-29472', 'REF-29471');
