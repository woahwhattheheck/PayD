/**
 * @file src/db/__tests__/migration-verification.test.ts
 * @description Tests to verify migration files are correctly structured
 * 
 * These tests validate the migration SQL files without requiring a live database.
 * They check for:
 * - Correct SQL syntax structure
 * - Required tables and columns
 * - Constraints and indexes
 * - Foreign key relationships
 */

import { describe, test, beforeAll } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

describe('Migration Files - Structure Verification', () => {
  describe('021_create_schedules.sql', () => {
    let migrationContent: string;

    beforeAll(() => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      migrationContent = fs.readFileSync(migrationPath, 'utf8');
    });

    test('should create schedules table', () => {
      expect(migrationContent).toContain('CREATE TABLE');
      expect(migrationContent).toContain('schedules');
    });

    test('should have all required columns', () => {
      const requiredColumns = [
        'id',
        'organization_id',
        'user_id',
        'frequency',
        'time_of_day',
        'start_date',
        'end_date',
        'payment_config',
        'next_run_timestamp',
        'last_run_timestamp',
        'status',
        'created_at',
        'updated_at',
      ];

      requiredColumns.forEach((column) => {
        expect(migrationContent).toContain(column);
      });
    });

    test('should have primary key on id', () => {
      expect(migrationContent).toMatch(/id\s+SERIAL\s+PRIMARY KEY/i);
    });

    test('should have foreign key to organizations', () => {
      expect(migrationContent).toContain('REFERENCES organizations(id)');
      expect(migrationContent).toContain('ON DELETE CASCADE');
    });

    test('should have CHECK constraint for frequency', () => {
      expect(migrationContent).toContain("CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly'))");
    });

    test('should have CHECK constraint for status', () => {
      expect(migrationContent).toContain("CHECK (status IN ('active', 'completed', 'cancelled', 'failed'))");
    });

    test('should have correct data types', () => {
      expect(migrationContent).toMatch(/frequency\s+VARCHAR\(20\)/i);
      expect(migrationContent).toMatch(/time_of_day\s+TIME/i);
      expect(migrationContent).toMatch(/start_date\s+DATE/i);
      expect(migrationContent).toMatch(/payment_config\s+JSONB/i);
      expect(migrationContent).toMatch(/next_run_timestamp\s+TIMESTAMP/i);
      expect(migrationContent).toMatch(/status\s+VARCHAR\(20\)/i);
    });

    test('should have required indexes', () => {
      expect(migrationContent).toContain('CREATE INDEX idx_schedules_next_run');
      expect(migrationContent).toContain('CREATE INDEX idx_schedules_org_id');
      expect(migrationContent).toContain('CREATE INDEX idx_schedules_status');
    });

    test('should have composite index on next_run_timestamp and status', () => {
      expect(migrationContent).toContain('idx_schedules_next_run ON schedules(next_run_timestamp, status)');
    });

    test('should have default value for status', () => {
      expect(migrationContent).toMatch(/status.*DEFAULT\s+'active'/i);
    });

    test('should have default timestamps', () => {
      expect(migrationContent).toMatch(/created_at.*DEFAULT\s+CURRENT_TIMESTAMP/i);
      expect(migrationContent).toMatch(/updated_at.*DEFAULT\s+CURRENT_TIMESTAMP/i);
    });

    test('should have updated_at trigger', () => {
      expect(migrationContent).toContain('CREATE TRIGGER update_schedules_updated_at');
      expect(migrationContent).toContain('BEFORE UPDATE ON schedules');
      expect(migrationContent).toContain('update_updated_at_column()');
    });

    test('should use IF NOT EXISTS for idempotency', () => {
      expect(migrationContent).toContain('IF NOT EXISTS');
    });
  });

  describe('023_create_execution_history.sql', () => {
    let migrationContent: string;

    beforeAll(() => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      migrationContent = fs.readFileSync(migrationPath, 'utf8');
    });

    test('should create execution_history table', () => {
      expect(migrationContent).toContain('CREATE TABLE');
      expect(migrationContent).toContain('execution_history');
    });

    test('should have all required columns', () => {
      const requiredColumns = [
        'id',
        'schedule_id',
        'executed_at',
        'status',
        'transaction_hash',
        'transaction_result',
        'error_message',
        'error_details',
        'created_at',
      ];

      requiredColumns.forEach((column) => {
        expect(migrationContent).toContain(column);
      });
    });

    test('should have primary key on id', () => {
      expect(migrationContent).toMatch(/id\s+SERIAL\s+PRIMARY KEY/i);
    });

    test('should have foreign key to schedules', () => {
      expect(migrationContent).toContain('REFERENCES schedules(id)');
      expect(migrationContent).toContain('ON DELETE CASCADE');
    });

    test('should have CHECK constraint for status', () => {
      expect(migrationContent).toContain("CHECK (status IN ('success', 'failed', 'partial'))");
    });

    test('should have correct data types', () => {
      expect(migrationContent).toMatch(/executed_at\s+TIMESTAMP/i);
      expect(migrationContent).toMatch(/status\s+VARCHAR\(20\)/i);
      expect(migrationContent).toMatch(/transaction_hash\s+VARCHAR\(64\)/i);
      expect(migrationContent).toMatch(/transaction_result\s+JSONB/i);
      expect(migrationContent).toMatch(/error_message\s+TEXT/i);
      expect(migrationContent).toMatch(/error_details\s+JSONB/i);
    });

    test('should have required indexes', () => {
      expect(migrationContent).toContain('CREATE INDEX idx_execution_schedule_id');
      expect(migrationContent).toContain('CREATE INDEX idx_execution_status');
      expect(migrationContent).toContain('CREATE INDEX idx_execution_executed_at');
    });

    test('should have index on schedule_id for foreign key lookups', () => {
      expect(migrationContent).toContain('idx_execution_schedule_id ON execution_history(schedule_id)');
    });

    test('should have default timestamp for executed_at', () => {
      expect(migrationContent).toMatch(/executed_at.*DEFAULT\s+CURRENT_TIMESTAMP/i);
    });

    test('should have default timestamp for created_at', () => {
      expect(migrationContent).toMatch(/created_at.*DEFAULT\s+CURRENT_TIMESTAMP/i);
    });

    test('should use IF NOT EXISTS for idempotency', () => {
      expect(migrationContent).toContain('IF NOT EXISTS');
    });
  });

  describe('Migration File Ordering', () => {
    test('schedules migration should come before execution_history', () => {
      const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
      
      const schedulesIndex = files.findIndex((f) => f.includes('schedules'));
      const executionHistoryIndex = files.findIndex((f) => f.includes('execution_history'));

      expect(schedulesIndex).toBeGreaterThan(-1);
      expect(executionHistoryIndex).toBeGreaterThan(-1);
      expect(schedulesIndex).toBeLessThan(executionHistoryIndex);
    });

    test('migration files should have numeric prefixes', () => {
      const schedulesFile = '021_create_schedules.sql';
      const executionHistoryFile = '023_create_execution_history.sql';

      expect(fs.existsSync(path.join(MIGRATIONS_DIR, schedulesFile))).toBe(true);
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, executionHistoryFile))).toBe(true);
    });
  });

  describe('SQL Syntax Validation', () => {
    test('021_create_schedules.sql should have valid SQL syntax', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      // Check for common SQL syntax errors
      expect(content).not.toContain(';;'); // Double semicolons
      expect(content.split('CREATE TABLE').length - 1).toBe(1); // Only one CREATE TABLE
      
      // Check parentheses are balanced
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      expect(openParens).toBe(closeParens);
    });

    test('023_create_execution_history.sql should have valid SQL syntax', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      // Check for common SQL syntax errors
      expect(content).not.toContain(';;'); // Double semicolons
      expect(content.split('CREATE TABLE').length - 1).toBe(1); // Only one CREATE TABLE
      
      // Check parentheses are balanced
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      expect(openParens).toBe(closeParens);
    });
  });

  describe('Schema Design Validation', () => {
    test('schedules table should support all frequency types', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      const frequencies = ['once', 'weekly', 'biweekly', 'monthly'];
      frequencies.forEach((freq) => {
        expect(content).toContain(freq);
      });
    });

    test('schedules table should support all status types', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      const statuses = ['active', 'completed', 'cancelled', 'failed'];
      statuses.forEach((status) => {
        expect(content).toContain(status);
      });
    });

    test('execution_history should support all execution status types', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      const statuses = ['success', 'failed', 'partial'];
      statuses.forEach((status) => {
        expect(content).toContain(status);
      });
    });

    test('payment_config should use JSONB for flexibility', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      expect(content).toMatch(/payment_config\s+JSONB\s+NOT NULL/i);
    });

    test('error tracking should use JSONB for structured data', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      expect(content).toMatch(/error_details\s+JSONB/i);
      expect(content).toMatch(/transaction_result\s+JSONB/i);
    });
  });

  describe('Performance Optimization', () => {
    test('schedules should have index on next_run_timestamp for cron queries', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      // The cron job queries by next_run_timestamp and status
      expect(content).toContain('idx_schedules_next_run');
      expect(content).toContain('next_run_timestamp, status');
    });

    test('schedules should have index on organization_id for tenant isolation', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      expect(content).toContain('idx_schedules_org_id');
      expect(content).toContain('organization_id');
    });

    test('execution_history should have index on schedule_id for lookups', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      expect(content).toContain('idx_execution_schedule_id');
      expect(content).toContain('schedule_id');
    });

    test('execution_history should have index on executed_at for time-based queries', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      expect(content).toContain('idx_execution_executed_at');
      expect(content).toContain('executed_at');
    });
  });

  describe('Data Integrity', () => {
    test('schedules should have NOT NULL constraints on required fields', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      const requiredFields = [
        'organization_id',
        'user_id',
        'frequency',
        'time_of_day',
        'start_date',
        'payment_config',
        'next_run_timestamp',
      ];

      requiredFields.forEach((field) => {
        const regex = new RegExp(`${field}.*NOT NULL`, 'i');
        expect(content).toMatch(regex);
      });
    });

    test('execution_history should have NOT NULL constraints on required fields', () => {
      const migrationPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');
      const content = fs.readFileSync(migrationPath, 'utf8');

      const requiredFields = ['schedule_id', 'status'];

      requiredFields.forEach((field) => {
        const regex = new RegExp(`${field}.*NOT NULL`, 'i');
        expect(content).toMatch(regex);
      });
    });

    test('foreign keys should have CASCADE delete for referential integrity', () => {
      const schedulesPath = path.join(MIGRATIONS_DIR, '021_create_schedules.sql');
      const executionHistoryPath = path.join(MIGRATIONS_DIR, '023_create_execution_history.sql');

      const schedulesContent = fs.readFileSync(schedulesPath, 'utf8');
      const executionHistoryContent = fs.readFileSync(executionHistoryPath, 'utf8');

      // schedules -> organizations should CASCADE
      expect(schedulesContent).toContain('ON DELETE CASCADE');

      // execution_history -> schedules should CASCADE
      expect(executionHistoryContent).toContain('ON DELETE CASCADE');
    });
  });
});

describe('Migration System Integration', () => {
  test('migration files should be readable by migrate.ts', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('021_create_schedules.sql');
    expect(files).toContain('023_create_execution_history.sql');
  });

  test('migration files should be sorted lexicographically', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    const sorted = [...files].sort();
    
    expect(files).toEqual(sorted);
  });

  test('migration files should have consistent naming pattern', () => {
    const pattern = /^\d{3}_[a-z_]+\.sql$/;
    
    expect('021_create_schedules.sql').toMatch(pattern);
    expect('023_create_execution_history.sql').toMatch(pattern);
  });
});
