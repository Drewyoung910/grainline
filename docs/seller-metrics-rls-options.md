# SellerMetrics RLS options

Date: 2026-11-02

Public-main baseline: `12a4dfc492412ff52ff94d921e20e7026c4cff38`

Status: **Option B selected for isolated compatible preparation.** This follows
Drew's standing direction to choose the safest scalable design. It authorizes
no merge, deployment, Production grant change or RLS activation.

## Domain shape

`SellerMetrics` is a private derived cache used by its owner, the Guild cron,
and bounded staff/Guild operations. Sellers do not author the values. A raw
write can change badge eligibility, so the important boundary is not merely
which row a seller can update; it is who is allowed to calculate the row and
whether every value comes from authoritative source data.

The current application has five direct operations in three files. Five
installed security-definer functions also read the table and must survive
FORCE with exact reviewed ACLs.

## Invariants every option must preserve

1. A seller sees only their own private metrics.
2. Rating, order, shipping, response, case and age facts are derived from
   current authoritative tables, never accepted from a caller.
3. One seller has at most one internally consistent cache row.
4. Concurrent owner/cron refreshes serialize without deadlock or partial state.
5. Staff reads stay on the isolated staff role and existing bounded projections.
6. Guild transitions continue to consume exact fresh metrics.
7. Account deletion removes only the exact claimed seller's cache and cannot
   race a later refresh into recreating it.
8. Hard SellerProfile deletion continues to cascade under FORCE.
9. Impossible rates/counts/totals are rejected at the database boundary.
10. No security release drops historical columns or introduces a retention
    purge.

## Options

| Option | Shape | Caller conversion | Safety | Scale/maintenance | Rollback | Main limitation |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Owner SELECT policy plus fixed refresh** | Runtime keeps direct SELECT under a policy joining SellerProfile to the current actor; all writes use a refresh function | Convert three writes/deletes and wrap direct reads in transaction-local actor context | Cross-owner reads denied; values still source-derived | Small function set, but per-row policy join and future columns become owner-readable by default | Restore CRUD, disable RLS | Raw internal cache becomes an owner data API for no product need; cron/staff still require functions |
| **B. Policyless zero-direct table plus source-derived operations (selected)** | No table policy or direct runtime/staff/PUBLIC authority; owner state/refresh and deletion cleanup are bounded functions; the Guild cron reuses the owner authority under the database-derived cohort identity; retain exact staff/Guild consumers | Convert all five direct operations | Strongest fail-closed boundary; no generic metric forgery or raw-row enumeration | One row per seller, database-side computation, no policy overhead, schema additions stay private | Restore predecessor CRUD before disabling FORCE/RLS; compatible functions remain | Requires careful SQL parity and exact cohort-to-owner binding |
| **C. Dedicated metrics service role** | Only a new service login can refresh/read cache; owner/staff receive projections | Convert all callers and provision a new credential/env/deployment path | Best separation against a stolen app credential | Clean long-term service boundary but materially expands secret, pool, deploy and incident operations for one cache | Credential and app rollback plus grants | Too much launch-time machinery; owner read-through would need a service hop or second operation |
| **D. Split public eligibility from private metrics** | Private cache plus a public/owner eligibility projection | Data migration and dual-write/reconciliation | Can reveal only booleans publicly | More tables and drift paths | Multi-table reconciliation | No current product needs public eligibility facts; public badge already lives elsewhere |
| **E. Column-level privileges only** | Keep direct row access while hiding selected columns | Minimal | Does not isolate sellers and cannot protect derived writes | Cheap initially, unsafe with future columns | Restore grants | Cannot express ownership, source derivation or account-deletion claim binding |

## Recommendation

Choose **Option B**.

Option A protects rows but exposes every current/future cache column to the
owner and still needs fixed service and staff paths. Option C is stronger
against credential theft, but introducing a new production login for a
single-row-per-seller cache is not proportionate before the shared service-role
program exists. Option B removes the immediate broad CRUD surface, prevents
caller-supplied eligibility values, scales as one indexed row per seller, and
fits the existing generic private-table release machinery.

The Guild cron does not receive a separate cross-owner metrics function. Its
existing source-derived cohort returns the seller's server-side user identity,
and the cron reuses the same transaction-local owner refresh as the dashboard.
This does not solve the broader accepted risk that the ordinary runtime
credential can establish application user context; that belongs to the later
signed-identity program. It does avoid adding a second, weaker metrics boundary.

## Planned compatible operation set

1. private refresh core that acquires the existing seller advisory lock,
   derives every source fact, validates safe bounds, and atomically upserts;
2. owner cache state/read-through and forced-refresh operation bound to actor
   and SellerProfile;
3. active account-deletion-claim cleanup;
4. inactive-owner transition cleanup using the same advisory key, covering
   compatible predecessor deletion races; and
5. the five exact retained Guild/staff consumers.

The core is not executable by runtime, staff or PUBLIC. Every wrapper uses a
pinned owner, `SECURITY DEFINER`, `search_path=pg_catalog`, explicit schema
qualification, bounded input/output and no dynamic SQL.

## Release shape

1. Run read-only Production inventory; fail on invalid or unexpected rows.
2. Add validated constraints and fixed operations while RLS stays off and
   predecessor CRUD remains.
3. Convert all direct callers and prove behavior/races on the complete
   PostgreSQL 17 chain.
4. Deploy the compatible app and drain predecessor deployments.
5. Separately activate policyless ENABLE plus FORCE and revoke all direct
   runtime/staff/PUBLIC authority in one transaction.
6. Run exact runtime denial, retained-function, cascade, rollback,
   reactivation, grant-audit and query-plan postflights.

Use the shared preparation and activation catalogs/workflows. Do not add a
copied one-off release framework.

## Decision record

- [x] Select Option B for isolated compatible preparation (Codex, 2026-11-02,
  under Drew's standing safest/scalable direction).
- [x] Complete compatible migration and application conversion in isolation.
- [ ] Pass exact-branch PostgreSQL 17 CI and independent review.
- [ ] Approve compatible preparation merge/deploy.
- [ ] Approve exact Production activation.
