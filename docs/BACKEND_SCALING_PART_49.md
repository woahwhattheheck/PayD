# Backend Scaling — Part 49: Audit Integrity, Per-Tenant Rate Limits & Resource Quotas

> Implemented as part of [Issue #374](https://github.com/Protocol-Guild/PayD/issues/374)

---

## Overview

Part 49 adds three complementary hardening layers to the PayD multi-tenant backend:

1. **Tamper-evident audit log chain** — SHA-256 `row_hash` + `chain_hash` computed by a PostgreSQL trigger on every `api_audit_logs` insert; a scheduled nightly job walks the chain and alerts on any broken link.
2. **Per-tenant rate-limit overrides with circuit breaker** — operators can store custom `requests_per_minute` / `burst_size` values per organisation; these are cached in Redis (5-minute TTL). A circuit breaker halves limits automatically when the org's error rate exceeds 20 % in a 60-second rolling window.
3. **Tenant resource quotas** — `max_employees`, `max_monthly_transactions`, and `max_storage_mb` columns on `organization_settings`; enforced pre-INSERT by `TenantQuotaService`; 80 % approach warnings emitted as structured log events; daily usage snapshots stored in `tenant_usage_snapshots`.

---

## Database migration

`backend/src/db/migrations/032_audit_integrity_and_quotas.sql`

| Object | Purpose |
|---|---|
| `api_audit_logs.row_hash` | SHA-256 of immutable audit fields |
| `api_audit_logs.chain_hash` | SHA-256(row_hash ∥ prev_chain_hash) |
| `compute_audit_chain_hash` trigger | Populates hashes on INSERT; trigger runs `BEFORE INSERT` |
| `deny_audit_log_mutation` trigger | Raises exception on UPDATE / DELETE |
| `platform_admin_access_logs` | Logs every cross-tenant platform-admin action |
| `organization_settings` quota columns | `max_employees`, `max_monthly_transactions`, `max_storage_mb`, `quota_alert_threshold` |
| `tenant_usage_snapshots` | Daily UPSERT of per-org usage metrics |

---

## New services

### `auditIntegrityService.ts`
- `recomputeRowHash(row)` — deterministic SHA-256 of immutable row fields (Node.js `crypto`)
- `recomputeChainHash(rowHash, prevChainHash)` — links rows into a tamper-evident chain
- `AuditIntegrityService.verifyIntegrity({ limit? })` — walks rows oldest-first, returns first broken link or `null`
- `AuditIntegrityService.runScheduledCheck()` — emits a structured log event suitable for SIEM ingestion

### `tenantQuotaService.ts`
- `TenantQuotaService.getQuotas(orgId)` — fetches limits from DB; falls back to safe defaults
- `TenantQuotaService.getCurrentUsage(orgId)` — live employee count + monthly transaction count
- `TenantQuotaService.assertEmployeeQuota(orgId)` — throws `QuotaExceededError` if at/over limit
- `TenantQuotaService.assertTransactionQuota(orgId)` — same for transactions
- `TenantQuotaService.snapshotDailyUsage(orgId)` — UPSERT into `tenant_usage_snapshots`
- `TenantQuotaService.snapshotAllTenants()` — runs all orgs with `Promise.allSettled`

### `tenantRateLimitService.ts`
- `TenantRateLimitService.getOverrides(orgId)` — Redis cache → DB fallback; 5-minute TTL
- `TenantRateLimitService.setOverrides(orgId, overrides)` — UPSERT + cache invalidation
- `getCircuitBreakerState(orgId, redis)` — OPEN when error rate > 20 % in 60 s
- `recordRequestOutcome(orgId, isError, redis)` — increments sliding-window counters

---

## New middleware

### `requireAdminJustification.ts`
Requires the `x-admin-reason` header (≥ 10 characters) on every platform-admin cross-tenant request.  Returns `403` otherwise.  On response finish, fires a fire-and-forget INSERT into `platform_admin_access_logs`.

### `tenantQuotaMiddleware.ts`
`quotaGuard(resource)` — reusable Express middleware factory.  Returns `429` with `X-Quota-Resource` header when the quota is exceeded.

---

## New routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/audit/integrity` | PLATFORM_ADMIN | Run audit chain integrity check |
| `GET` | `/api/admin/tenants/:orgId/rate-limits` | PLATFORM_ADMIN + justification | Read per-tenant rate-limit overrides |
| `PATCH` | `/api/admin/tenants/:orgId/rate-limits` | PLATFORM_ADMIN + justification | Update per-tenant rate-limit overrides |
| `GET` | `/api/admin/access-logs` | PLATFORM_ADMIN | Paginated platform-admin access log |
| `GET` | `/api/admin/tenants/:orgId/quotas` | PLATFORM_ADMIN + justification | Read tenant quota config |
| `PATCH` | `/api/admin/tenants/:orgId/quotas` | PLATFORM_ADMIN + justification | Update tenant quota config |
| `GET` | `/api/usage/quotas` | EMPLOYER / ADMIN | Own org quotas + current utilisation |
| `GET` | `/api/usage/snapshots` | EMPLOYER / ADMIN | Historical daily usage snapshots |

---

## Background jobs

`backend/src/jobs/part49Jobs.ts`

| Job | Schedule | Description |
|---|---|---|
| `scheduleDailyUsageSnapshots` | Every 24 h (immediate first run) | Calls `TenantQuotaService.snapshotAllTenants()` |
| `scheduleNightlyIntegrityCheck` | Every 24 h (immediate first run) | Calls `AuditIntegrityService.runScheduledCheck()` |

Both jobs are registered in `backend/src/index.ts` inside the `server.listen` callback.

---

## Tests

| File | Coverage |
|---|---|
| `backend/src/__tests__/backendScalingPart49.test.ts` | `recomputeRowHash`, `recomputeChainHash`, `QuotaExceededError` shape |
| `backend/src/middleware/__tests__/requireAdminJustification.test.ts` | No header, whitespace, too-short, valid, on-finish registration |
| `backend/src/services/__tests__/tenantQuotaService.test.ts` | `getQuotas` (DB row vs. defaults), `assertEmployeeQuota` (at/over/under limit + error shape) |
