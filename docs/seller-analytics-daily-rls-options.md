# Seller daily analytics RLS options

Date: 2026-11-01

Source baseline: `12a4dfc492412ff52ff94d921e20e7026c4cff38`

Status: **Option B selected for isolated compatible preparation.** This is not
authorization to merge, deploy, change grants, or activate Production RLS.

## Domain shape

`ListingViewDaily` and `SellerProfileViewDaily` are seller-private aggregates
written by public telemetry and maintenance flows. A seller needs totals and
chart buckets, not direct row mutation or raw-row enumeration. Anonymous users
must never receive a direct table grant merely because their accepted page
view contributes to an aggregate.

The reviewed source contains eight direct daily-table operations in five files:
two listing telemetry upserts, three owner analytics reads, two retention
deletes, and one account-deletion delete. Two security-definer consumers
already exist and must be retained: profile-view recording and seller top
listings.

## Invariants every option must preserve

1. Public telemetry counts only a currently public target after the existing
   abuse-control gates.
2. Signed-in seller self-traffic is excluded.
3. Listing scalar and daily counters change atomically.
4. Seller id and UTC day are derived from locked database state.
5. Counts are nonnegative and cannot wrap; daily timestamps are midnight UTC.
6. A seller reads only their own totals and grouped buckets.
7. Raw viewer identity is never stored or returned.
8. Retention removes only rows older than 730 days in bounded work.
9. Account deletion removes profile-view history without silently changing
   retained listing-history behavior.
10. Parent cascades, the existing top-listings authority, rollback, and clean
    reactivation continue under FORCE.

## Options

| Option | Shape | Caller conversion | Protection | Scale and maintenance | Rollback | Limits |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Owner `SELECT` policy plus fixed writers** | Runtime receives `SELECT`; policy resolves `app.user_id` to the seller; public telemetry, cleanup, and deletion use functions | Convert five writes/deletes; wrap three reads in actor context | Cross-seller read isolation if context and helper stay correct | Adds per-row policy work and returns raw listing/day rows to Node; policy must traverse policyless SellerProfile through a helper | Restore CRUD, disable RLS | Exposes internal rows for no product need; future columns become owner-readable by default unless projections are maintained |
| **B. Policyless zero-direct table plus bounded operations (selected)** | No runtime, staff, or `PUBLIC` table/column authority; zero policies; fixed telemetry, owner summary/buckets, retention, and deletion | Convert all eight direct operations; retain/pin two existing functions | Strong fail-closed boundary; raw rows never leave purpose-bound operations | One hot-path write round trip; database-side grouping; no per-row policy overhead; future columns remain inaccessible | Restore predecessor CRUD before disabling RLS; compatible app keeps using fixed operations | Adds a small reviewed function catalog and requires exact behavior parity tests |
| **C. Companion ingestion table or public projection** | Public events enter a staging table and a job rolls them into private aggregates, or a view exposes selected rows | Rebuild public ingestion, reconciliation, job recovery, and owner reads | Can separate ingestion from reporting | More rows, lag, replay/idempotency ledger, and operational recovery for a domain already safely expressible atomically | Multi-table reconciliation | No privacy gain; a public view of seller traffic is the wrong product boundary |
| **D. Column-level revocation with direct table operations** | Hide ids or counters selectively while keeping shared-runtime CRUD | Minimal conversion | Does not isolate one seller from another because all rows have the same columns | Cheap initially, unsafe as schema grows | Restore columns/grants | Cannot express row ownership, public-writer eligibility, retention cutoff, or listing/seller consistency |

## Recommendation

Choose **Option B**.

The owner does not author these rows, and public viewers must not own them.
Using an owner policy would turn an internal aggregate table into an owner data
API and would preserve a large Node-side grouping result. Policyless RLS makes
the intended contract explicit:

- public routes may request one validated increment and learn only whether it
  was recorded;
- seller owners may request their own totals and grouped buckets;
- the cron may request bounded fixed-cutoff cleanup;
- account deletion may request one claim-bound cleanup; and
- no caller may enumerate or mutate raw rows directly.

This is both safer and more scalable than Option A, while much smaller than a
companion ingestion system.

## Planned compatible operation set

The preparation should minimize functions without combining unrelated
authority:

1. one listing telemetry recorder with a pinned `view`/`click` kind;
2. the retained seller-profile telemetry recorder, hardened for daily-counter
   exhaustion;
3. one owner engagement summary operation;
4. one owner grouped-bucket operation;
5. the retained seller top-listings operation;
6. one bounded retention operation covering both tables; and
7. one deletion-claim-bound profile-history cleanup, either standalone or
   folded into the existing seller anonymization authority.

Every security-definer function uses a pinned owner, `search_path=pg_catalog`,
explicit schema qualification, exact ACL, bounded inputs/outputs, and no
dynamic SQL. Public functions return no private counts or identifiers beyond
the target already supplied by the caller.

## Release shape

1. Run the read-only production schema/data inventory.
2. Add validated invariants and purpose-bound functions while RLS remains off
   and predecessor grants remain.
3. Convert all eight direct operations and prove parity/races on the complete
   PostgreSQL 17 chain.
4. Deploy the compatible app and drain every predecessor deployment that can
   still issue direct statements.
5. In one later activation transaction, revoke direct authority and apply both
   ENABLE and FORCE with zero policies.
6. Run exact runtime-role denial, behavior, rollback, reactivation, catalog,
   and query-plan postflights.

The activation should join the generic private/aggregate release machinery
rather than add another copied one-off workflow. Only one pending migration set
may be admitted, and the workflow must bind the exact main commit, exact-head
CI, compatible deployed commit, predecessor drain, migration digest, and
read-only production inventory.

## Rollback

Rollback is database-first. Restore exact predecessor CRUD grants without
grant option, verify the grant set, disable FORCE/RLS, and execute the old
Prisma statements before changing the app. Keep the compatible functions and
validated data invariants so the new app continues to work during rollback.

No security release drops columns, tables, or historical rows beyond the
already-reviewed retention and account-deletion behavior.

## Decision record

- [x] Select Option B for isolated compatible preparation (Codex, 2026-11-01,
  following Drew's standing direction to choose the safest scalable design).
- [ ] Complete read-only production inventory.
- [ ] Close every `FIX_BEFORE_ACTIVATION` item in the pre-RLS audit.
- [ ] Approve compatible preparation merge/deploy.
- [ ] Approve Production activation.
