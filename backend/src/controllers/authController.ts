import express from 'express';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { pool, query } from '../config/database.js';
import {
  generateRefreshToken,
  generateToken,
  generateTwoFactorChallengeToken,
  verifyTwoFactorChallengeToken,
} from '../services/authService.js';
import {
  RECOVERY_CODE_COUNT,
  TwoFactorError,
  confirmSetup,
  disable as disableTwoFactor,
  getStatus,
  startSetup,
  verifySecondFactor,
} from '../services/twoFactorService.js';

/**
 * Translates a {@link TwoFactorError} into its HTTP response. Anything else is
 * reported as a generic 500 so internal details never reach the client.
 */
function sendTwoFactorError(res: express.Response, error: unknown) {
  if (error instanceof TwoFactorError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }

  console.error('2FA operation failed:', error);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Issues an access/refresh pair and persists the refresh token. */
async function issueSession(user: {
  id: number;
  wallet_address: string | null;
  email?: string | null;
  organization_id: number | null;
  role: string;
}) {
  const accessToken = generateToken(user);
  const refreshToken = generateRefreshToken(user);

  await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

  return { accessToken, refreshToken };
}

export class AuthController {
  /**
   * POST /api/auth/invitations
   * Creates a single-use employee invitation for the caller's organization.
   */
  static async createInvitation(req: express.Request, res: express.Response) {
    const { email, expiresInDays = 7 } = req.body ?? {};
    if (email !== undefined && (typeof email !== 'string' || email.length > 255)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
      return res.status(400).json({ error: 'expiresInDays must be an integer between 1 and 30' });
    }

    try {
      const employer = await query(
        'SELECT organization_id, role FROM users WHERE id = $1',
        [req.user!.id]
      );
      const user = employer.rows[0];
      if (!user?.organization_id || user.role !== 'EMPLOYER') {
        return res.status(403).json({ error: 'Only organization employers can create invitations' });
      }

      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
      const invitation = await query(
        `INSERT INTO invitations (organization_id, email, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, organization_id, email, expires_at`,
        [user.organization_id, email ?? null, tokenHash, expiresAt, req.user!.id]
      );

      // The raw token is only returned at creation time and is never stored.
      return res.status(201).json({ ...invitation.rows[0], token });
    } catch (error) {
      console.error('Invitation creation failed:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /** POST /api/auth/register */
  static async register(req: express.Request, res: express.Response) {
    const { walletAddress, invitationToken } = req.body ?? {};
    if (typeof walletAddress !== 'string' || !walletAddress || typeof invitationToken !== 'string' || !invitationToken) {
      return res.status(400).json({ error: 'walletAddress and invitationToken are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tokenHash = createHash('sha256').update(invitationToken).digest('hex');
      const invitation = await client.query(
        `SELECT id, organization_id FROM invitations
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
        [tokenHash]
      );
      if (invitation.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Invalid, expired, or already used invitation' });
      }

      const user = await client.query(
        `INSERT INTO users (wallet_address, organization_id, role)
         VALUES ($1, $2, 'EMPLOYEE')
         RETURNING id, wallet_address, email, organization_id, role`,
        [walletAddress, invitation.rows[0].organization_id]
      );
      await client.query('UPDATE invitations SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [invitation.rows[0].id]);
      await client.query('COMMIT');

      return res.status(201).json(await issueSession(user.rows[0]));
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        return res.status(409).json({ error: 'Wallet address is already registered' });
      }
      console.error('Invitation registration failed:', error);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/auth/2fa/setup
   * Starts enrolment for the authenticated admin: mints a secret, stores it as
   * pending, and returns the QR code to scan. 2FA is not enabled until the
   * admin confirms a code via `/2fa/verify`.
   */
  static async setup2fa(req: express.Request, res: express.Response) {
    try {
      const { secret, otpauthUrl, qrCode } = await startSetup(req.user!.id);
      return res.json({ qrCode, otpauthUrl, secret });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/2fa/verify
   * Completes enrolment for the authenticated admin. On success 2FA is enabled
   * and the recovery codes are returned — this is the only time they are shown.
   */
  static async verify2fa(req: express.Request, res: express.Response) {
    const { token, code } = req.body ?? {};
    const submitted = code ?? token;

    if (!submitted) {
      return res.status(400).json({ error: 'Missing 2FA code' });
    }

    try {
      const recoveryCodes = await confirmSetup(req.user!.id, submitted);
      return res.json({
        success: true,
        enabled: true,
        recoveryCodes,
        recoveryCodeCount: RECOVERY_CODE_COUNT,
        message: '2FA enabled. Store these recovery codes somewhere safe — they are shown once.',
      });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/2fa/disable
   * Turns 2FA off for the authenticated admin. Requires a current TOTP code;
   * recovery codes are not accepted for this operation.
   */
  static async disable2fa(req: express.Request, res: express.Response) {
    const { token, code } = req.body ?? {};
    const submitted = code ?? token;

    if (!submitted) {
      return res.status(400).json({ error: 'Missing 2FA code' });
    }

    try {
      await disableTwoFactor(req.user!.id, submitted);
      return res.json({ success: true, enabled: false, message: '2FA disabled' });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * GET /api/auth/2fa/status
   * Reports enrolment state for the authenticated user. Never exposes the
   * secret or any recovery code.
   */
  static async status2fa(req: express.Request, res: express.Response) {
    try {
      return res.json(await getStatus(req.user!.id));
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/2fa/authenticate
   * Second step of login. Exchanges the challenge token from `/login` plus a
   * TOTP or recovery code for a real session.
   */
  static async authenticate2fa(req: express.Request, res: express.Response) {
    const { challengeToken, code, token } = req.body ?? {};
    const submitted = code ?? token;

    if (!challengeToken || !submitted) {
      return res.status(400).json({ error: 'Missing challenge token or 2FA code' });
    }

    const userId = verifyTwoFactorChallengeToken(challengeToken);
    if (userId === null) {
      return res.status(401).json({ error: 'Invalid or expired 2FA challenge. Log in again.' });
    }

    try {
      const { usedRecoveryCode } = await verifySecondFactor(userId, submitted);

      const result = await query(
        'SELECT id, wallet_address, email, organization_id, role FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const remaining = await query(
        'SELECT COUNT(*)::int AS count FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
        [userId]
      );

      const session = await issueSession(result.rows[0]);

      return res.json({
        success: true,
        ...session,
        usedRecoveryCode,
        recoveryCodesRemaining: remaining.rows[0]?.count ?? 0,
      });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/login
   * Wallet-based login. When the account has 2FA enabled no session is issued;
   * the caller gets a short-lived challenge to complete at
   * `/api/auth/2fa/authenticate`.
   */
  static async login(req: express.Request, res: express.Response) {
    const { walletAddress } = req.body ?? {};
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing walletAddress' });
    }

    try {
      const result = await query(
        'SELECT id, wallet_address, email, organization_id, role, is_2fa_enabled FROM users WHERE wallet_address = $1',
        [walletAddress]
      );

      if (result.rows.length === 0) {
        // Account creation must happen through the organization invitation flow.
        return res.status(403).json({ error: 'An organization invitation is required to register' });
      }

      const user = result.rows[0];
      if (user.is_2fa_enabled) {
        return res.json({
          requires2fa: true,
          challengeToken: generateTwoFactorChallengeToken(user.id),
        });
      }

      return res.json(await issueSession(user));
    } catch (error: any) {
      console.error('Login failed:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Shared handler for the OAuth callbacks. Passport has already established
   * the first factor at this point, so an account with 2FA enabled is sent back
   * with a challenge instead of a session — otherwise an admin could sidestep
   * their second factor simply by signing in with Google or GitHub.
   */
  static oauthCallback(req: express.Request, res: express.Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const user = req.user;

    if (!user) {
      return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }

    if ('is_2fa_enabled' in user && user.is_2fa_enabled) {
      const challengeToken = generateTwoFactorChallengeToken(user.id);
      return res.redirect(
        `${frontendUrl}/auth-callback?requires2fa=1&challengeToken=${encodeURIComponent(challengeToken)}`
      );
    }

    return res.redirect(
      `${frontendUrl}/auth-callback?token=${encodeURIComponent(generateToken(user))}`
    );
  }

  /**
   * POST /api/auth/refresh
   * Refreshes access token using a valid refresh token.
   */
  static async refresh(req: express.Request, res: express.Response) {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    try {
      const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as { id: number };
      const result = await query(
        'SELECT id, wallet_address, email, organization_id, role, refresh_token FROM users WHERE id = $1',
        [decoded.id]
      );

      if (result.rows.length === 0 || result.rows[0].refresh_token !== refreshToken) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      return res.json({ accessToken: generateToken(result.rows[0]) });
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  }
}
