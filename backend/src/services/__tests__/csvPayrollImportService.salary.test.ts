import { Keypair } from '@stellar/stellar-sdk';
import { csvPayrollImportService } from '../csvPayrollImportService.js';
import { pool } from '../../config/database.js';
import { employeeService } from '../employeeService.js';
import logger from '../../utils/logger.js';

jest.mock('../../config/database.js', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../employeeService.js', () => ({ employeeService: { create: jest.fn() } }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

// Exercise real CSV parsing, employee-schema validation, and Stellar key validation.
const wallet = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const header = 'first_name,last_name,email,wallet_address,base_salary';
const row = (email: string, salary: string) => `Ada,Lovelace,${email},${wallet},${quote(salary)}`;
const csvForSalary = (salary: string | undefined) =>
  salary === undefined
    ? `first_name,last_name,email,wallet_address\nAda,Lovelace,ada@example.com,${wallet}`
    : `${header}\n${row('ada@example.com', salary)}`;

describe('CSV salary values', () => {
  const client = { query: jest.fn(), release: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    (pool.connect as jest.Mock).mockResolvedValue(client);
    client.query.mockResolvedValue({ rows: [] });
    (employeeService.create as jest.Mock).mockResolvedValue({ id: 1 });
  });

  it.each([
    '0x10',
    '0XFF',
    '0b10',
    '0o17',
    '1000USD',
    '123abc',
    '1_000',
    '1,000',
    '1e',
    '1e+',
    '1e-',
    '1e309',
    'Infinity',
    'NaN',
    ' ',
    '\t',
    '1 2',
    '.',
    '++1',
    '1.2.3',
  ])('rejects the complete non-decimal or nonfinite salary %j before storage', async (salary) => {
    const result = await csvPayrollImportService.processCsv(7, csvForSalary(salary));

    expect(result).toMatchObject({ totalRows: 1, successCount: 0, errorCount: 1 });
    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 2,
        email: 'ada@example.com',
        errors: expect.arrayContaining(['Invalid salary format: must be a number']),
      }),
    ]);
    expect(employeeService.create).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  const validSalaries: Array<[string | undefined, number]> = [
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['0.25', 0.25],
    ['42', 42],
    ['0012.50', 12.5],
    ['12.', 12],
    ['+12.50', 12.5],
    ['.75', 0.75],
    ['+.75', 0.75],
    ['1e3', 1000],
    ['1E+3', 1000],
    ['2.5e-2', 0.025],
    [' 12.50 ', 12.5],
    ['\t1e3\t', 1000],
    ['1.e2', 100],
  ];

  it.each(validSalaries)('stores ordinary salary %j as %s', async (salary, expected) => {
    const result = await csvPayrollImportService.processCsv(7, csvForSalary(salary));

    expect(result).toEqual({ totalRows: 1, successCount: 1, errorCount: 0, errors: [] });
    expect(employeeService.create).toHaveBeenCalledTimes(1);
    expect(employeeService.create).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 7, base_salary: expected }),
      client
    );
    expect(client.query.mock.calls).toEqual([['BEGIN'], ['COMMIT']]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it.each(['-1', '-.5', '-1e3', '-1e-400'])(
    'retains the negative-salary error for %j',
    async (salary) => {
      const result = await csvPayrollImportService.processCsv(7, csvForSalary(salary));

      expect(result).toMatchObject({ totalRows: 1, successCount: 0, errorCount: 1 });
      expect(result.errors).toEqual([
        expect.objectContaining({
          row: 2,
          errors: expect.arrayContaining(['Salary cannot be negative']),
        }),
      ]);
      expect(employeeService.create).not.toHaveBeenCalled();
      expect(pool.connect).not.toHaveBeenCalled();
    }
  );

  it('retains row numbers and imports only valid rows in one transaction', async () => {
    const content = [
      header,
      row('first@example.com', '12.5'),
      row('bad@example.com', '1000USD'),
      row('third@example.com', '2e2'),
    ].join('\n');
    const result = await csvPayrollImportService.processCsv(7, content);

    expect(result).toMatchObject({ totalRows: 3, successCount: 2, errorCount: 1 });
    expect(result.errors).toEqual([expect.objectContaining({ row: 3, email: 'bad@example.com' })]);
    expect(employeeService.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ email: 'first@example.com', base_salary: 12.5 }),
      client
    );
    expect(employeeService.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ email: 'third@example.com', base_salary: 200 }),
      client
    );
    expect(employeeService.create).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls).toEqual([['BEGIN'], ['COMMIT']]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the client when storing a valid salary fails', async () => {
    (employeeService.create as jest.Mock).mockRejectedValueOnce(new Error('storage failed'));

    await expect(csvPayrollImportService.processCsv(7, csvForSalary('1e3'))).rejects.toThrow(
      'Database transaction failed during bulk import'
    );

    expect(client.query.mock.calls).toEqual([['BEGIN'], ['ROLLBACK']]);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Bulk import transaction failed', expect.any(Error));
  });
});
