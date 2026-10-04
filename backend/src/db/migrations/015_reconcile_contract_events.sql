-- Run after both 015_create_* files and before 016_create_contract_events.sql.
-- Keep the applied migrations unchanged: the runner verifies their checksums.
-- The old indexer never stored organization_id or ledger_closed_at, so its rows
-- cannot be truthfully backfilled into the canonical schema automatically.
DO $$
DECLARE
  event_table REGCLASS := to_regclass('contract_events');
  columns TEXT[];
BEGIN
  IF event_table IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(attname::TEXT)
    INTO columns
    FROM pg_attribute
    WHERE attrelid = event_table AND attnum > 0 AND NOT attisdropped;

  -- An installation already using 016 needs no conversion.
  IF columns @> ARRAY['organization_id', 'transaction_hash', 'event_index',
                     'ledger_closed_at', 'indexed_at']
     AND NOT columns && ARRAY['event_id', 'tx_hash'] THEN
    RETURN;
  END IF;

  IF columns IS NULL
     OR NOT columns @> ARRAY['id', 'event_id', 'contract_id', 'event_type',
                         'payload', 'ledger_sequence', 'tx_hash', 'created_at']
     OR columns && ARRAY['organization_id', 'transaction_hash', 'event_index',
                         'ledger_closed_at', 'indexed_at'] THEN
    RAISE EXCEPTION 'Unrecognized contract_events schema; reconcile it before running migration 016';
  END IF;

  IF to_regclass('contract_events_legacy_015') IS NOT NULL THEN
    RAISE EXCEPTION 'contract_events_legacy_015 already exists; preserve both tables and reconcile them before retrying';
  END IF;

  -- Renaming preserves every row, index, sequence, and dependent object.
  -- Do not copy the old cursor: archived events are not canonical backfill.
  ALTER TABLE contract_events RENAME TO contract_events_legacy_015;
END;
$$;
