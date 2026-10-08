# Migration Verification Guide - Task 1.3

This document provides instructions for completing task 1.3: "Run migrations and verify schema" for the payroll-scheduler-backend-wiring feature.

## Overview

Task 1.3 requires:

1. Execute migrations 014 and 015 against the development database
2. Verify tables exist with correct structure
3. Test foreign key constraints work correctly

## Prerequisites

Before running migrations, ensure you have:

1. **PostgreSQL Database Running**
   - PostgreSQL 12+ installed and running
   - Database created (default: `payd_db`)
   - User with appropriate permissions (default: `payd_user`)

2. **Environment Configuration**
   - `.env` file created in `backend/` directory
   - `DATABASE_URL` set correctly

## Setup Instructions

### Option 1: Using Docker Compose (Recommended)

```bash
cd backend
docker-compose up -d postgres
```

This will start PostgreSQL with the following default credentials:

- Host: localhost
- Port: 5432
- Database: payd_db
- User: payd_user
- Password: payd_password

### Option 2: Local PostgreSQL Installation

1. Install PostgreSQL:

```bash
# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# macOS
brew install postgresql
```

2. Create database and user:

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE payd_db;
CREATE USER payd_user WITH PASSWORD 'payd_password';
GRANT ALL PRIVILEGES ON DATABASE payd_db TO payd_user;
\q
```

### Option 3: Using Existing PostgreSQL Instance

Update the `.env` file with your database connection details:

```env
DATABASE_URL=postgresql://your_user:your_password@your_host:5432/your_database
```

## Running Migrations

Once the database is set up and the `.env` file is configured:

```bash
cd backend
npm run db:migrate
```

Expected output:

```
[migrate] Starting migration runner
[migrate] Target database: postgresql://payd_user:***@localhost:5432/payd_db
[migrate] ✓ schema_migrations table ready
[migrate] Found X migration file(s) in /path/to/migrations
[migrate] ✓ Applied   021_create_schedules.sql  (XX ms)
[migrate] ✓ Applied   023_create_execution_history.sql  (XX ms)
─────────────────────────────────────────
[migrate] Summary  (XXX ms total)
  Applied : 2
  Skipped : X
  Drift   : 0
─────────────────────────────────────────
[migrate] Done.
```

## Verifying Schema

After migrations complete, run the verification script:

```bash
cd backend
npm run db:verify-schedules
```

This script will verify:

### 1. Table Existence

- ✓ `schedules` table exists
- ✓ `execution_history` table exists

### 2. schedules Table Structure

- ✓ All columns present with correct types:
  - `id` (integer, NOT NULL, PRIMARY KEY)
  - `organization_id` (integer, NOT NULL, FOREIGN KEY)
  - `user_id` (integer, NOT NULL)
  - `frequency` (varchar(20), NOT NULL)
  - `time_of_day` (time, NOT NULL)
  - `start_date` (date, NOT NULL)
  - `end_date` (date, nullable)
  - `payment_config` (jsonb, NOT NULL)
  - `next_run_timestamp` (timestamp, NOT NULL)
  - `last_run_timestamp` (timestamp, nullable)
  - `status` (varchar(20), nullable, default 'active')
  - `created_at` (timestamp, default CURRENT_TIMESTAMP)
  - `updated_at` (timestamp, default CURRENT_TIMESTAMP)

### 3. execution_history Table Structure

- ✓ All columns present with correct types:
  - `id` (integer, NOT NULL, PRIMARY KEY)
  - `schedule_id` (integer, NOT NULL, FOREIGN KEY)
  - `executed_at` (timestamp, default CURRENT_TIMESTAMP)
  - `status` (varchar(20), NOT NULL)
  - `transaction_hash` (varchar(64), nullable)
  - `transaction_result` (jsonb, nullable)
  - `error_message` (text, nullable)
  - `error_details` (jsonb, nullable)
  - `created_at` (timestamp, default CURRENT_TIMESTAMP)

### 4. CHECK Constraints

- ✓ `schedules.frequency` IN ('once', 'weekly', 'biweekly', 'monthly')
- ✓ `schedules.status` IN ('active', 'completed', 'cancelled', 'failed')
- ✓ `execution_history.status` IN ('success', 'failed', 'partial')

### 5. Foreign Key Constraints

- ✓ `schedules.organization_id` → `organizations.id` (ON DELETE CASCADE)
- ✓ `execution_history.schedule_id` → `schedules.id` (ON DELETE CASCADE)

### 6. Indexes

- ✓ `idx_schedules_next_run` on (next_run_timestamp, status)
- ✓ `idx_schedules_org_id` on (organization_id)
- ✓ `idx_schedules_status` on (status)
- ✓ `idx_execution_schedule_id` on (schedule_id)
- ✓ `idx_execution_status` on (status)
- ✓ `idx_execution_executed_at` on (executed_at)

### 7. Foreign Key Functionality

- ✓ Cannot insert schedule with invalid organization_id
- ✓ Cannot insert execution_history with invalid schedule_id
- ✓ CASCADE delete works correctly

## Expected Verification Output

```
[verify] Starting schema verification for schedules and execution_history tables

─── Check 1: Table Existence ───
✓ schedules table exists
✓ execution_history table exists

─── Check 2: schedules Table Columns ───
✓ Column 'id' is correct (integer, nullable: NO)
✓ Column 'organization_id' is correct (integer, nullable: NO)
✓ Column 'user_id' is correct (integer, nullable: NO)
✓ Column 'frequency' is correct (character varying, nullable: NO)
✓ Column 'time_of_day' is correct (time without time zone, nullable: NO)
✓ Column 'start_date' is correct (date, nullable: NO)
✓ Column 'end_date' is correct (date, nullable: YES)
✓ Column 'payment_config' is correct (jsonb, nullable: NO)
✓ Column 'next_run_timestamp' is correct (timestamp without time zone, nullable: NO)
✓ Column 'last_run_timestamp' is correct (timestamp without time zone, nullable: YES)
✓ Column 'status' is correct (character varying, nullable: YES)
✓ Column 'created_at' is correct (timestamp without time zone, nullable: YES)
✓ Column 'updated_at' is correct (timestamp without time zone, nullable: YES)

─── Check 3: execution_history Table Columns ───
✓ Column 'id' is correct (integer, nullable: NO)
✓ Column 'schedule_id' is correct (integer, nullable: NO)
✓ Column 'executed_at' is correct (timestamp without time zone, nullable: YES)
✓ Column 'status' is correct (character varying, nullable: NO)
✓ Column 'transaction_hash' is correct (character varying, nullable: YES)
✓ Column 'transaction_result' is correct (jsonb, nullable: YES)
✓ Column 'error_message' is correct (text, nullable: YES)
✓ Column 'error_details' is correct (jsonb, nullable: YES)
✓ Column 'created_at' is correct (timestamp without time zone, nullable: YES)

─── Check 4: CHECK Constraints ───
✓ CHECK constraint 'schedules_frequency_check' is correct
✓ CHECK constraint 'schedules_status_check' is correct
✓ CHECK constraint 'execution_history_status_check' is correct

─── Check 5: Foreign Key Constraints ───
✓ Foreign key schedules.organization_id -> organizations.id exists
✓ Foreign key execution_history.schedule_id -> schedules.id exists

─── Check 6: Indexes ───
✓ Index 'idx_schedules_next_run' exists with correct definition
✓ Index 'idx_schedules_org_id' exists with correct definition
✓ Index 'idx_schedules_status' exists with correct definition
✓ Index 'idx_execution_schedule_id' exists with correct definition
✓ Index 'idx_execution_status' exists with correct definition
✓ Index 'idx_execution_executed_at' exists with correct definition

─── Check 7: Foreign Key Constraint Functionality ───
✓ organizations table exists (required for foreign key)
✓ Foreign key constraint schedules.organization_id -> organizations.id is enforced
✓ Foreign key constraint execution_history.schedule_id -> schedules.id is enforced

─────────────────────────────────────────
[verify] ✓ All schema verification checks PASSED
[verify] Migrations 014 and 015 have been applied correctly
```

## Troubleshooting

### Database Connection Issues

**Error**: `DATABASE_URL environment variable is not set`

- **Solution**: Ensure `.env` file exists in `backend/` directory with `DATABASE_URL` set

**Error**: `Connection refused`

- **Solution**: Ensure PostgreSQL is running:
  ```bash
  # Check if PostgreSQL is running
  sudo systemctl status postgresql  # Linux
  brew services list                # macOS
  docker ps | grep postgres         # Docker
  ```

**Error**: `password authentication failed`

- **Solution**: Verify credentials in `.env` match your PostgreSQL setup

### Migration Issues

**Error**: `DRIFT DETECTED`

- **Solution**: Migration file was modified after being applied. This is a safety check. If intentional, create a new migration file instead.

**Error**: `relation "organizations" does not exist`

- **Solution**: Run earlier migrations first. The schedules table depends on the organizations table.

### Verification Issues

**Error**: `CHECK constraint is missing`

- **Solution**: Re-run migrations. The constraint may not have been created properly.

**Error**: `Foreign key constraint is NOT enforced`

- **Solution**: Check that the foreign key was created with the correct ON DELETE CASCADE clause.

## Manual Verification (Alternative)

If you prefer to verify manually using psql:

```bash
psql -d payd_db -U payd_user
```

```sql
-- Check tables exist
\dt schedules
\dt execution_history

-- Check schedules table structure
\d schedules

-- Check execution_history table structure
\d execution_history

-- Check indexes
\di idx_schedules_*
\di idx_execution_*

-- Check constraints
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'schedules'::regclass;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'execution_history'::regclass;
```

## Next Steps

Once verification passes:

1. Mark task 1.3 as complete in `specs/payroll-scheduler-backend-wiring/tasks.md`
2. Proceed to task 2.1: Create schedule domain types

## Files Created for This Task

- `backend/.env` - Environment configuration (created with default values)
- `backend/src/db/verify-schedules-schema.ts` - Comprehensive verification script
- `backend/MIGRATION_VERIFICATION.md` - This documentation file

## Package.json Scripts

Add this script to `backend/package.json` if not already present:

```json
{
  "scripts": {
    "db:verify-schedules": "ts-node src/db/verify-schedules-schema.ts"
  }
}
```

## Requirements Validated

This task validates **Requirement 1.1** from the design document:

- Database tables created with proper schema
- Foreign key relationships established
- Indexes created for query performance
- Constraints enforced for data integrity
