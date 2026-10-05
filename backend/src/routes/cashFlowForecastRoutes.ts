// Modified 2026-10-05: validate forecast filters before calculation dispatch.
import { Router } from 'express';
import { z } from 'zod';
import { CashFlowForecastController } from '../controllers/cashFlowForecastController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

// Controllers retain their defaults and parse the original query strings.
// Require decimal digits before coercion so partial parses and NaN cannot pass.
const boundedWindow = (maximum: number) => z
  .string()
  .regex(/^[0-9]+$/, 'Window must contain only decimal digits')
  .pipe(z.coerce.number().int().min(1).max(maximum))
  .optional();
const projectionQuerySchema = z.object({ forecastDays: boundedWindow(365) });
const forecastQuerySchema = projectionQuerySchema.extend({
  distributionAccount: z.string().length(56, 'Distribution account must be 56 characters'),
  assetIssuer: z.string().length(56, 'Asset issuer must be 56 characters'),
});
const historicalQuerySchema = z.object({ monthsBack: boundedWindow(24) });

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * @route GET /api/cash-flow/forecast
 * @desc Generate comprehensive cash flow forecast
 * @query forecastDays - Number of days to forecast (default: 90, max: 365)
 * @query distributionAccount - Stellar distribution account public key (required)
 * @query assetIssuer - ORGUSD asset issuer public key (required)
 * @access Private (requires authentication)
 */
router.get('/forecast', validateRequest({ query: forecastQuerySchema }), CashFlowForecastController.getForecast);

/**
 * @route GET /api/cash-flow/historical
 * @desc Get historical payroll data analysis
 * @query monthsBack - Number of months to analyze (default: 6, max: 24)
 * @access Private (requires authentication)
 */
router.get('/historical', validateRequest({ query: historicalQuerySchema }), CashFlowForecastController.getHistorical);

/**
 * @route GET /api/cash-flow/projections
 * @desc Get upcoming scheduled payroll projections
 * @query forecastDays - Number of days to project (default: 90, max: 365)
 * @access Private (requires authentication)
 */
router.get('/projections', validateRequest({ query: projectionQuerySchema }), CashFlowForecastController.getProjections);

/**
 * @route GET /api/cash-flow/alerts
 * @desc Get budget alerts for the organization
 * @query forecastDays - Number of days to forecast (default: 90, max: 365)
 * @query distributionAccount - Stellar distribution account public key (required)
 * @query assetIssuer - ORGUSD asset issuer public key (required)
 * @access Private (requires authentication)
 */
router.get('/alerts', validateRequest({ query: forecastQuerySchema }), CashFlowForecastController.getAlerts);

export default router;
