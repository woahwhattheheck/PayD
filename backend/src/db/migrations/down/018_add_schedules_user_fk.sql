-- Roll back 018_add_schedules_user_fk.sql
DROP INDEX IF EXISTS idx_schedules_user_id;
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS fk_schedules_user;
