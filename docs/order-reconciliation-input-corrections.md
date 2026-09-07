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
or connection values. Full-schema CI acceptance of this new harness is pending.

The separate reservation repair draft is deliberately excluded: its own
owner-bound FORCE-table release and runtime proof remain a separate gate.

PGlite role tests are local engine behavior tests, not real pooled-runtime
production proof. Acceptance of full-schema PostgreSQL 16 composition, exact
database/role/ledger release binding, final-candidate runtime-login proof, and production
acceptance remain open. Do not relax a historical function hash to accept
these successors. Preserve the distinct reservation-repair and label-outcome
release gates in their linked runbooks and the ordered completion plan.
