import { Request, Response } from 'express';
import { csvPayrollImportService } from '../services/csvPayrollImportService.js';
import logger from '../utils/logger.js';
import { sendInternalError } from '../utils/internalError.js';

export class BulkImportController {
  async import(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId ?? req.user?.organizationId;
      const csvContent = req.body?.csv;

      if (!organizationId) {
        return res.status(403).json({ error: 'Authenticated organization context required' });
      }

      if (typeof csvContent !== 'string' || csvContent.trim().length === 0) {
        return res.status(400).json({ error: 'Missing csv content' });
      }

      const result = await csvPayrollImportService.processCsv(organizationId, csvContent);

      // Return 207 Multi-Status if there were any errors, otherwise 200/201
      const statusCode = result.errorCount > 0 ? 207 : result.successCount > 0 ? 201 : 200;

      res.status(statusCode).json({
        message:
          result.errorCount === 0
            ? 'Import completed successfully'
            : 'Import completed with some errors',
        summary: {
          totalRows: result.totalRows,
          successCount: result.successCount,
          errorCount: result.errorCount,
        },
        errors: result.errors,
      });
    } catch (error) {
      sendInternalError(res, req, error);
    }
  }
}

export const bulkImportController = new BulkImportController();
