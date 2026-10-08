import { Request, Response, NextFunction } from 'express';
import { idempotencyMiddleware, handleConcurrentDuplicate } from '../idempotencyMiddleware.js';
import * as idempotencyService from '../../services/idempotencyService.js';
import { IdempotencyConflictError } from '../../services/idempotencyService.js';

jest.mock('../../services/idempotencyService.js');
jest.mock('../../utils/logger.js');

const leaseExpiresAt = new Date('2026-10-06T12:00:00.000Z');
const claimed = () => ({ kind: 'claimed' as const, expiresAt: leaseExpiresAt });

describe('idempotencyMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'POST',
      path: '/api/payments/sep31/initiate',
      headers: {},
      tenantId: 1,
      user: { id: 1, organizationId: 1, role: 'EMPLOYER' },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      statusCode: 200,
    } as any;

    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  describe('header extraction', () => {
    it('should pass through when no Idempotency-Key header is present', async () => {
      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
      expect(idempotencyService.claimKey).not.toHaveBeenCalled();
    });

    it('should pass through for GET requests even with a header', async () => {
      mockRequest.method = 'GET';
      mockRequest.headers = { 'idempotency-key': 'test-key-123' };
      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
      expect(idempotencyService.claimKey).not.toHaveBeenCalled();
    });

    it('should accept the Idempotency-Key header', async () => {
      mockRequest.headers = { 'idempotency-key': 'test-key-123' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(
        1,
        'test-key-123',
        expect.any(Number)
      );
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('key validation', () => {
    it('should reject an empty key', async () => {
      mockRequest.headers = { 'idempotency-key': '' };
      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid Idempotency-Key' })
      );
    });

    it('should reject a key exceeding 255 characters', async () => {
      mockRequest.headers = { 'idempotency-key': 'a'.repeat(256) };
      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should accept a key of exactly 255 characters', async () => {
      mockRequest.headers = { 'idempotency-key': 'a'.repeat(255) };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());
      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('tenant scoping', () => {
    it('should use req.tenantId when available', async () => {
      mockRequest.tenantId = 42;
      mockRequest.headers = { 'idempotency-key': 'key-1' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(42, 'key-1', expect.any(Number));
    });

    it('should fall back to req.user.organizationId', async () => {
      mockRequest.tenantId = undefined;
      mockRequest.user = { id: 1, organizationId: 99, role: 'EMPLOYER' };
      mockRequest.headers = { 'idempotency-key': 'key-1' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(99, 'key-1', expect.any(Number));
    });

    it('should pass through without tenant context', async () => {
      mockRequest.tenantId = undefined;
      mockRequest.user = undefined;
      mockRequest.headers = { 'idempotency-key': 'key-1' };

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(idempotencyService.claimKey).not.toHaveBeenCalled();
    });
  });

  describe('replay handling', () => {
    it('should return a stored successful response', async () => {
      mockRequest.headers = { 'idempotency-key': 'replay-key' };
      const storedResponse = { success: true, data: { id: 1 } };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue({
        kind: 'replay',
        record: {
          id: 1,
          organizationId: 1,
          idempotencyKey: 'replay-key',
          status: 'completed',
          responseStatus: 201,
          responseBody: storedResponse,
          createdAt: new Date(),
          expiresAt: new Date(),
        },
      });

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(storedResponse);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should replay failed responses too', async () => {
      mockRequest.headers = { 'idempotency-key': 'fail-replay' };
      const errorResponse = { error: 'Bad Request' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue({
        kind: 'replay',
        record: {
          id: 2,
          organizationId: 1,
          idempotencyKey: 'fail-replay',
          status: 'failed',
          responseStatus: 400,
          responseBody: errorResponse,
          createdAt: new Date(),
          expiresAt: new Date(),
        },
      });

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(errorResponse);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('response interception', () => {
    it('should store successful responses with the owning lease', async () => {
      mockRequest.headers = { 'idempotency-key': 'new-key' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());
      (idempotencyService.completeKey as jest.Mock).mockResolvedValue(true);

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      mockResponse.statusCode = 201;
      const responseBody = { success: true, data: { id: 42 } };
      (mockResponse.json as any)(responseBody);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(idempotencyService.completeKey).toHaveBeenCalledWith(
        1,
        'new-key',
        leaseExpiresAt,
        201,
        responseBody
      );
    });

    it('should store client errors with the owning lease', async () => {
      mockRequest.headers = { 'idempotency-key': 'error-key' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());
      (idempotencyService.completeKey as jest.Mock).mockResolvedValue(true);

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      mockResponse.statusCode = 400;
      const errorBody = { error: 'Bad Request' };
      (mockResponse.json as any)(errorBody);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(idempotencyService.completeKey).toHaveBeenCalledWith(
        1,
        'error-key',
        leaseExpiresAt,
        400,
        errorBody
      );
    });

    it('should mark server errors with the owning lease', async () => {
      mockRequest.headers = { 'idempotency-key': 'server-error' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());
      (idempotencyService.failKey as jest.Mock).mockResolvedValue(true);

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      mockResponse.statusCode = 500;
      const errorBody = { error: 'Internal Server Error' };
      (mockResponse.json as any)(errorBody);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(idempotencyService.failKey).toHaveBeenCalledWith(
        1,
        'server-error',
        leaseExpiresAt,
        500,
        errorBody
      );
      expect(idempotencyService.completeKey).not.toHaveBeenCalled();
    });
  });

  describe('custom options', () => {
    it('should use a custom TTL', async () => {
      mockRequest.headers = { 'idempotency-key': 'custom-ttl' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());

      await idempotencyMiddleware({ ttlMs: 3600000 })(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(1, 'custom-ttl', 3600000);
    });

    it('should use a custom methods filter', async () => {
      mockRequest.method = 'PUT';
      mockRequest.headers = { 'idempotency-key': 'put-key' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());

      await idempotencyMiddleware({ methods: ['POST', 'PUT'] })(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(idempotencyService.claimKey).toHaveBeenCalled();
    });

    it('should use a custom key validator', async () => {
      mockRequest.headers = { 'idempotency-key': 'uuid-format' };
      const customValidator = jest.fn().mockReturnValue(true);
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(claimed());

      await idempotencyMiddleware({ validateKey: customValidator })(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(customValidator).toHaveBeenCalledWith('uuid-format');
    });
  });

  describe('error handling', () => {
    it('should wait for an in-progress duplicate and replay the first terminal response', async () => {
      mockRequest.headers = { 'idempotency-key': 'race-key' };
      (idempotencyService.claimKey as jest.Mock).mockRejectedValue(
        new IdempotencyConflictError(1, 'race-key')
      );
      (idempotencyService.waitForReplay as jest.Mock).mockResolvedValue({
        id: 7,
        organizationId: 1,
        idempotencyKey: 'race-key',
        status: 'completed',
        responseStatus: 202,
        responseBody: { accepted: true },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.waitForReplay).toHaveBeenCalledWith(1, 'race-key');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
      expect(mockResponse.status).toHaveBeenCalledWith(202);
      expect(mockResponse.json).toHaveBeenCalledWith({ accepted: true });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 409 when a concurrent duplicate does not finish within the replay wait', async () => {
      mockRequest.headers = { 'idempotency-key': 'race-key' };
      (idempotencyService.claimKey as jest.Mock).mockRejectedValue(
        new IdempotencyConflictError(1, 'race-key')
      );
      (idempotencyService.waitForReplay as jest.Mock).mockResolvedValue(null);

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.waitForReplay).toHaveBeenCalledWith(1, 'race-key');
      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Conflict' })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 503 without processing when the idempotency claim fails', async () => {
      mockRequest.headers = { 'idempotency-key': 'error-key' };
      (idempotencyService.claimKey as jest.Mock).mockRejectedValue(new Error('DB down'));

      await idempotencyMiddleware()(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '1');
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Unable to verify the Idempotency-Key. Retry later with the same key.',
      });
      expect(idempotencyService.waitForReplay).not.toHaveBeenCalled();
      expect(idempotencyService.completeKey).not.toHaveBeenCalled();
      expect(idempotencyService.failKey).not.toHaveBeenCalled();
    });
  });
});

describe('handleConcurrentDuplicate', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockRequest = {
      tenantId: 1,
      user: { id: 1, organizationId: 1, role: 'EMPLOYER' },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
    jest.clearAllMocks();
  });

  it('should return false when no idempotency key is on the request', async () => {
    await expect(
      handleConcurrentDuplicate(mockRequest as Request, mockResponse as Response)
    ).resolves.toBe(false);
  });

  it('should return false when the request is not in flight', async () => {
    (mockRequest as any).idempotencyKey = 'test-key';
    (idempotencyService.isInFlight as jest.Mock).mockResolvedValue(false);

    await expect(
      handleConcurrentDuplicate(mockRequest as Request, mockResponse as Response)
    ).resolves.toBe(false);
    expect(idempotencyService.isInFlight).toHaveBeenCalledWith(1, 'test-key');
  });

  it('should return 409 when the request is in flight', async () => {
    (mockRequest as any).idempotencyKey = 'test-key';
    (idempotencyService.isInFlight as jest.Mock).mockResolvedValue(true);

    await expect(
      handleConcurrentDuplicate(mockRequest as Request, mockResponse as Response)
    ).resolves.toBe(true);
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Conflict' }));
  });
});