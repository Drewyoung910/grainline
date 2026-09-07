# Order staff mutation authority

Status: locally implemented and PostgreSQL-proven; database-first candidate only.
No migration, deployment, RLS posture, table grant or production state changed.

## Product and concurrency audit

The admin Order panel supports three bounded staff decisions: clearing a
review flag, recording that a purchased carrier label was externally voided,
and appending a staff note. The predecessor authorized the staff member in the
application and then performed direct Order read/compare/write sequences.

The transitions themselves remain useful and correctly scoped, but policyless
Order RLS requires the database to own their row selection and concurrency.
The label transition must never bypass an active clawback, and every successful
transition must retain its audit row atomically.

## Accepted design

Three fixed `SECURITY DEFINER` operations each accept one live staff actor and
one exact Order. They require the separately authenticated
`SESSION_USER = grainline_staff_read_runtime`, then revalidate EMPLOYEE/ADMIN,
banned and deleted state in PostgreSQL and lock the Order before deciding:

- mark-reviewed changes only `reviewNeeded=true` with no active label clawback;
- record-label-voided changes only a purchased label with no active clawback,
  appends a database-timestamped fixed explanation and marks review needed; and
- append-note accepts only 1..2,000 trimmed staff characters and appends them
  under a database-derived UTC timestamp.

Both note operations cap the complete stored note at 10,000 characters. Every
successful mutation inserts its exact `AdminAuditLog` row in the same function
and transaction. Status outputs are a closed enum and expose no Order data.
The historical role and environment names contain `staff_read`, but the role's
current contract is exactly two bounded projections plus these three bounded
mutations. It has no table, sequence, schema-create or default authority.
Ordinary `grainline_app_runtime` and `PUBLIC` receive no execution authority.

The application calls all three operations only through the isolated
`ORDER_STAFF_READ_DATABASE_URL` client. The Server Action repeats the Clerk,
live staff-row, rate-limit and signed session-bound Admin-PIN checks before it
uses that client. Layout/UI gating alone is not treated as action authority.

## Release order

1. Review all predicates, status semantics, session-role checks and audit
   inserts.
2. Create and separately authenticate the authority-free staff login; install
   its isolated application credential without granting functions yet.
3. Apply the three functions database-first as part of the byte-pinned Order
   compatible prefix, then converge the isolated role to exactly five
   operations: two projections and these three mutations.
4. Prove ordinary-runtime denial even with a forged staff ID, explicit-grant
   drift denial through the in-function session check, label-clawback fencing,
   length limits, atomic audit, replay behavior and direct-table denial.
5. Deploy and smoke the compatible app before revoking Order CRUD.

Rollback is application-first because the candidate app calls these functions.

## 2026-09-07 validation checkpoint

Focused static and PostgreSQL-engine coverage passed 37 checks with zero
failures. The full local suite passed 4,279 checks, skipped 12 explicitly
environment-gated checks, and failed zero of 4,291 total across 536 suites.
TypeScript and lint passed; lint emitted only the existing
`jsx-ast-utils` unresolved `TSNonNullExpression` advisory. Draft and staged
migration bytes are identical at SHA-256
`7e55a48ff1cd731201aa1bfd20670a9241dabda42620762eaefab04e4d6ee54a`.

These are local candidate results. The real separate-login PostgreSQL 16 CI
proof and exact-head broad CI remain outstanding until this checkpoint is
pushed; no local result is described as production or provider evidence.
