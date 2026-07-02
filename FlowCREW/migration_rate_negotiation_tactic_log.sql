-- Rate Negotiation: log which persuasion tactic Marcus is using, live
-- Run once in: https://supabase.com/dashboard/project/xfhegmlpfqqbipzngjcu/sql/new

ALTER TABLE rate_negotiations
  ADD COLUMN IF NOT EXISTS last_tactic_used         text,
  ADD COLUMN IF NOT EXISTS last_tactic_effectiveness integer;
