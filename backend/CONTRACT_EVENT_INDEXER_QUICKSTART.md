# Contract Event Indexer - Quick Start Guide

## Setup

### 1. Configure Environment Variables

Add the following to your `backend/.env` file:

```bash
# Soroban RPC URL
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Contract IDs to index (replace with your actual contract addresses)
BULK_PAYMENT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VESTING_ESCROW_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REVENUE_SPLIT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 2. Check the Schema and Run Migrations

Set `DATABASE_URL` in `backend/.env` for the intended PostgreSQL database.
The canonical indexer requires the `contract_events` and `indexer_state`
layout described by
[`016_create_contract_events.sql`](src/db/migrations/016_create_contract_events.sql).

[`015_reconcile_contract_events.sql`](src/db/migrations/015_reconcile_contract_events.sql)
runs between the original 015 migrations and 016. It preserves a legacy 015
`contract_events` table as `contract_events_legacy_015`, including its rows,
indexes, and sequence, so 016 can create the canonical table. Existing migration
files and recorded checksums are unchanged; an already-canonical table is left
alone. An unknown mixed layout or an existing archive is reported for explicit
reconciliation instead of overwriting data. Use the transactional runner below;
if 016 was previously run manually without a transaction, reconcile any indexes
it left behind before retrying.

Legacy rows remain available in `contract_events_legacy_015`; the API reads the
new canonical table. The legacy layout does not retain authoritative organization
ownership or ledger closure time. Recover those values from verified event records
before backfilling; do not use organization 1 or the old local insertion time as
substitutes. The old `contract_event_index_state` is also preserved, but its cursor
is not copied into `indexer_state`, because the archived events have not been
backfilled. Historical reindexing depends on the RPC provider's event retention.

The backend manifest defines `db:migrate`, not `migrate`. From the repository
root, invoke the maintained runner with:

```bash
cd backend
npm run db:migrate
```

The [runner](src/db/migrate.ts) processes all pending SQL migrations in filename
order and records them in `schema_migrations`; it is not limited to the indexer
tables. Check its result before starting the server.

For the focused migration regression, use a separate PostgreSQL test database:

```bash
MIGRATION_TEST_DATABASE_URL=postgresql://localhost/payd_test npm test -- --runInBand --runTestsByPath src/db/__tests__/contractEventSchema.integration.test.ts
```

The three cases execute the actual SQL in temporary schemas and roll them back.
They cover the original failure, preservation of legacy data and cursor state,
canonical insert deduplication, and an already-canonical installation.

### 3. Start the Server

```bash
npm run dev
```

The contract event indexer will start automatically and begin polling for events.

## Verify It's Working

### Check Indexer Status

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3001/api/events/indexer/status
```

Expected response:

```json
{
  "indexerName": "contract_event_indexer",
  "lastIndexedLedger": 12345,
  "lastIndexedAt": "2024-01-01T00:00:00Z",
  "status": "active",
  "errorMessage": null,
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Check Server Logs

You should see logs like:

```
[ContractEventIndexer] Initializing...
[ContractEventIndexer] Monitoring contracts: CTEST123..., CTEST456...
[ContractEventIndexer] Started polling every 10000ms
[ContractEventIndexer] Last indexed ledger: 0
[ContractEventIndexer] Found 5 new events for contract CTEST123...
[ContractEventIndexer] Indexed 5 events, skipped 0 duplicates
```

## Query Events

### Get Events for a Specific Contract

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3001/api/events/CTEST123?page=1&limit=20"
```

### Get All Events

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3001/api/events?page=1&limit=20"
```

### Filter by Event Type

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3001/api/events/CTEST123?eventType=payment"
```

### Filter by Ledger Range

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3001/api/events/CTEST123?fromLedger=100&toLedger=200"
```

## Troubleshooting

### No Events Appearing

1. Check that contract IDs are configured correctly in `.env`
2. Verify contracts have emitted events on the blockchain
3. Check indexer status for errors: `GET /api/events/indexer/status`
4. Review server logs for `[ContractEventIndexer]` messages

### Indexer Not Starting

1. Ensure at least one contract ID is set in environment variables
2. Verify database migration was successful
3. Check that `SOROBAN_RPC_URL` is accessible

### Database Errors

1. Verify PostgreSQL is running
2. Check `DATABASE_URL` is correct
3. Ensure migrations have been applied with `npm run db:migrate` and that the
   canonical schema prerequisite above is satisfied.

## Testing

Run the test suite:

```bash
# Test the indexer service
npm test -- contractEventIndexer

# Test the controller
npm test -- contractEventController

# Run all tests
npm test
```

## Manual Testing with Mock Data

If you want to test without real contracts, you can manually insert test data:

```sql
-- Insert a test event
INSERT INTO contract_events (
  organization_id,
  contract_id,
  event_type,
  payload,
  ledger_sequence,
  transaction_hash,
  event_index,
  ledger_closed_at
) VALUES (
  1,
  'CTEST123',
  'payment',
  '{"amount": "100", "recipient": "GTEST456"}',
  12345,
  'abc123def456',
  0,
  NOW()
);

-- Query the event
SELECT * FROM contract_events WHERE contract_id = 'CTEST123';
```

## Next Steps

- Configure your actual contract IDs in `.env`
- Set up monitoring for the indexer status endpoint
- Integrate event queries into your frontend
- Add custom event parsing logic if needed
- Set up alerts for indexer errors

## API Reference

See [CONTRACT_EVENT_INDEXER.md](./CONTRACT_EVENT_INDEXER.md) for complete API documentation.
