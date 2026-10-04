import { Request, Response, NextFunction, Router } from 'express';
import { payrollQueryService } from '../services/payroll-query.service.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import {
  strictTenantBoundary,
  validateActiveTenant,
  logTenantAccess,
} from '../middleware/enhancedTenantIsolation.js';

const router = Router();

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

// Apply authentication to all payroll routes
router.use(authenticateJWT);

// Enhanced tenant isolation — runs after auth (req.user is available)
router.use(strictTenantBoundary);
router.use(validateActiveTenant);
router.use(logTenantAccess);

router.use(authorizeRoles('EMPLOYER', 'EMPLOYEE'));
router.use(isolateOrganization);

/**
 * Query payroll transactions with filtering and pagination
 * GET /api/payroll/transactions
 * Query params:
 * - orgPublicKey: Organization public key (required)
 * - employeeId: Filter by employee ID
 * - batchId: Filter by payroll batch ID
 * - assetCode: Filter by asset code
 * - assetIssuer: Filter by asset issuer
 * - startDate: Start date (ISO 8601)
 * - endDate: End date (ISO 8601)
 * - page: Page number (default: 1)
 * - limit: Records per page (default: 50, max: 500)
 * - sortBy: Sort field (timestamp, amount, employeeId)
 * - sortOrder: Sort order (asc, desc)
 */
router.get('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      orgPublicKey,
      employeeId,
      batchId,
      assetCode,
      assetIssuer,
      startDate,
      endDate,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    if (!orgPublicKeyStr) {
      return next(new ValidationError('Missing required parameter: orgPublicKey'));
    }

    const query = {
      organizationPublicKey: orgPublicKeyStr,
      employeeId: asString(employeeId),
      payrollBatchId: asString(batchId),
      assetCode: asString(assetCode),
      assetIssuer: asString(assetIssuer),
      startDate: asString(startDate) ? new Date(asString(startDate)!) : undefined,
      endDate: asString(endDate) ? new Date(asString(endDate)!) : undefined,
    };

    const result = await payrollQueryService.queryPayroll(query, Number(page), Number(limit), {
      enrichPayrollData: true,
      sortBy: (sortBy as any) || 'timestamp',
      sortOrder: (sortOrder as any) || 'desc',
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get payroll for a specific employee
 * GET /api/payroll/employees/:employeeId
 */
router.get('/employees/:employeeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;
    const { orgPublicKey, startDate, endDate, page, limit } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    if (!orgPublicKeyStr) {
      return next(new ValidationError('Missing required query parameter: orgPublicKey'));
    }

    const result = await payrollQueryService.getEmployeePayroll(
      orgPublicKeyStr,
      employeeId as string,
      asString(startDate) ? new Date(asString(startDate)!) : undefined,
      asString(endDate) ? new Date(asString(endDate)!) : undefined,
      Number(page),
      Number(limit)
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get employee payroll summary
 * GET /api/payroll/employees/:employeeId/summary
 */
router.get('/employees/:employeeId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;
    const { orgPublicKey, startDate, endDate } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    if (!orgPublicKeyStr) {
      return next(new ValidationError('Missing required query parameter: orgPublicKey'));
    }

    const summary = await payrollQueryService.getEmployeeSummary(
      orgPublicKeyStr,
      employeeId as string,
      asString(startDate) ? new Date(asString(startDate)!) : undefined,
      asString(endDate) ? new Date(asString(endDate)!) : undefined
    );

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get payroll batch details
 * GET /api/payroll/batches/:batchId
 */
router.get('/batches/:batchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;
    const { orgPublicKey, page, limit } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    if (!orgPublicKeyStr) {
      return next(new ValidationError('Missing required query parameter: orgPublicKey'));
    }

    const result = await payrollQueryService.getPayrollBatch(
      orgPublicKeyStr,
      batchId as string,
      Number(page),
      Number(limit)
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get payroll aggregation statistics
 * GET /api/payroll/aggregation
 */
router.get('/aggregation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgPublicKey, startDate, endDate, assetCode, assetIssuer } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    if (!orgPublicKeyStr) {
      return next(new ValidationError('Missing required query parameter: orgPublicKey'));
    }

    const aggregation = await payrollQueryService.getPayrollAggregation(
      orgPublicKeyStr,
      asString(startDate) ? new Date(asString(startDate)!) : undefined,
      asString(endDate) ? new Date(asString(endDate)!) : undefined,
      asString(assetCode),
      asString(assetIssuer)
    );

    res.json({
      success: true,
      data: aggregation,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get organization-wide audit report
 * GET /api/payroll/audit
 */
router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgPublicKey, startDate, endDate } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    if (!orgPublicKeyStr) {
      return next(new ValidationError('Missing required query parameter: orgPublicKey'));
    }

    const report = await payrollQueryService.getOrganizationAuditReport(
      orgPublicKeyStr,
      asString(startDate) ? new Date(asString(startDate)!) : undefined,
      asString(endDate) ? new Date(asString(endDate)!) : undefined
    );

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Search transactions by memo pattern
 * GET /api/payroll/search/memo
 */
router.get('/search/memo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgPublicKey, pattern, page, limit } = req.query;

    const orgPublicKeyStr = asString(orgPublicKey);
    const patternStr = asString(pattern);
    if (!orgPublicKeyStr || !patternStr) {
      return next(new ValidationError('Missing required query parameters: orgPublicKey, pattern'));
    }

    const result = await payrollQueryService.searchByMemoPattern(
      orgPublicKeyStr,
      patternStr,
      Number(page),
      Number(limit)
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get transaction details by hash
 * GET /api/payroll/transactions/:txHash
 */
router.get('/transactions/:txHash', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { txHash } = req.params;

    const transaction = await payrollQueryService.getTransactionDetails(txHash as string);

    if (!transaction) {
      return next(new NotFoundError('Transaction not found'));
    }

    res.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get SDS rate limit information
 * GET /api/payroll/status/rate-limit
 */
router.get('/status/rate-limit', (req: Request, res: Response, next: NextFunction) => {
  try {
    const rateLimitInfo = payrollQueryService.getSDSRateLimitInfo();

    res.json({
      success: true,
      data: rateLimitInfo || { message: 'No rate limit info available' },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Check SDS health status
 * GET /api/payroll/status/health
 */
router.get('/status/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const healthy = await payrollQueryService.checkSDSHealth();

    res.json({
      success: true,
      data: {
        status: healthy ? 'healthy' : 'unhealthy',
        service: 'SDS',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Clear cache (admin endpoint)
 * POST /api/payroll/cache/clear
 */
router.post('/cache/clear', (req: Request, res: Response, next: NextFunction) => {
  try {
    payrollQueryService.clearCache();

    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get cache statistics
 * GET /api/payroll/cache/stats
 */
router.get('/cache/stats', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = payrollQueryService.getCacheStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
