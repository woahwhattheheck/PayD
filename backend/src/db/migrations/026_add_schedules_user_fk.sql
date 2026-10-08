-- Migration 018: Add Foreign Key from schedules to users
-- Purpose: Ensure that every schedule is associated with a valid user.
--          The 'user_id' column in 'schedules' was previously unconstrained.

ALTER TABLE schedules
  ADD CONSTRAINT fk_schedules_user
  FOREIGN KEY (user_id) REFERENCES users(id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);

COMMENT ON CONSTRAINT fk_schedules_user ON schedules IS 
  'Ensures referential integrity: schedules must belong to a valid user.';
