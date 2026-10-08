import { ScheduleService } from '../scheduleService';
import type { ScheduleFrequency, CreateScheduleRequest } from '../../types/schedule';
import { Pool } from 'pg';

// Mock pg Pool
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn();

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
  },
}));

import pool from '../../config/database.js';

describe('ScheduleService', () => {
  let service: ScheduleService;
  const mockPool = pool as unknown as jest.Mocked<typeof pool>;

  beforeEach(() => {
    service = new ScheduleService();
    jest.clearAllMocks();
    
    // Setup default mock client
    (mockPool.connect as jest.Mock).mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  describe('calculateNextRun', () => {
    describe('once frequency', () => {
      it('should return startDate with specified time of day', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '14:30';
        const frequency: ScheduleFrequency = 'once';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(0); // January (0-indexed)
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(14);
        expect(result.getMinutes()).toBe(30);
        expect(result.getSeconds()).toBe(0);
        expect(result.getMilliseconds()).toBe(0);
      });

      it('should ignore lastRun parameter for once frequency', () => {
        const startDate = new Date('2024-01-15');
        const lastRun = new Date('2024-02-20');
        const timeOfDay = '09:00';
        const frequency: ScheduleFrequency = 'once';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate, lastRun);

        // Should use startDate, not lastRun
        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(0); // January
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(9);
        expect(result.getMinutes()).toBe(0);
      });
    });

    describe('weekly frequency', () => {
      it('should add 7 days to startDate when no lastRun provided', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '10:00';
        const frequency: ScheduleFrequency = 'weekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(0); // January
        expect(result.getDate()).toBe(22); // 15 + 7
        expect(result.getHours()).toBe(10);
        expect(result.getMinutes()).toBe(0);
      });

      it('should add 7 days to lastRun when provided', () => {
        const startDate = new Date('2024-01-15');
        const lastRun = new Date('2024-02-05');
        const timeOfDay = '15:45';
        const frequency: ScheduleFrequency = 'weekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate, lastRun);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February
        expect(result.getDate()).toBe(12); // 5 + 7
        expect(result.getHours()).toBe(15);
        expect(result.getMinutes()).toBe(45);
      });

      it('should handle month boundary correctly', () => {
        const startDate = new Date('2024-01-28');
        const timeOfDay = '12:00';
        const frequency: ScheduleFrequency = 'weekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February
        expect(result.getDate()).toBe(4); // 28 + 7 = Feb 4
      });
    });

    describe('biweekly frequency', () => {
      it('should add 14 days to startDate when no lastRun provided', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '08:30';
        const frequency: ScheduleFrequency = 'biweekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(0); // January
        expect(result.getDate()).toBe(29); // 15 + 14
        expect(result.getHours()).toBe(8);
        expect(result.getMinutes()).toBe(30);
      });

      it('should add 14 days to lastRun when provided', () => {
        const startDate = new Date('2024-01-15');
        const lastRun = new Date('2024-02-01');
        const timeOfDay = '16:00';
        const frequency: ScheduleFrequency = 'biweekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate, lastRun);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February
        expect(result.getDate()).toBe(15); // 1 + 14
        expect(result.getHours()).toBe(16);
        expect(result.getMinutes()).toBe(0);
      });
    });

    describe('monthly frequency', () => {
      it('should add 1 month to startDate when no lastRun provided', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '11:00';
        const frequency: ScheduleFrequency = 'monthly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(11);
        expect(result.getMinutes()).toBe(0);
      });

      it('should add 1 month to lastRun when provided', () => {
        const startDate = new Date('2024-01-15');
        const lastRun = new Date('2024-03-20');
        const timeOfDay = '13:15';
        const frequency: ScheduleFrequency = 'monthly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate, lastRun);

        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(3); // April
        expect(result.getDate()).toBe(20);
        expect(result.getHours()).toBe(13);
        expect(result.getMinutes()).toBe(15);
      });

      it('should handle year boundary correctly', () => {
        const startDate = new Date('2024-12-15');
        const timeOfDay = '09:00';
        const frequency: ScheduleFrequency = 'monthly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getFullYear()).toBe(2025);
        expect(result.getMonth()).toBe(0); // January
        expect(result.getDate()).toBe(15);
      });

      it('should handle month-end dates correctly', () => {
        const startDate = new Date('2024-01-31');
        const timeOfDay = '10:00';
        const frequency: ScheduleFrequency = 'monthly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        // JavaScript Date handles this - Feb 31 becomes Mar 2 or 3 depending on leap year
        // For 2024 (leap year), Jan 31 + 1 month = Feb 29 (last day of Feb)
        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February
        // Date will be adjusted by JavaScript Date object
      });
    });

    describe('edge cases', () => {
      it('should handle midnight time correctly', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '00:00';
        const frequency: ScheduleFrequency = 'weekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
      });

      it('should handle end of day time correctly', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '23:59';
        const frequency: ScheduleFrequency = 'weekly';

        const result = service.calculateNextRun(frequency, timeOfDay, startDate);

        expect(result.getHours()).toBe(23);
        expect(result.getMinutes()).toBe(59);
      });

      it('should throw error for unsupported frequency', () => {
        const startDate = new Date('2024-01-15');
        const timeOfDay = '10:00';
        const frequency = 'yearly' as ScheduleFrequency;

        expect(() => {
          service.calculateNextRun(frequency, timeOfDay, startDate);
        }).toThrow('Unsupported frequency: yearly');
      });
    });
  });

  describe('createSchedule', () => {
    const validScheduleData: CreateScheduleRequest = {
      frequency: 'weekly',
      timeOfDay: '14:30',
      startDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
      paymentConfig: {
        recipients: [
          {
            walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            amount: '100.00',
            assetCode: 'USDC',
          },
        ],
        memo: 'Test payment',
      },
    };

    it('should create a schedule successfully', async () => {
      const organizationId = 1;
      const userId = 1;

      // Mock successful database transaction
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          // INSERT
          rows: [
            {
              id: 1,
              organizationId,
              userId,
              frequency: validScheduleData.frequency,
              timeOfDay: validScheduleData.timeOfDay,
              startDate: validScheduleData.startDate,
              endDate: null,
              paymentConfig: validScheduleData.paymentConfig,
              nextRunTimestamp: new Date(),
              lastRunTimestamp: null,
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.createSchedule(organizationId, userId, validScheduleData);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.organizationId).toBe(organizationId);
      expect(result.userId).toBe(userId);
      expect(result.frequency).toBe(validScheduleData.frequency);
      expect(result.status).toBe('active');
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const organizationId = 1;
      const userId = 1;

      // Mock database error
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')); // INSERT fails

      await expect(
        service.createSchedule(organizationId, userId, validScheduleData),
      ).rejects.toThrow('Database error');

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });

    describe('validation', () => {
      it('should reject invalid frequency', async () => {
        const invalidData = {
          ...validScheduleData,
          frequency: 'invalid' as ScheduleFrequency,
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Invalid frequency');
      });

      it('should reject invalid time format', async () => {
        const invalidData = {
          ...validScheduleData,
          timeOfDay: '25:00', // Invalid hour
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Invalid time format');
      });

      it('should reject time with invalid format', async () => {
        const invalidData = {
          ...validScheduleData,
          timeOfDay: '14:30:00', // Should be HH:MM, not HH:MM:SS
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Invalid time format');
      });

      it('should reject start date in the past', async () => {
        const invalidData = {
          ...validScheduleData,
          startDate: '2020-01-01', // Past date
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Start date cannot be in the past');
      });

      it('should reject end date before start date', async () => {
        const tomorrow = new Date(Date.now() + 86400000);
        const today = new Date();
        
        const invalidData = {
          ...validScheduleData,
          startDate: tomorrow.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('End date must be after start date');
      });

      it('should reject empty recipients array', async () => {
        const invalidData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: [],
          },
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('At least one recipient is required');
      });

      it('should reject recipient with empty wallet address', async () => {
        const invalidData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: [
              {
                walletAddress: '',
                amount: '100.00',
                assetCode: 'USDC',
              },
            ],
          },
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Wallet address is required');
      });

      it('should reject recipient with zero amount', async () => {
        const invalidData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '0',
                assetCode: 'USDC',
              },
            ],
          },
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Amount must be greater than 0');
      });

      it('should reject recipient with negative amount', async () => {
        const invalidData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '-10.00',
                assetCode: 'USDC',
              },
            ],
          },
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Amount must be greater than 0');
      });

      it('should reject recipient with empty asset code', async () => {
        const invalidData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '100.00',
                assetCode: '',
              },
            ],
          },
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Asset code is required');
      });

      it('should reject memo longer than 28 characters', async () => {
        const invalidData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: validScheduleData.paymentConfig.recipients,
            memo: 'This memo is way too long and exceeds the limit',
          },
        };

        await expect(
          service.createSchedule(1, 1, invalidData),
        ).rejects.toThrow('Memo cannot exceed 28 characters');
      });

      it('should accept valid memo within 28 characters', async () => {
        const validData = {
          ...validScheduleData,
          paymentConfig: {
            recipients: validScheduleData.paymentConfig.recipients,
            memo: 'Valid memo',
          },
        };

        // Mock successful database transaction
        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({
            // INSERT
            rows: [
              {
                id: 1,
                organizationId: 1,
                userId: 1,
                frequency: validData.frequency,
                timeOfDay: validData.timeOfDay,
                startDate: validData.startDate,
                endDate: null,
                paymentConfig: validData.paymentConfig,
                nextRunTimestamp: new Date(),
                lastRunTimestamp: null,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await service.createSchedule(1, 1, validData);
        expect(result).toBeDefined();
      });
    });

    describe('next run timestamp calculation', () => {
      it('should calculate next run timestamp for once frequency', async () => {
        const tomorrow = new Date(Date.now() + 86400000);
        const scheduleData = {
          ...validScheduleData,
          frequency: 'once' as ScheduleFrequency,
          startDate: tomorrow.toISOString().split('T')[0],
          timeOfDay: '14:30',
        };

        // Mock successful database transaction
        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({
            // INSERT
            rows: [
              {
                id: 1,
                organizationId: 1,
                userId: 1,
                frequency: scheduleData.frequency,
                timeOfDay: scheduleData.timeOfDay,
                startDate: scheduleData.startDate,
                endDate: null,
                paymentConfig: scheduleData.paymentConfig,
                nextRunTimestamp: new Date(tomorrow.setHours(14, 30, 0, 0)),
                lastRunTimestamp: null,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await service.createSchedule(1, 1, scheduleData);

        expect(result.nextRunTimestamp).toBeDefined();
        expect(result.nextRunTimestamp.getHours()).toBe(14);
        expect(result.nextRunTimestamp.getMinutes()).toBe(30);
      });

      it('should calculate next run timestamp for weekly frequency', async () => {
        const tomorrow = new Date(Date.now() + 86400000);
        const scheduleData = {
          ...validScheduleData,
          frequency: 'weekly' as ScheduleFrequency,
          startDate: tomorrow.toISOString().split('T')[0],
          timeOfDay: '10:00',
        };

        const expectedNextRun = new Date(tomorrow);
        expectedNextRun.setDate(expectedNextRun.getDate() + 7);
        expectedNextRun.setHours(10, 0, 0, 0);

        // Mock successful database transaction
        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({
            // INSERT
            rows: [
              {
                id: 1,
                organizationId: 1,
                userId: 1,
                frequency: scheduleData.frequency,
                timeOfDay: scheduleData.timeOfDay,
                startDate: scheduleData.startDate,
                endDate: null,
                paymentConfig: scheduleData.paymentConfig,
                nextRunTimestamp: expectedNextRun,
                lastRunTimestamp: null,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await service.createSchedule(1, 1, scheduleData);

        expect(result.nextRunTimestamp).toBeDefined();
        expect(result.nextRunTimestamp.getHours()).toBe(10);
        expect(result.nextRunTimestamp.getMinutes()).toBe(0);
      });
    });
  });

  describe('getActiveSchedules', () => {
    const organizationId = 1;

    it('should return active schedules for organization', async () => {
      const mockSchedules = [
        {
          id: 1,
          organizationId,
          userId: 1,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-15'),
          endDate: null,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '100.00',
                assetCode: 'USDC',
              },
            ],
          },
          nextRunTimestamp: new Date('2024-01-22T14:30:00'),
          lastRunTimestamp: null,
          status: 'active',
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
        {
          id: 2,
          organizationId,
          userId: 1,
          frequency: 'monthly',
          timeOfDay: '10:00',
          startDate: new Date('2024-01-01'),
          endDate: null,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
                amount: '500.00',
                assetCode: 'USDC',
              },
            ],
          },
          nextRunTimestamp: new Date('2024-02-01T10:00:00'),
          lastRunTimestamp: new Date('2024-01-01T10:00:00'),
          status: 'active',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      mockClientQuery.mockResolvedValueOnce({ rows: mockSchedules });

      const result = await service.getActiveSchedules(organizationId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[0].frequency).toBe('weekly');
      expect(result[0].status).toBe('active');
      expect(result[1].id).toBe(2);
      expect(result[1].frequency).toBe('monthly');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should filter by status when provided', async () => {
      const mockSchedules = [
        {
          id: 3,
          organizationId,
          userId: 1,
          frequency: 'once',
          timeOfDay: '15:00',
          startDate: new Date('2024-01-10'),
          endDate: null,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '200.00',
                assetCode: 'USDC',
              },
            ],
          },
          nextRunTimestamp: new Date('2024-01-10T15:00:00'),
          lastRunTimestamp: new Date('2024-01-10T15:00:00'),
          status: 'completed',
          createdAt: new Date('2024-01-05'),
          updatedAt: new Date('2024-01-10'),
        },
      ];

      mockClientQuery.mockResolvedValueOnce({ rows: mockSchedules });

      const result = await service.getActiveSchedules(organizationId, { status: 'completed' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('completed');
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([organizationId, 'completed', 50, 0]),
      );
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should support pagination', async () => {
      const mockSchedules = [
        {
          id: 4,
          organizationId,
          userId: 1,
          frequency: 'weekly',
          timeOfDay: '09:00',
          startDate: new Date('2024-01-15'),
          endDate: null,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '150.00',
                assetCode: 'USDC',
              },
            ],
          },
          nextRunTimestamp: new Date('2024-01-22T09:00:00'),
          lastRunTimestamp: null,
          status: 'active',
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      ];

      mockClientQuery.mockResolvedValueOnce({ rows: mockSchedules });

      const result = await service.getActiveSchedules(organizationId, {
        page: 2,
        limit: 10,
      });

      expect(result).toHaveLength(1);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([organizationId, 'active', 10, 10]), // offset = (2-1) * 10 = 10
      );
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should use default values when no filters provided', async () => {
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      await service.getActiveSchedules(organizationId);

      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([organizationId, 'active', 50, 0]), // defaults: status='active', limit=50, offset=0
      );
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should return empty array when no schedules found', async () => {
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.getActiveSchedules(organizationId);

      expect(result).toEqual([]);
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should parse dates correctly from database', async () => {
      const mockSchedules = [
        {
          id: 5,
          organizationId,
          userId: 1,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: '2024-01-15',
          endDate: '2024-12-31',
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '100.00',
                assetCode: 'USDC',
              },
            ],
          },
          nextRunTimestamp: '2024-01-22T14:30:00',
          lastRunTimestamp: '2024-01-15T14:30:00',
          status: 'active',
          createdAt: '2024-01-10T10:00:00',
          updatedAt: '2024-01-10T10:00:00',
        },
      ];

      mockClientQuery.mockResolvedValueOnce({ rows: mockSchedules });

      const result = await service.getActiveSchedules(organizationId);

      expect(result).toHaveLength(1);
      expect(result[0].startDate).toBeInstanceOf(Date);
      expect(result[0].endDate).toBeInstanceOf(Date);
      expect(result[0].nextRunTimestamp).toBeInstanceOf(Date);
      expect(result[0].lastRunTimestamp).toBeInstanceOf(Date);
      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].updatedAt).toBeInstanceOf(Date);
    });

    it('should handle null endDate and lastRunTimestamp', async () => {
      const mockSchedules = [
        {
          id: 6,
          organizationId,
          userId: 1,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: '2024-01-15',
          endDate: null,
          paymentConfig: {
            recipients: [
              {
                walletAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                amount: '100.00',
                assetCode: 'USDC',
              },
            ],
          },
          nextRunTimestamp: '2024-01-22T14:30:00',
          lastRunTimestamp: null,
          status: 'active',
          createdAt: '2024-01-10T10:00:00',
          updatedAt: '2024-01-10T10:00:00',
        },
      ];

      mockClientQuery.mockResolvedValueOnce({ rows: mockSchedules });

      const result = await service.getActiveSchedules(organizationId);

      expect(result).toHaveLength(1);
      expect(result[0].endDate).toBeUndefined();
      expect(result[0].lastRunTimestamp).toBeUndefined();
    });

    it('should release client even on error', async () => {
      mockClientQuery.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.getActiveSchedules(organizationId)).rejects.toThrow('Database error');

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should order schedules by next_run_timestamp ascending', async () => {
      const mockSchedules = [
        {
          id: 1,
          organizationId,
          userId: 1,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-15'),
          endDate: null,
          paymentConfig: { recipients: [] },
          nextRunTimestamp: new Date('2024-01-22T14:30:00'),
          lastRunTimestamp: null,
          status: 'active',
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
        {
          id: 2,
          organizationId,
          userId: 1,
          frequency: 'monthly',
          timeOfDay: '10:00',
          startDate: new Date('2024-01-01'),
          endDate: null,
          paymentConfig: { recipients: [] },
          nextRunTimestamp: new Date('2024-02-01T10:00:00'),
          lastRunTimestamp: null,
          status: 'active',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      mockClientQuery.mockResolvedValueOnce({ rows: mockSchedules });

      const result = await service.getActiveSchedules(organizationId);

      // Verify the query includes ORDER BY next_run_timestamp ASC
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY next_run_timestamp ASC'),
        expect.any(Array),
      );
      expect(result[0].nextRunTimestamp.getTime()).toBeLessThan(
        result[1].nextRunTimestamp.getTime(),
      );
    });
  });

  describe('cancelSchedule', () => {
    const organizationId = 1;
    const scheduleId = 1;

    it('should cancel a schedule successfully', async () => {
      const mockSchedule = {
        id: scheduleId,
        organizationId,
        status: 'active',
      };

      mockClientQuery
        .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      await service.cancelSchedule(scheduleId, organizationId);

      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, organization_id'),
        [scheduleId],
      );
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'cancelled'"),
        [scheduleId],
      );
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should throw 404 error when schedule not found', async () => {
      mockClientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT returns empty

      await expect(
        service.cancelSchedule(scheduleId, organizationId),
      ).rejects.toMatchObject({
        message: 'Schedule not found',
        statusCode: 404,
      });

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should throw 403 error when schedule belongs to different organization', async () => {
      const mockSchedule = {
        id: scheduleId,
        organizationId: 999, // Different organization
        status: 'active',
      };

      mockClientQuery.mockResolvedValueOnce({ rows: [mockSchedule] }); // SELECT

      await expect(
        service.cancelSchedule(scheduleId, organizationId),
      ).rejects.toMatchObject({
        message: 'Access denied: Schedule belongs to a different organization',
        statusCode: 403,
      });

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should release client even on error', async () => {
      mockClientQuery.mockRejectedValueOnce(new Error('Database error'));

      await expect(
        service.cancelSchedule(scheduleId, organizationId),
      ).rejects.toThrow('Database error');

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should update the updated_at timestamp', async () => {
      const mockSchedule = {
        id: scheduleId,
        organizationId,
        status: 'active',
      };

      mockClientQuery
        .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      await service.cancelSchedule(scheduleId, organizationId);

      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('updated_at = CURRENT_TIMESTAMP'),
        [scheduleId],
      );
    });
  });

  describe('updateAfterExecution', () => {
    const scheduleId = 1;
    it('refuses to commit the result after claim ownership has moved', async () => {
      const owner = 'pod-a:old-generation';
      const row = {
        id: scheduleId, frequency: 'once', timeOfDay: '14:30',
        startDate: new Date('2024-01-15'), timezone: 'UTC',
        lastRunTimestamp: null,
      };
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [row] }) // SELECT existing owner
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // stolen claim
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      await expect(service.updateAfterExecution(
        scheduleId, { success: true, transactionHash: 'hash' }, owner
      )).rejects.toThrow('Schedule claim lost before finalizing execution');
      const select = mockClientQuery.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('SELECT') && sql.includes('FROM schedules')
      );
      const update = mockClientQuery.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('UPDATE schedules')
      );
      expect(select?.[0]).toContain('AND locked_by = $2');
      expect(select?.[1]).toEqual([scheduleId, owner]);
      expect(update?.[0]).toContain('AND locked_by = $5');
      expect(update?.[1][4]).toBe(owner);
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientQuery).not.toHaveBeenCalledWith('COMMIT');
    });



    describe('successful execution', () => {
      it('should mark one-time schedule as completed after successful execution', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'once',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-15'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: true,
          transactionHash: 'abc123',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        // Verify UPDATE query was called with correct parameters
        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE schedules'),
          expect.arrayContaining([
            expect.any(Date), // last_run_timestamp
            'completed', // status
            null, // next_run_timestamp (null for completed)
            scheduleId,
          ]),
        );
        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should update recurring weekly schedule with new next_run_timestamp', async () => {
        const lastRun = new Date('2024-01-15T14:30:00');
        const mockSchedule = {
          id: scheduleId,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-08'),
          lastRunTimestamp: lastRun,
        };

        const executionResult = {
          success: true,
          transactionHash: 'def456',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        // Verify UPDATE query was called with correct parameters
        const updateCall = mockClientQuery.mock.calls.find(
          (call) => call[0].includes('UPDATE schedules'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall[1][0]).toBeInstanceOf(Date); // last_run_timestamp
        expect(updateCall[1][1]).toBe('active'); // status remains active
        expect(updateCall[1][2]).toBeInstanceOf(Date); // next_run_timestamp calculated
        expect(updateCall[1][3]).toBe(scheduleId);

        // Verify next_run_timestamp is 7 days after execution time
        const nextRun = updateCall[1][2] as Date;
        const executionTime = updateCall[1][0] as Date;
        const daysDiff = Math.round(
          (nextRun.getTime() - executionTime.getTime()) / (1000 * 60 * 60 * 24),
        );
        expect(daysDiff).toBe(7);

        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should update recurring biweekly schedule with new next_run_timestamp', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'biweekly',
          timeOfDay: '10:00',
          startDate: new Date('2024-01-01'),
          lastRunTimestamp: new Date('2024-01-15T10:00:00'),
        };

        const executionResult = {
          success: true,
          transactionHash: 'ghi789',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        const updateCall = mockClientQuery.mock.calls.find(
          (call) => call[0].includes('UPDATE schedules'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall[1][1]).toBe('active'); // status remains active
        expect(updateCall[1][2]).toBeInstanceOf(Date); // next_run_timestamp calculated

        // Verify next_run_timestamp is 14 days after execution time
        const nextRun = updateCall[1][2] as Date;
        const executionTime = updateCall[1][0] as Date;
        const daysDiff = Math.round(
          (nextRun.getTime() - executionTime.getTime()) / (1000 * 60 * 60 * 24),
        );
        expect(daysDiff).toBe(14);

        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should update recurring monthly schedule with new next_run_timestamp', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'monthly',
          timeOfDay: '09:00',
          startDate: new Date('2024-01-15'),
          lastRunTimestamp: new Date('2024-01-15T09:00:00'),
        };

        const executionResult = {
          success: true,
          transactionHash: 'jkl012',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        const updateCall = mockClientQuery.mock.calls.find(
          (call) => call[0].includes('UPDATE schedules'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall[1][1]).toBe('active'); // status remains active
        expect(updateCall[1][2]).toBeInstanceOf(Date); // next_run_timestamp calculated

        // Verify next_run_timestamp is approximately 1 month after execution time
        const nextRun = updateCall[1][2] as Date;
        const executionTime = updateCall[1][0] as Date;
        expect(nextRun.getMonth()).toBe((executionTime.getMonth() + 1) % 12);

        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should update last_run_timestamp to execution time', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-08'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: true,
          transactionHash: 'mno345',
        };

        const beforeExecution = Date.now();
        
        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        const afterExecution = Date.now();

        const updateCall = mockClientQuery.mock.calls.find(
          (call) => call[0].includes('UPDATE schedules'),
        );
        const lastRunTimestamp = updateCall[1][0] as Date;

        // Verify last_run_timestamp is set to current time (within test execution window)
        expect(lastRunTimestamp.getTime()).toBeGreaterThanOrEqual(beforeExecution);
        expect(lastRunTimestamp.getTime()).toBeLessThanOrEqual(afterExecution);
      });
    });

    describe('failed execution', () => {
      it('should mark schedule as failed when execution fails', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-08'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: false,
          error: {
            message: 'Transaction failed',
            details: { code: 'tx_failed' },
          },
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        // Verify UPDATE query was called with status 'failed'
        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE schedules'),
          expect.arrayContaining([
            expect.any(Date), // last_run_timestamp
            'failed', // status
            null, // next_run_timestamp not calculated for failed
            scheduleId,
          ]),
        );
        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should mark one-time schedule as failed when execution fails', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'once',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-15'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: false,
          error: {
            message: 'Insufficient funds',
          },
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        // Verify status is 'failed', not 'completed'
        const updateCall = mockClientQuery.mock.calls.find(
          (call) => call[0].includes('UPDATE schedules'),
        );
        expect(updateCall[1][1]).toBe('failed');
        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      });

      it('should still update last_run_timestamp for failed execution', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-08'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: false,
          error: {
            message: 'Network error',
          },
        };

        const beforeExecution = Date.now();

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        const afterExecution = Date.now();

        const updateCall = mockClientQuery.mock.calls.find(
          (call) => call[0].includes('UPDATE schedules'),
        );
        const lastRunTimestamp = updateCall[1][0] as Date;

        // Verify last_run_timestamp is set even for failed execution
        expect(lastRunTimestamp.getTime()).toBeGreaterThanOrEqual(beforeExecution);
        expect(lastRunTimestamp.getTime()).toBeLessThanOrEqual(afterExecution);
      });
    });

    describe('error handling', () => {
      it('should throw error when schedule not found', async () => {
        const executionResult = {
          success: true,
          transactionHash: 'pqr678',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }); // SELECT returns empty

        await expect(
          service.updateAfterExecution(scheduleId, executionResult),
        ).rejects.toThrow(`Schedule with ID ${scheduleId} not found`);

        expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should rollback transaction on database error', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'weekly',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-08'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: true,
          transactionHash: 'stu901',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockRejectedValueOnce(new Error('Database error')); // UPDATE fails

        await expect(
          service.updateAfterExecution(scheduleId, executionResult),
        ).rejects.toThrow('Database error');

        expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should release client even on error', async () => {
        const executionResult = {
          success: true,
          transactionHash: 'vwx234',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockRejectedValueOnce(new Error('Connection error')); // SELECT fails

        await expect(
          service.updateAfterExecution(scheduleId, executionResult),
        ).rejects.toThrow('Connection error');

        expect(mockRelease).toHaveBeenCalled();
      });
    });

    describe('transaction handling', () => {
      it('should use database transaction for atomic updates', async () => {
        const mockSchedule = {
          id: scheduleId,
          frequency: 'once',
          timeOfDay: '14:30',
          startDate: new Date('2024-01-15'),
          lastRunTimestamp: null,
        };

        const executionResult = {
          success: true,
          transactionHash: 'yz0123',
        };

        mockClientQuery
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockSchedule] }) // SELECT
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        await service.updateAfterExecution(scheduleId, executionResult);

        expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
        expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
        expect(mockClientQuery).not.toHaveBeenCalledWith('ROLLBACK');
      });
    });
  });
});
