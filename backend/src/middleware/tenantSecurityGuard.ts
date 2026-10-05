import { Request, Response, NextFunction } from 'express';
import { tenantSecurityService } from '../services/tenantSecurityService.js';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface TenantSecurityGuardOptions {
  detectAnomalies?: boolean;
  logAccess?: boolean;
  strictMode?: boolean;
}

const SECURITY_FAILURE_THRESHOLD = 3;
const SECURITY_BREAKER_COOLDOWN_MS = 30_000;

/**
 * Tenant security guard middleware for enhanced isolation monitoring
 */
export function tenantSecurityGuardMiddleware(options: TenantSecurityGuardOptions = {}) {
  const {
    detectAnomalies = true,
    logAccess = true,
    strictMode = false,
  } = options;

  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  const requestContext = (req: Request, organizationId: number) => ({
    organizationId,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const recordDependencyFailure = (error: unknown, req: Request, organizationId: number) => {
    consecutiveFailures += 1;
    if (consecutiveFailures >= SECURITY_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + SECURITY_BREAKER_COOLDOWN_MS;
    }

    logger.error('Tenant security guard dependency failure', {
      error,
      ...requestContext(req, organizationId),
      consecutiveFailures,
      circuitOpenUntil: circuitOpenUntil || undefined,
    });
  };

  const rejectUnavailable = (res: Response) => {
    res.status(503).json({
      error: 'Security check unavailable',
      message: 'Access denied while security checks are unavailable.',
    });
  };

  const resetBreaker = () => {
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.tenantId || req.user?.organizationId;
    if (!organizationId) {
      if (strictMode) {
        res.status(403).json({
          error: 'Access denied',
          message: 'Organization context required',
        });
        return;
      }
      return next();
    }

    if (circuitOpenUntil > 0) {
      if (Date.now() < circuitOpenUntil) {
        logger.error('Tenant security guard circuit open', {
          ...requestContext(req, organizationId),
          consecutiveFailures,
          circuitOpenUntil,
        });
        rejectUnavailable(res);
        return;
      }

      resetBreaker();
    }

    try {
      // Log access for security monitoring
      if (logAccess) {
        await tenantSecurityService.recordAccessPattern({
          organizationId,
          patternType: 'api_access',
          patternValue: {
            path: req.path,
            method: req.method,
            userId: req.user?.id,
          },
          confidenceScore: 0.5,
        });
      }

      // Check for suspicious patterns
      if (detectAnomalies) {
        const anomalies = await tenantSecurityService.detectAnomalies(organizationId);

        if (anomalies.length > 0) {
          // Log security event for anomalies
          await tenantSecurityService.recordSecurityEvent({
            organizationId,
            eventType: 'anomaly_detected',
            severity: 'medium',
            sourceUserId: req.user?.id ? parseInt(req.user.id as string, 10) : undefined,
            description: `Detected ${anomalies.length} anomalous access patterns`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            metadata: {
              anomalies: anomalies.map((a) => a.patternType),
              path: req.path,
            },
          });

          if (strictMode) {
            resetBreaker();
            res.status(403).json({
              error: 'Access denied',
              message: 'Suspicious activity detected. Please contact support.',
            });
            return;
          }
        }
      }

      // Check for IP whitelist/blacklist
      let ipAccessError: unknown;
      const ipAllowed = await checkIpAccess(organizationId, req.ip, (error) => {
        ipAccessError = error;
      });

      if (ipAccessError !== undefined) {
        recordDependencyFailure(ipAccessError, req, organizationId);
        rejectUnavailable(res);
        return;
      }

      if (!ipAllowed) {
        await tenantSecurityService.recordSecurityEvent({
          organizationId,
          eventType: 'ip_blocked',
          severity: 'high',
          sourceUserId: req.user?.id ? parseInt(req.user.id as string, 10) : undefined,
          description: `Request from blocked IP: ${req.ip}`,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        resetBreaker();
        res.status(403).json({
          error: 'Access denied',
          message: 'Your IP address is not authorized to access this resource.',
        });
        return;
      }

      resetBreaker();
      next();
    } catch (error) {
      recordDependencyFailure(error, req, organizationId);
      rejectUnavailable(res);
    }
  };
}

/**
 * Middleware to validate tenant boundary for specific resources
 */
export function validateTenantResourceAccess() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.tenantId || req.user?.organizationId;
    if (!organizationId) return next();

    // Check if user is trying to access resource from different tenant
    const targetOrgId = req.params.organizationId || req.body.organizationId;

    if (targetOrgId && parseInt(targetOrgId, 10) !== organizationId) {
      await tenantSecurityService.recordSecurityEvent({
        organizationId,
        eventType: 'cross_tenant_access_attempt',
        severity: 'high',
        sourceUserId: req.user?.id ? parseInt(req.user.id as string, 10) : undefined,
        targetOrganizationId: parseInt(targetOrgId, 10),
        description: `Attempted cross-tenant resource access`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          requestedPath: req.path,
          targetOrgId,
        },
      });

      res.status(403).json({
        error: 'Access denied',
        message: 'Cannot access resources outside your organization',
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to monitor and log all tenant access
 */
export function monitorTenantActivity() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.tenantId || req.user?.organizationId;
    if (!organizationId) return next();

    const startTime = Date.now();

    res.on('finish', async () => {
      const duration = Date.now() - startTime;

      try {
        // Log access pattern
        await tenantSecurityService.recordAccessPattern({
          organizationId,
          patternType: 'api_response',
          patternValue: {
            path: req.path,
            method: req.method,
            statusCode: res.statusCode,
            duration,
            userId: req.user?.id,
          },
          confidenceScore: res.statusCode >= 400 ? 0.8 : 0.3,
        });

        // Record security event for errors
        if (res.statusCode >= 500) {
          await tenantSecurityService.recordSecurityEvent({
            organizationId,
            eventType: 'server_error',
            severity: 'medium',
            sourceUserId: req.user?.id ? parseInt(req.user.id as string, 10) : undefined,
            description: `Server error on ${req.method} ${req.path}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            metadata: {
              statusCode: res.statusCode,
              duration,
            },
          });
        }
      } catch (error) {
        logger.error('Failed to monitor tenant activity', { error, organizationId });
      }
    });

    next();
  };
}

/**
 * Check if IP is allowed for the organization
 */
async function checkIpAccess(
  organizationId: number,
  ip?: string,
  onError?: (error: unknown) => void
): Promise<boolean> {
  if (!ip) return true;

  try {
    const result = await pool.query(
      `SELECT ip_whitelist, ip_blacklist
       FROM organization_settings
       WHERE organization_id = $1`,
      [organizationId]
    );

    if (result.rows.length === 0) return true;

    const settings = result.rows[0];

    // Check blacklist first
    if (settings.ip_blacklist && Array.isArray(settings.ip_blacklist)) {
      if (settings.ip_blacklist.includes(ip)) {
        return false;
      }
    }

    // Check whitelist if defined
    if (settings.ip_whitelist && Array.isArray(settings.ip_whitelist)) {
      if (settings.ip_whitelist.length > 0 && !settings.ip_whitelist.includes(ip)) {
        return false;
      }
    }

    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}