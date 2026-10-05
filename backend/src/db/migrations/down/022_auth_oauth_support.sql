-- Roll back 022_auth_oauth_support.sql
-- Refuse a lossy rollback: OAuth-only users can legally have no wallet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE wallet_address IS NULL) THEN
    RAISE EXCEPTION
      'Cannot roll back 022_auth_oauth_support.sql: users with NULL wallet_address exist';
  END IF;
END
$$;

DROP TABLE IF EXISTS social_identities CASCADE;
DROP INDEX IF EXISTS idx_users_email_unique;
ALTER TABLE users
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS email;
ALTER TABLE users ALTER COLUMN wallet_address SET NOT NULL;
