import { Request, Response, NextFunction } from 'express';
import {
  tenantSecurityGuardMiddleware,
  validateTenantResourceAccess,
  monitorTenantActivity,
} from '../tenantSecurityGuard.js';
import { tenantSecurityService } from '../../services/tenantSecurityService.js';
import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';

jest.mock('../../services/tenantSecurityService.js');
jest.mock('../../config/database.js');
jest.mock('../../utils/logger.js');

describe('Tenant Security Guard Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockPool: jest.Mocked<typeof pool>;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      path: '/api/employees',
      tenantId: 1,
      user: {
        id: 'user-123',
        email: 'test@example.com',
        organizationId: 1,
        role: 'EMPLOYER',
      },
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'Jest Test Agent',
      },
      params: {},
      body: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
    } as any;

    nextFunction = jest.fn();

    mockPool = pool as jest.Mocked<typeof pool>;
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

    (tenantSecurityService.recordAccessPattern as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    (tenantSecurityService.detectAnomalies as jest.Mock) = jest.fn().mockResolvedValue([]);
    (tenantSecurityService.recordSecurityEvent as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('tenantSecurityGuardMiddleware', () => {
    it('should allow normal requests', async () => {
      const middleware = tenantSecurityGuardMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(tenantSecurityService.recordAccessPattern).toHaveBeenCalled();
    });

    it('should block requests without verified tenant context', async () => {
      mockRequest.tenantId = undefined;

      const middleware = tenantSecurityGuardMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Access denied',
        message: 'Verified organization context required',
      });
    });

    it('should detect and log anomalies', async () => {
      (tenantSecurityService.detectAnomalies as jest.Mock).mockResolvedValue([
        {
          organizationId: 1,
          patternType: 'multiple_ips_per_user',
          patternValue: { userId: 'user-123', ipCount: 5 },
          confidenceScore: 0.8,
        },
      ]);

      const middleware = tenantSecurityGuardMiddleware({ detectAnomalies: true });

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(tenantSecurityService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'anomaly_detected',
          severity: 'medium',
        })
      );
    });

    it('should block requests with anomalies in strict mode', async () => {
      (tenantSecurityService.detectAnomalies as jest.Mock).mockResolvedValue([
        {
          organizationId: 1,
          patternType: 'multiple_ips_per_user',
          patternValue: { userId: 'user-123', ipCount: 5 },
          confidenceScore: 0.8,
        },
      ]);

      const middleware = tenantSecurityGuardMiddleware({
        detectAnomalies: true,
        strictMode: true,
      });

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should fail closed when a tenant security check errors', async () => {
      (tenantSecurityService.recordAccessPattern as jest.Mock).mockRejectedValue(
        new Error('Service error')
      );

      const middleware = tenantSecurityGuardMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Tenant security check unavailable',
        message: 'Unable to verify tenant access at this time',
      });
      expect(logger.error).toHaveBeenCalledWith('Tenant security guard error', expect.any(Object));
    });

    it('should fail closed when IP policy lookup fails', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Database error'));

      const middleware = tenantSecurityGuardMiddleware({
        detectAnomalies: false,
        logAccess: false,
      });

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(logger.error).toHaveBeenCalledWith('Failed to check IP access', expect.any(Object));
    });
  });

  describe('validateTenantResourceAccess', () => {
    it('should reject access when verified tenant context is missing', async () => {
      mockRequest.tenantId = undefined;

      const middleware = validateTenantResourceAccess();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should allow access to same organization resources', async () => {
      mockRequest.params = { organizationId: '1' };

      const middleware = validateTenantResourceAccess();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should block access to different organization resources', async () => {
      mockRequest.params = { organizationId: '2' };

      const middleware = validateTenantResourceAccess();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(tenantSecurityService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cross_tenant_access_attempt',
          severity: 'high',
        })
      );
    });
  });

  describe('monitorTenantActivity', () => {
    it('should track activity on response finish', async () => {
      let finishCallback: Function | null = null;
      mockResponse.on = jest.fn((event, callback) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockResponse;
      }) as any;

      const middleware = monitorTenantActivity();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      // Simulate response finish
      if (finishCallback) {
        mockResponse.statusCode = 200;
        finishCallback();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(tenantSecurityService.recordAccessPattern).toHaveBeenCalledWith(
        expect.objectContaining({
          patternType: 'api_response',
        })
      );
    });

    it('should record security event for server errors', async () => {
      let finishCallback: Function | null = null;
      mockResponse.on = jest.fn((event, callback) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockResponse;
      }) as any;

      const middleware = monitorTenantActivity();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      if (finishCallback) {
        mockResponse.statusCode = 500;
        finishCallback();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(tenantSecurityService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'server_error',
          severity: 'medium',
        })
      );
    });
  });
});