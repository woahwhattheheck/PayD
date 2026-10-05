-- Roll back 017_add_timezone_to_schedules.sql
ALTER TABLE schedules DROP COLUMN IF EXISTS timezone;
