-- Rate Negotiation: carrier rep contact names
-- Run once in: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql/new
-- Requires rate_negotiation_setup.sql to already be applied.

ALTER TABLE carrier_rate_history
  ADD COLUMN IF NOT EXISTS contact_name text;

UPDATE carrier_rate_history SET contact_name = 'Carlos Mendez'   WHERE carrier_name = 'Blue Ridge Carriers';
UPDATE carrier_rate_history SET contact_name = 'Denise Okafor'   WHERE carrier_name = 'Eagle Logistics Inc.';
UPDATE carrier_rate_history SET contact_name = 'Ray Delgado'     WHERE carrier_name = 'Swift Freight Solutions';
UPDATE carrier_rate_history SET contact_name = 'Mike Alvarez'    WHERE carrier_name = 'Mike''s Cartage';
