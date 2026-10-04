-- Migration 013 creates a GiST index on inet without naming an operator class.
-- PostgreSQL's built-in inet_ops is not the default; btree_gist supplies one.
-- Keep the applied 013 migration unchanged for checksum verification.
-- The following reconciliation selects the subnet-capable core operator class.
CREATE EXTENSION IF NOT EXISTS btree_gist;
