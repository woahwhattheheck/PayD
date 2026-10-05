import { Router } from 'express';
import { z } from 'zod';
import passport from 'passport';
import { AuthController } from '../controllers/authController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles } from '../middlewares/rbac.js';
import { TWO_FACTOR_ROLES } from '../services/twoFactorService.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const walletAddressBodySchema = z.object({ walletAddress: z.string().min(1) });
const registerBodySchema = z.object({
  walletAddress: z.string().min(1),
  invitationToken: z.string().min(1),
});
const refreshBodySchema = z.object({ refreshToken: z.string().min(1) });
const invitationBodySchema = z.object({
  email: z.string().email().max(255).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});
const twoFactorCodeBodySchema = z
  .object({
    token: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
  })
  .refine((body) => Boolean(body.token || body.code), {
    message: 'code or token is required',
    path: ['code'],
  });
const authenticate2faBodySchema = twoFactorCodeBodySchema.and(
  z.object({ challengeToken: z.string().min(1) })
);
const optionalObjectBodySchema = z.object({}).passthrough().optional();

router.post('/login', validateRequest({ body: walletAddressBodySchema }), AuthController.login);
router.post('/register', validateRequest({ body: registerBodySchema }), AuthController.register);
router.post('/refresh', validateRequest({ body: refreshBodySchema }), AuthController.refresh);

router.post(
  '/invitations',
  authenticateJWT,
  authorizeRoles('EMPLOYER'),
  validateRequest({ body: invitationBodySchema }),
  AuthController.createInvitation
);

// ── Two-factor authentication ──────────────────────────────────────────────
//
// Enrolment endpoints are account settings, so they run on the caller's own
// session and are limited to the privileged roles the feature targets. The
// account is always taken from the verified JWT, never from the request body,
// so nobody can enrol or disable 2FA on someone else's account.

// Second step of login: exchanges the challenge issued by /login for a session.
// Unauthenticated by design — the challenge token is the credential.
router.post(
  '/2fa/authenticate',
  validateRequest({ body: authenticate2faBodySchema }),
  AuthController.authenticate2fa
);

router.get('/2fa/status', authenticateJWT, AuthController.status2fa);

router.post(
  '/2fa/setup',
  authenticateJWT,
  authorizeRoles(...TWO_FACTOR_ROLES),
  validateRequest({ body: optionalObjectBodySchema }),
  AuthController.setup2fa
);
router.post(
  '/2fa/verify',
  authenticateJWT,
  authorizeRoles(...TWO_FACTOR_ROLES),
  validateRequest({ body: twoFactorCodeBodySchema }),
  AuthController.verify2fa
);
router.post(
  '/2fa/disable',
  authenticateJWT,
  authorizeRoles(...TWO_FACTOR_ROLES),
  validateRequest({ body: twoFactorCodeBodySchema }),
  AuthController.disable2fa
);

// Google Auth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  AuthController.oauthCallback
);

// GitHub Auth
router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));

router.get(
  '/github/callback',
  passport.authenticate('github', { session: false, failureRedirect: '/login' }),
  AuthController.oauthCallback
);

export default router;
