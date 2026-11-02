# AdminAuditLog RLS options

Date: 2026-11-02

Status: activation candidate. The isolated compatible application conversion
is zero-direct and its 14-operation migration plus private insert fence passes
focused and complete-chain PostgreSQL 17 proof. Atomic deletion-plan creation
and five deterministic concurrency scenarios pass, as do the 100,000-row
plans. The reusable manifest and real-catalog inspector seal the 15 new and 23
retained functions, indexes and trigger. Deploy-order compatibility, the
app-first rollback and the full local release-workflow restart sequence pass
on PostgreSQL 17. The separate policyless ENABLE-plus-FORCE candidate now also
passes the complete 464-migration PostgreSQL 17 chain, final runtime/staff/
account-deletion role convergence, direct-denial matrix, database-first
rollback, predecessor CRUD and exact reactivation. Preparation and activation
remain unaccepted until exact-branch PostgreSQL 17 CI and independent exact-head
review pass.
This document authorizes no merge, deployment, Production database change, grant change, or
RLS activation.

## Decision context

`AdminAuditLog` is not an owner-only table despite its `adminId` column name.
The column records the action actor and currently includes administrators,
employees, ordinary users, and automated actions attributed to a related user.
Rows contain private moderation reasons, provider-recovery evidence, account
state snapshots, undo state, and identifiers used by other durable ledgers.

The audited public-main baseline is
`12a4dfc492412ff52ff94d921e20e7026c4cff38`. The isolated serial RLS baseline
is `2a10b3d354e766ef787249f790a19b4d3a92212b`; it contains the already-reviewed
Block, UserReport, SellerFaq, SellerBroadcast, seller-analytics, Commission and
email-service candidates. The AdminAuditLog design must compose after that
serial chain without changing its release order.

The audited baseline had 20 executable direct AdminAuditLog accesses across
six files; the current isolated candidate has zero. The complete PostgreSQL 17 schema has 23 installed functions whose
current bodies read or write AdminAuditLog. Two immutable service ledgers have
restricting foreign keys to audit rows. Any design therefore has to preserve
atomic cross-domain writes and durable references, not merely protect the
admin page.

## Required security and product properties

1. Ordinary users must not enumerate audit rows, including rows where they are
   the actor or target.
2. Staff list/search access must require the isolated staff database role and
   a current active staff actor. The application runtime role must not gain a
   global staff-reader policy.
3. Existing case, order, support, seller, report and notification functions
   must keep co-committing exact audit evidence in their domain transaction.
4. Application paths may append only the action family they implement; a
   generic runtime writer must not let a caller forge arbitrary staff actions.
5. Audit identity and action evidence are append-only. The only allowed row
   mutations are the one-way undo transition and bounded privacy redaction.
6. Undo must remain atomic with the domain reversal and must continue to
   reject self-undo, stale state, expired windows and concurrent replay.
7. Account deletion must redact only structurally related rows, keep
   referenced evidence rows, and remain retryable without overwriting newer
   state.
8. No application or staff role may delete audit rows. Existing foreign keys
   from `CaseOpenApplication` and `OrderRefundReconciliation` remain
   `ON DELETE RESTRICT`.
9. Pagination, repair scans and deletion redaction must stay bounded as the
   table grows. Production inventory and query-plan checks are activation
   gates.
10. No column deletion, table rename, historical rewrite, or retention purge is
    part of the security release.

## Option A: direct RLS policies for actor inserts and staff reads

Shape:

- add an actor-bound direct `INSERT` policy to the ordinary runtime role;
- add global `SELECT` and undo `UPDATE` policies to the staff role;
- retain fixed functions for service writes and account-deletion redaction;
- revoke direct `DELETE` and unrelated `UPDATE`.

Advantages:

- smallest conversion diff;
- user self-actions and admin-page reads can continue using Prisma;
- straightforward row-policy tests.

Problems:

- `adminId` is not a reliable ownership boundary. Automated `AI_HOLD_LISTING`
  rows are attributed to the seller, and user self-actions deliberately share
  the table with staff evidence;
- an actor-bound generic insert still lets any future runtime caller forge an
  arbitrary action, target and metadata under its own id;
- global staff `UPDATE` is much broader than the one-way undo transition;
- the isolated staff connection does not use a transaction-local actor policy
  as its primary boundary. Current staff operations validate the actor inside
  fixed functions;
- policies cannot express the cross-table source checks required by case,
  order, ban, listing and account-deletion workflows without duplicating those
  state machines in table policy predicates.

This is less code than Option B, but it makes the audit ledger's most sensitive
authority generic and easy to misuse. It is rejected.

## Option B: policyless RLS with zero direct access and bounded operations

Shape:

- retain the completed conversion of the six application consumers to fixed operations;
- retain the 23 installed domain functions after exact catalog review;
- use the isolated staff role for global page, repair and staff-transition
  operations;
- use actor-bound ordinary-runtime operations only for the exact user action
  families that must co-commit with ordinary-user transactions;
- add source-bound operations for ban side-effect convergence, undo claim and
  completion, account-deletion candidate collection/redaction, and automated
  listing-review evidence;
- after the compatible app is live and predecessor traffic is drained, enable
  and force policyless RLS and revoke all direct runtime, staff and `PUBLIC`
  table/column authority.

Advantages:

- every read and mutation has a named product purpose and bounded result;
- staff access stays on the existing isolated role instead of becoming a
  global table policy;
- domain functions keep atomic evidence writes without granting the caller
  table authority;
- arbitrary runtime audit forgery, table deletion, primary-key mutation and
  broad metadata updates are removed;
- operation-specific indexes and query-plan proofs can be designed from actual
  workloads instead of exposing an unbounded table query.

Costs:

- the six direct consumers must be converted and behavior-matched;
- undo and deletion redaction need careful transaction and replay contracts;
- the exact installed function catalog is larger than recent owner-only table
  releases, so preparation and activation proofs are correspondingly larger;
- future action families need an explicit operation or an extension to a
  reviewed family, rather than a raw Prisma insert.

This is selected. It is the safest long-term design and matches the existing
fixed-operation architecture for cross-domain staff and service evidence.

## Option C: split immutable evidence from mutable undo/privacy state

Shape:

- move immutable action identity and evidence to a new append-only table;
- keep undo status and privacy-redacted display material in a companion table;
- expose a staff-only joined projection;
- migrate foreign keys and every existing writer.

Advantages:

- strongest structural immutability;
- privacy redaction and undo state cannot overwrite immutable evidence;
- retention could later differ by evidence class.

Problems:

- every existing writer and both foreign-key ledgers would need a coordinated
  data migration;
- a security release would rewrite historical rows and introduce a large
  rollback surface;
- many existing operations need both evidence and presentation data in one
  transaction, so the split adds joins and failure modes without removing the
  need for fixed operations;
- production retention and legal policy are not yet decided, so a permanent
  physical split would encode unsettled product policy.

This may be reconsidered with the eventual retention/legal design. It is
rejected for the current release.

## Selected preparation boundary

The compatible preparation leaves RLS off and predecessor CRUD grants in
place. The current candidate adds and converts only the following authority
families:

1. isolated-staff bounded count/page and action filter;
2. actor-bound terms-acceptance and export evidence;
3. source-bound automated listing-hold evidence;
4. ban/unban and external-side-effect evidence plus bounded repair discovery;
5. atomic undo claim and undo-evidence completion;
6. account-deletion self-evidence, exact candidate enumeration and
   claim-bound redaction; and
7. retained current-function writers/readers, sealed by exact signature,
   owner, ACL, security mode, search path and source digest.

The candidate adds 14 named operations plus one private insert-fence trigger
and has zero direct source consumers.
Its account-deletion retry format stores only an already-redacted patch plus
source SHA-256 fingerprints; the apply operation preserves undo fields,
refuses changed source and atomically completes the exact claimed job. Plan
creation now commits in the same transaction as local anonymization, while a
shared insert fence keeps ordinary writers concurrent while ordering retained
domain writers on both sides of deletion
and rejects post-deletion structural references. No raw deletion needle is
stored for retry.

The activation is separate. It may combine `ENABLE ROW LEVEL SECURITY` and
`FORCE ROW LEVEL SECURITY` only after:

- all direct application consumers are zero;
- the compatible app is live and predecessor traffic is drained;
- the installed 23-function catalog and any new operations are exact;
- account-deletion and undo races pass on full PostgreSQL 17;
- audit-redaction plans are durable before local anonymization is marked done;
- runtime, staff and `PUBLIC` direct table/column authority are zero;
- existing foreign-key cascades/restrict behavior is executed under FORCE;
- the database-first rollback restores predecessor access and behavior; and
- Drew separately approves the exact Production action.

## Rollback posture

Preparation rollback is application-first: deploy the predecessor-compatible
app, then remove only the additive functions/indexes after proving predecessor
statements still work. Activation rollback is database-first: restore the
reviewed predecessor grants, disable FORCE and RLS, remove activation-only
objects, and execute the predecessor read/write/undo/redaction statements
before any app rollback. A successfully applied migration ledger row remains
applied; later reactivation requires a new reviewed forward migration.

The preparation rollback has been executed on the complete disposable
PostgreSQL 17 chain. It removed the 15 new functions, two indexes and one
trigger, preserved the 28-row audit-data fingerprint, admitted predecessor
runtime SELECT/INSERT/UPDATE/DELETE, and then admitted exact reapplication.
The production build gate separately pins the new runtime, isolated-staff and
account-deletion function bodies so the prepared app cannot deploy before the
database preparation.

The activation rollback has also been executed on the complete disposable
PostgreSQL 17 chain. It restores predecessor CRUD before disabling FORCE/RLS,
retains the prepared functions, indexes and trigger, proves predecessor
runtime statements, and admits exact forward reactivation. A later Production
rollback would still require a reviewed operator action and migration-ledger
reconciliation; this local evidence grants no Production authority.
