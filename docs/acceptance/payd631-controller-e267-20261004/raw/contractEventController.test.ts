import { Request, Response } from 'express';
import { ContractEventController } from '../contractEventController';
import { default as pool } from '../../config/database';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

describe('ContractEventController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      user: {
        id: 1,
        walletAddress: 'GTEST123',
        organizationId: 1,
        role: 'EMPLOYER',
      },
      params: {},
      query: {},
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock,
    };

    jest.clearAllMocks();
  });

  describe('getEventsByContract', () => {
    it('should return paginated events for a contract', async () => {
      mockRequest.params = { contractId: 'CTEST123' };
      mockRequest.query = { page: '1', limit: '20' };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              organizationId: 1,
              contractId: 'CTEST123',
              eventType: 'payment',
              payload: { amount: '100' },
              ledgerSequence: 100,
              transactionHash: 'hash123',
              eventIndex: 0,
              ledgerClosedAt: new Date(),
              indexedAt: new Date(),
            },
          ],
        });

      await ContractEventController.getEventsByContract(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.any(Array),
          pagination: expect.objectContaining({
            page: 1,
            limit: 20,
            total: 5,
            totalPages: 1,
          }),
        })
      );
    });

    it('should return 403 if user has no organization', async () => {
      mockRequest.user = { ...mockRequest.user!, organizationId: null };
      mockRequest.params = { contractId: 'CTEST123' };

      await ContractEventController.getEventsByContract(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'User is not associated with an organization',
      });
    });

    it('should apply filters correctly', async () => {
      mockRequest.params = { contractId: 'CTEST123' };
      mockRequest.query = {
        eventType: 'payment',
        fromLedger: '100',
        toLedger: '200',
        page: '2',
        limit: '10',
      };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ total: '15' }] })
        .mockResolvedValueOnce({ rows: [] });

      await ContractEventController.getEventsByContract(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('event_type'),
        expect.arrayContaining([1, 'CTEST123', 'payment', 100, 200])
      );
    });
  });

  describe('getAllEvents', () => {
    it('should return all events for organization', async () => {
      mockRequest.query = { page: '1', limit: '20' };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ total: '10' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              organizationId: 1,
              contractId: 'CTEST123',
              eventType: 'payment',
              payload: { amount: '100' },
              ledgerSequence: 100,
              transactionHash: 'hash123',
              eventIndex: 0,
              ledgerClosedAt: new Date(),
              indexedAt: new Date(),
            },
          ],
        });

      await ContractEventController.getAllEvents(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.any(Array),
          pagination: expect.any(Object),
        })
      );
    });

    it('should return 403 if user has no organization', async () => {
      mockRequest.user = { ...mockRequest.user!, organizationId: null };

      await ContractEventController.getAllEvents(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('getIndexerStatus', () => {
    it('should return indexer status', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            indexerName: 'contract_event_indexer',
            lastIndexedLedger: 12345,
            lastIndexedAt: new Date(),
            status: 'active',
            errorMessage: null,
            updatedAt: new Date(),
          },
        ],
      });

      await ContractEventController.getIndexerStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          indexerName: 'contract_event_indexer',
          lastIndexedLedger: 12345,
          status: 'active',
        })
      );
    });

    it('should return 404 if indexer state not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await ContractEventController.getIndexerStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Indexer state not found',
      });
    });

    it('should handle errors', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      await ContractEventController.getIndexerStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Internal server error',
      });
    });
  });
});
