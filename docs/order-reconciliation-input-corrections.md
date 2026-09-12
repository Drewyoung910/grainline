# Order reconciliation and receipt input corrections

Status, 2026-09-07: isolated additive drafts, not staged migrations or
production operators. Applied migration bytes and historical verifiers remain
unchanged. These are two independently packaged authorities, not permission to
change Notification and refund reconciliation together in production.

## Verified behavior and severity

- `grainline_order_refund_claim_mark_ambiguous` accepts a NULL reason past its
  closed-enum guard. With a valid pending claim/generation it records an
  ambiguous refund and review note. This is a database input-domain defect;
  it does not bypass claim identity or provider-authorization evidence.
- `grainline_order_refund_reconcile` has the same missing explicit rejection
  for action and provider disposition. Reproductions reach SQLSTATE `23502`
  at the downstream NOT NULL constraints and leave Order, reconciliation and
  audit rows unchanged. Those constraints already contain durable mutation;
  explicit input rejection is hardening, not a newly proved refund bypass.
- `grainline_notification_create_core` skips the source/type matrix when type
  is NULL. However, the buyer-receipt branch also requires an exact
  `ORDER_DELIVERED`/`ORDER_SHIPPED` type in its source query. A valid receipt
  source with NULL type returns NULL without inserting a Notification. This
  corrects the earlier overly broad description that every such receipt
  attempt reaches the Notification NOT NULL constraint. No durable receipt
  mutation or authorization bypass was reproduced.

The refund TypeScript caller selects a typed action from inspected provider
evidence, rejects a different action, and uses a typed ambiguous reason. No
ordinary HTTP path supplying arbitrary NULL values was demonstrated. The
Notification core remains private; runtime reaches it only through reviewed
wrappers. Tests do not infer a compromised-runtime attack is an HTTP exploit.

## Minimal implementation

`scripts/build-order-reconciliation-input-corrections.mjs` extracts and verifies
fixed SHA-256-pinned predecessor definitions, adding only the four explicit
`IS NULL` predicates. It produces:

- `docs/rls-drafts/order-refund-reconciliation-input-correction.sql`: two
  functions, three guards (reason, action and provider disposition).
- `docs/rls-drafts/order-receipt-notification-type-correction.sql`: one private
  core, one type guard. All other source families and the legacy
  `NEW_ORDER` to `REFUND_ISSUED` normalization are unchanged.

Each draft attests all predecessor bodies, owner, security metadata and ACLs
before replacing any function, then attests the resulting state. The receipt
core must remain inaccessible to runtime; the refund authorities must retain
their existing runtime EXECUTE. PUBLIC/third-party EXECUTE, unexpected source,
or missing expected runtime access aborts. No table grants, policies, posture,
signature, claim-generation rule, time window, or legitimate branch changes.

## Verification and limits

The existing PGlite PostgreSQL functional suites run against both historical
and corrected definitions. They retain ADMIN-only reconciliation, exact replay,
same-second provider evidence, short-window retry, aged no-effect release,
immutable evidence, receipt delivery/pickup, and forged-recipient/private-core
denials. New tests reproduce the historical behavior, require explicit rejection
before mutation, compare unchanged table snapshots, check byte reproducibility,
and reject source/ACL drift before replacement.

The focused historical/corrected refund and receipt suites passed 26/26.
The full local test suite and lint passed after those changes. A later,
separately focused composition harness is wired in ordinary disposable CI:
`scripts/order-input-correction-drafts-postgres-proof.mjs`. It permits only
PostgreSQL 16 at loopback `grainline_ci` as `ci`, applies the three Order input
drafts inside a rollback-only transaction, and verifies only the five intended
function bodies change. It compares function metadata/ACLs, relations, columns,
policies, roles, default ACLs and migration rows before/after. It verifies full
catalog restoration and reruns the unchanged complete-prefix verifier after
rollback. Error logs contain only a bounded phase and SQLSTATE, not catalogs
or connection values. Exact corrected CI acceptance is recorded below.

First full-schema run `34165481370` at `e060c84797b7711c26d8b5cd5fc9aae5559f57eb`
failed at identity before applying any draft. The new reader used
`inet_server_addr()::text`, whose PostgreSQL representation includes `/32`,
but the existing private-service guard intentionally accepts only a literal
IP address. A local engine reproduction proves that representation mismatch.
The correction uses `host(inet_server_addr())`, matching the existing
concurrency operators, with a regression that preserves rejection of masked
strings and non-CI private hosts. No host allowlist, production boundary or
SQL draft is loosened. The failed run is not counted as acceptance.

Corrected checkpoint `be0eedf0f0a5ca8eeefd59c66d3d78023664d0f6`, CI
`34166065857`: the PostgreSQL 16 input-draft composition step passed, as did
the historical runtime-login postflight and complete-prefix proof. This accepts
the five-function draft application, exact catalog comparison and rollback
under the disposable owner. It does not attest corrected bodies through an
actual runtime login or production. The full workflow subsequently completed
successfully, including the full test suite and production build. Companion
account-deletion concurrency `34166065873`, paid-repair locking `34166065871`
and staff bootstrap `34166065850` also passed at that exact revision.

The separate reservation repair draft is deliberately excluded: its own
owner-bound FORCE-table release and runtime proof remain a separate gate.

PGlite role tests are local engine behavior tests, not real pooled-runtime
production proof. Full-schema composition is accepted only as the rollback
proof above. Exact database/role/ledger release binding, final-candidate
runtime-login proof, and production acceptance remain open. Do not relax a historical function hash to accept
these successors. Preserve the distinct reservation-repair and label-outcome
release gates in their linked runbooks and the ordered completion plan.

The next isolated login proof is now implemented in
`order-input-correction-runtime-proof.md`. It uses a committed disposable clone
and a separate restricted-runtime connection, with bounded input/absence
controls and verified teardown. Native CI acceptance is pending; neither its
local fixture tests nor its source existence close the login gate.
