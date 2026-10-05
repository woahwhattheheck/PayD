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

### 2. Run Database Migration

```bash
cd backend
npm run migrate
```

This will create the `contract_events` and `indexer_state` tables.

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
3. Ensure migrations have been applied: `npm run migrate`

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
