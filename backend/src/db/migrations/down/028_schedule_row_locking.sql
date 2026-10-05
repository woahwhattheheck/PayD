-- Roll back 028_schedule_row_locking.sql
DROP INDEX IF EXISTS idx_schedules_claim;
ALTER TABLE schedules
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS locked_by;
