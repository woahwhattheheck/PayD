-- Roll back 029_admin_two_factor_auth.sql
-- Refuse to destroy state that the old plaintext recovery-code model cannot
-- represent safely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'ADMIN') THEN
    RAISE EXCEPTION
      'Cannot roll back 029_admin_two_factor_auth.sql: ADMIN users exist';
  END IF;

  IF EXISTS (SELECT 1 FROM user_recovery_codes) THEN
    RAISE EXCEPTION
      'Cannot roll back 029_admin_two_factor_auth.sql: hashed recovery-code state exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE totp_pending_secret IS NOT NULL
       OR two_factor_enabled_at IS NOT NULL
       OR totp_last_used_step IS NOT NULL
       OR two_factor_failed_attempts <> 0
       OR two_factor_locked_until IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back 029_admin_two_factor_auth.sql: new 2FA state is in use';
  END IF;
END
$$;

DROP TABLE IF EXISTS user_recovery_codes CASCADE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes TEXT[];
ALTER TABLE users
  DROP COLUMN IF EXISTS two_factor_locked_until,
  DROP COLUMN IF EXISTS two_factor_failed_attempts,
  DROP COLUMN IF EXISTS totp_last_used_step,
  DROP COLUMN IF EXISTS two_factor_enabled_at,
  DROP COLUMN IF EXISTS totp_pending_secret;

ALTER TABLE users ALTER COLUMN totp_secret TYPE VARCHAR(255);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('EMPLOYER', 'EMPLOYEE'));
