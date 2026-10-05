import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database.js';

// Extend Express Request to include tenant information
declare global {
  namespace Express {
    interface Request {
      tenantId?: number;
      organizationId?: number; // Alias for clarity
    }
  }
}

/**
 * Middleware to derive tenant context from the authenticated user.
 *
 * Authentication middleware must run before this middleware. Client-controlled
 * headers are never used as tenant identity. When a route contains an
 * organizationId parameter, it is treated only as an authorization boundary
 * and must match the organization in the verified user principal.
 */
export const extractTenantId = (req: Request, res: Response, next: NextFunction) => {
  const tenantId = req.user?.organizationId;

  if (typeof tenantId !== 'number' || !Number.isInteger(tenantId) || tenantId <= 0) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'Authenticated user is not associated with a valid organization',
    });
  }

  const requestedOrganizationId = req.params.organizationId;
  if (requestedOrganizationId !== undefined) {
    const requestedTenantId = Number(requestedOrganizationId);

    if (!Number.isInteger(requestedTenantId) || requestedTenantId <= 0) {
      return res.status(400).json({
        error: 'Invalid organization ID',
        message: 'Organization ID must be a positive integer',
      });
    }

    if (requestedTenantId !== tenantId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Cannot access resources outside your organization',
      });
    }
  }

  req.tenantId = tenantId;
  req.organizationId = tenantId;

  next();
};

/**
 * Middleware to set PostgreSQL session variable for RLS
 * This must be called after extractTenantId
 */
export const setTenantContext = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) {
    return res.status(500).json({
      error: 'Tenant context not set',
      message: 'extractTenantId middleware must be called before setTenantContext',
    });
  }

  try {
    // Get a client from the pool for this request
    const client = await pool.connect();

    // Set the tenant ID in the PostgreSQL session
    await client.query('SET LOCAL app.current_tenant_id = $1', [req.tenantId]);

    // Store client in request for cleanup
    (req as any).dbClient = client;

    // Ensure client is released after response
    res.on('finish', () => {
      if ((req as any).dbClient) {
        (req as any).dbClient.release();
      }
    });

    res.on('close', () => {
      if ((req as any).dbClient) {
        (req as any).dbClient.release();
      }
    });

    next();
  } catch (error) {
    console.error('Error setting tenant context:', error);
    return res.status(500).json({
      error: 'Failed to set tenant context',
      message: 'An error occurred while establishing tenant isolation',
    });
  }
};

/**
 * Middleware to verify tenant exists and is active
 * Optional but recommended for additional security
 */
export const validateTenant = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) {
    return res.status(500).json({
      error: 'Tenant ID not set',
      message: 'extractTenantId middleware must be called before validateTenant',
    });
  }

  try {
    const result = await pool.query('SELECT id, name FROM organizations WHERE id = $1', [
      req.tenantId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Organization not found',
        message: `Organization with ID ${req.tenantId} does not exist`,
      });
    }

    // Optionally attach organization info to request
    (req as any).organization = result.rows[0];

    next();
  } catch (error) {
    console.error('Error validating tenant:', error);
    return res.status(500).json({
      error: 'Failed to validate tenant',
      message: 'An error occurred while validating the organization',
    });
  }
};

/**
 * Combined middleware that handles full tenant context setup
 * Use this for most routes that require tenant isolation
 */
export const requireTenantContext = [extractTenantId, validateTenant, setTenantContext];

/**
 * Lightweight tenant middleware without RLS setup
 * Use for routes that handle tenant context manually
 */
export const requireTenantId = [extractTenantId, validateTenant];

/**
 * Sync tenant ID from authenticated JWT user.
 * Sets req.tenantId from req.user.organizationId when no explicit
 * tenant has been extracted from URL params or headers yet.
 * Must run AFTER authentication middleware.
 */
export const syncTenantFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.tenantId && req.user?.organizationId) {
    req.tenantId = req.user.organizationId;
    req.organizationId = req.user.organizationId;
  }
  next();
};
