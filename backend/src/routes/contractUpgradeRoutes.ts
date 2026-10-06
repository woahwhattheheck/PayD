import { Router } from 'express';
import { z } from 'zod';
import { ContractUpgradeController } from '../controllers/contractUpgradeController.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const registryParamsSchema = z.object({
  registryId: z.string().regex(/^[1-9][0-9]*$/, 'registryId must be a positive integer'),
});
const upgradeLogParamsSchema = z.object({
  logId: z.string().regex(/^[1-9][0-9]*$/, 'logId must be a positive integer'),
});
const wasmHashSchema = z.string().length(64).regex(/^[0-9a-fA-F]{64}$/);
const validateHashBodySchema = z.object({ newWasmHash: wasmHashSchema });
const simulateBodySchema = z.object({
  newWasmHash: wasmHashSchema,
  initiatedBy: z.string().min(56).max(64),
  notes: z.string().max(1000).optional(),
});
const executeBodySchema = z.object({
  adminSecret: z.string().min(56),
});

// ---------------------------------------------------------------------------
// Contract registry — list & detail
// ---------------------------------------------------------------------------

/** GET /api/v1/contracts — list all registered contracts */
router.get('/', (req, res) => void ContractUpgradeController.listContracts(req, res));

/** GET /api/v1/contracts/:registryId — single contract detail */
router.get('/:registryId', (req, res) => void ContractUpgradeController.getContract(req, res));

// ---------------------------------------------------------------------------
// Per-contract upgrade lifecycle
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/contracts/:registryId/validate-hash
 * Body: { newWasmHash }
 * Validates format + on-chain existence before simulation.
 */
router.post(
  '/:registryId/validate-hash',
  validateRequest({ params: registryParamsSchema, body: validateHashBodySchema }),
  (req, res) => void ContractUpgradeController.validateHash(req, res)
);

/**
 * POST /api/v1/contracts/:registryId/simulate-upgrade
 * Body: { newWasmHash, initiatedBy, notes? }
 * Pre-flights the upgrade via Soroban RPC, returns cost estimate.
 */
router.post(
  '/:registryId/simulate-upgrade',
  validateRequest({ params: registryParamsSchema, body: simulateBodySchema }),
  (req, res) => void ContractUpgradeController.simulateUpgrade(req, res)
);

/**
 * GET /api/v1/contracts/:registryId/upgrade-logs
 * Query: ?page=1&limit=20
 * Paginated upgrade history for a specific contract.
 */
router.get(
  '/:registryId/upgrade-logs',
  (req, res) => void ContractUpgradeController.listUpgradeLogs(req, res)
);

// ---------------------------------------------------------------------------
// Upgrade log actions (logId-scoped, placed before /:registryId to avoid
// route ambiguity — Express matches in registration order)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/contracts/upgrade-logs/:logId/execute
 * Body: { adminSecret }
 * Executes a simulated upgrade on-chain and starts migration.
 */
router.post(
  '/upgrade-logs/:logId/execute',
  validateRequest({ params: upgradeLogParamsSchema, body: executeBodySchema }),
  (req, res) => void ContractUpgradeController.executeUpgrade(req, res)
);

/**
 * GET /api/v1/contracts/upgrade-logs/:logId/status
 * Polls migration step progress for an executing upgrade.
 */
router.get(
  '/upgrade-logs/:logId/status',
  (req, res) => void ContractUpgradeController.getUpgradeStatus(req, res)
);

/**
 * POST /api/v1/contracts/upgrade-logs/:logId/cancel
 * Cancels a pending or simulated upgrade before execution.
 */
router.post(
  '/upgrade-logs/:logId/cancel',
  validateRequest({ params: upgradeLogParamsSchema }),
  (req, res) => void ContractUpgradeController.cancelUpgrade(req, res)
);

export default router;
