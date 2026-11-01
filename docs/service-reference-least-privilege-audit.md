# Service and reference table least-privilege audit

Date: 2026-11-01
Source baseline: `12a4dfc492412ff52ff94d921e20e7026c4cff38`
Scope: `SiteConfig`, `SystemAuditLog`, `FoundingMakerGrant`, `Metro`,
`SiteMetricsSnapshot`, and the already-isolated
`SellerExactMapConsentEvent`

## Decision

Use exact table privileges, not row-level security, for this group.

- `SiteConfig`: `SELECT`
- `SystemAuditLog`: `SELECT`, `INSERT`
- `FoundingMakerGrant`: `SELECT`
- `Metro`: `SELECT`, `INSERT`, `UPDATE`
- `SiteMetricsSnapshot`: `SELECT`, `INSERT`, `UPDATE`
- `SellerExactMapConsentEvent`: no ordinary-runtime table authority

This is a database security boundary, not an exemption from the site-wide
review. None of these tables has a useful end-user row owner. RLS policies
would either be unconditional or would require converting service operations
to bespoke functions without reducing the data visible to the same server
credential. Exact operation grants remove ten unused mutation powers and
are enforced by the recurring production grant audit.

No production state changes merely because this candidate exists. The
migration, compatible application, exact-main CI, protected release and
postflight remain separate gates.

## Audit method

The audit independently re-ran the earlier reviewer inventory against current
`main`; the earlier inventory was treated as a lead. It searched:

- every Prisma delegate operation under `src/` and `scripts/`;
- every raw SQL reference under `src/` and `scripts/`;
- live database functions and triggers from the migration chain;
- account export, account deletion, cron, webhook, staff and repair paths;
- runtime provisioning, recurring grant audit and full-chain PostgreSQL test
  wiring.

Proof and maintenance scripts were separated from production application
authority. A script that uses the owner or an ephemeral CI database does not
justify retaining that operation on `grainline_app_runtime` in Production.

## Intended behavior and operation inventory

### `SiteConfig`

Purpose: singleton operational fallback for shipping quotes.

| Principal/path | Operation | Evidence |
|---|---|---|
| signed-in shipping quote route | read row `id = 1` | `src/app/api/shipping/quote/route.ts` has two `findUnique` fallbacks |
| migration/operator | seed or change the singleton | migration-owner path only |

There is no application insert, update or delete. A read failure already falls
back to the bounded code default; narrowing writes does not alter quote
recovery.

### `SystemAuditLog`

Purpose: append-only system, webhook, cron and user-workflow evidence.

| Principal/path | Operation | Evidence |
|---|---|---|
| application/system writers | insert a bounded row | `src/lib/systemAudit.ts` |
| manual stock idempotency receipt | read exact id, then insert once | `src/lib/listingStockMutation.ts` |
| fixed database functions | insert/read through owner functions | live migration bodies, independent of caller table grants |
| proof/repair scripts | read or clean fixtures | owner/throwaway database only |

No production application caller updates or deletes a row. The retained
`SELECT` is needed by stock-mutation replay. Removing `UPDATE` and `DELETE`
makes the documented append-only rule an actual runtime-role control.

### `FoundingMakerGrant`

Purpose: durable, non-recycled Founding Maker number allocation.

| Principal/path | Operation | Evidence |
|---|---|---|
| repair scan | aggregate max and read granted seller ids | `src/lib/foundingMaker.ts` |
| allocator | fixed `grainline_seller_service_founding_maker_grant` call | `src/lib/foundingMakerCore.ts` |
| concurrency proof | fixture create/delete | disposable proof database only |

The fixed allocator is security-definer and owns mutation. Ordinary runtime
needs only `SELECT`; direct insert/update/delete could duplicate or erase the
public badge history.

### `Metro`

Purpose: public geographic reference rows used by browse, sitemap, maker and
commission pages.

| Principal/path | Operation | Evidence |
|---|---|---|
| public pages and geo matching | read active/reference rows | public pages plus `src/lib/geo-metro.ts` |
| explicit-public-locality fallback | upsert a missing city | `findOrCreateMetro()` in `src/lib/geo-metro.ts` |
| one-time local backfill | read/upsert | `scripts/backfill-metros.ts`, guarded from Production |

The current product intentionally allows server-side auto-creation from a
geocoded public city/state. That requires `SELECT`, `INSERT` and `UPDATE` for
the shared runtime. Nothing deletes a Metro; `DELETE` is removed. Moving
auto-creation to an isolated service function is a possible later hardening,
not required to remove the unused delete authority now.

### `SiteMetricsSnapshot`

Purpose: singleton derived marketplace metrics used by quality scoring.

| Principal/path | Operation | Evidence |
|---|---|---|
| quality-score reads | read singleton | `getSiteMetricsSnapshot()` |
| derived refresh | upsert singleton | `calculateSiteMetricsSnapshot()` |

The runtime needs `SELECT`, `INSERT` and `UPDATE`; there is no delete caller.
The stored data is derived and non-PII. A later dedicated metrics worker may
take the write grants, but current code does not have that separate identity.

### `SellerExactMapConsentEvent`

Purpose: immutable legal/privacy evidence for exact public-map consent.

The source table already has zero ordinary-runtime, staff and `PUBLIC` direct
authority. Fixed database-owner writers and its immutable trigger are the only
mutation paths. This batch changes nothing on that table; the recurring audit
continues to require zero runtime authority. Production application status
must be verified separately before the coverage ledger calls the alternative
live.

## Cross-cutting workflow review

### Account export and deletion

None of the five narrowed tables is directly exported or deleted during
account deletion. `FoundingMakerGrant.sellerProfileId` is retained or cleared
through database-owned lifecycle behavior; `SystemAuditLog` evidence is
retained and redacted by the already-reviewed side-effect process. The email
and rating tables touched by export/deletion are deliberately outside this
batch.

### Webhooks, cron and staff tools

- Webhooks and jobs insert `SystemAuditLog`; they do not rewrite it.
- Site metrics refresh is the only snapshot writer.
- No staff UI mutates `SiteConfig` or deletes Metro rows.
- Founding Maker repair reads grants and calls the fixed allocator.

### Concurrency and idempotency

- Grant changes are catalog-only and do not rewrite rows.
- The migration sets a five-second lock timeout and a sixty-second statement
  timeout so it refuses rather than waiting indefinitely behind traffic.
- Existing `SystemAuditLog` exact-id receipts and Founding Maker allocator
  locks are unchanged.
- Metro and metrics upserts retain both insert and update authority, so their
  conflict behavior is unchanged.
- Provisioning replays converge back to the exact grants instead of restoring
  broad CRUD, but only after the exact migration ledger row is durably applied.
  Before that row exists, provisioning deliberately preserves predecessor CRUD;
  a partial or checksum-drifted row fails closed.
- The exact checksum is admitted with either Prisma's normal one-step ledger
  record or its documented zero-step `migrate resolve --applied` record. The
  zero-step form is confined to the reviewed manual-migration allowlist and is
  exercised by the PostgreSQL full-chain proof.

### Scale

No query shape, index, row count or hot-path lock changes. The only runtime
change is PostgreSQL denying operations with no current caller. Grant checks
are catalog lookups performed at statement authorization time.

## Options considered

### A. Full RLS

Rejected. These are singleton, public-reference, derived, append-only or
service allocation tables. They have no natural user-owned row predicate.
RLS would still need unconditional service access or purpose-built functions
for the same server identity.

### B. Zero direct authority plus fixed functions

Strongest isolation, but not selected for this pass. It would require new read
and write functions for shipping fallback, system-audit receipts, metro reads
and auto-creation, and metrics refresh. That is a large function surface for
non-PII/reference data and recreates the one-function-per-access cost the
remaining-table strategy explicitly avoids.

### C. Exact operation grants

Selected. It removes every unused write operation, preserves current behavior,
has a small rollback, scales with existing Prisma callers, and is enforced by
the shared grant audit and provisioning script.

## Findings and classification

| ID | Finding | Class | Candidate closure |
|---|---|---|---|
| SRLP-01 | Runtime has CRUD on five tables although no caller uses ten of those operations | `BLOCKS_RLS_DESIGN` | exact grants in migration |
| SRLP-02 | `SystemAuditLog` append-only behavior is not enforced for the runtime role | `BLOCKS_RLS_DESIGN` | revoke update/delete |
| SRLP-03 | provisioning replay would restore broad CRUD | `FIX_BEFORE_ACTIVATION` | exact convergence block |
| SRLP-04 | recurring grant audit assumes CRUD for every non-RLS table | `FIX_BEFORE_ACTIVATION` | exact per-table allowlist |
| SRLP-05 | cross-user email and cron ledgers still need CRUD under the shared worker identity | `DEFERRED_PRODUCT_WORK` | retain CRUD; revisit only with a dedicated service identity |

## Acceptance evidence required

The candidate is acceptable only when all of these pass on the complete
PostgreSQL 17 migration chain:

1. direct login as `grainline_app_runtime`, not owner `SET ROLE`;
2. every retained operation succeeds;
3. every removed operation fails with `42501`;
4. `SellerExactMapConsentEvent` remains inaccessible;
5. provisioning replay preserves the exact state;
6. the global grant audit rejects either a missing grant or an extra grant;
7. focused source and behavior tests, TypeScript, lint, build and dependency
   audit are green before release.
8. executed database-first rollback restores predecessor CRUD, and restoration
   returns to the exact reviewed grants before the full-chain test exits.

The real-runtime scenario is
`tools/database-full-chain/scenarios/service-reference-least-privilege.mjs`.

## Rollback

If a missed production caller is discovered, restore predecessor CRUD only to
the five changed tables:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."FoundingMakerGrant",
  public."Metro",
  public."SiteConfig",
  public."SiteMetricsSnapshot",
  public."SystemAuditLog"
TO grainline_app_runtime;
```

The guarded rollback draft is
`docs/rls-drafts/service-reference-least-privilege-rollback.sql`. Rollback also
requires reverting the provisioning and grant-audit allowlists, then re-running
the global audit. No data migration or column rollback is needed. The rollback
is rehearsed and restored on the disposable PostgreSQL 17 full chain.

## Go/no-go

**GO for an isolated candidate and PostgreSQL 17 proof. NO-GO for merge or
Production until independent review and explicit release authorization.**
