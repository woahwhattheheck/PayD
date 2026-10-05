// Modified 2026-10-05: validate certificate queries before transaction lookup.
import { Router } from 'express';
import { z } from 'zod';
import { PDFCertificateController } from '../controllers/pdfCertificateController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const transactionQuerySchema = z.object({
  transactionHash: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Transaction hash must contain 64 hexadecimal characters'),
});
const positiveId = z
  .string()
  .regex(/^[0-9]+$/, 'ID must contain only decimal digits')
  .pipe(z.coerce.number().int().positive());
// Generation can resolve absent IDs from the transaction. Supplied IDs must
// still be valid; verification requires both IDs and never auto-detects them.
const generateQuerySchema = transactionQuerySchema.extend({
  employeeId: positiveId.optional(),
  organizationId: positiveId.optional(),
});
const verifyQuerySchema = transactionQuerySchema.extend({
  employeeId: positiveId,
  organizationId: positiveId,
});

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * Generate PDF certificate for a payment transaction
 * GET /api/certificates/generate?employeeId=1&transactionHash=xxx&organizationId=1
 */
router.get('/generate', validateRequest({ query: generateQuerySchema }), PDFCertificateController.generateCertificate);

/**
 * Verify a certificate by transaction hash
 * GET /api/certificates/verify?transactionHash=xxx&employeeId=1&organizationId=1
 */
router.get('/verify', validateRequest({ query: verifyQuerySchema }), PDFCertificateController.verifyCertificate);

/**
 * Get employee and organization info from transaction hash
 * GET /api/certificates/transaction-info?transactionHash=xxx
 */
router.get('/transaction-info', validateRequest({ query: transactionQuerySchema }), PDFCertificateController.getTransactionInfo);

export default router;
