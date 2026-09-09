# Order staff mutation authority

Status: locally implemented and PostgreSQL-proven; database-first draft only.
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
one exact Order. They revalidate EMPLOYEE/ADMIN, banned and deleted state in
PostgreSQL and lock the Order before deciding:

- mark-reviewed changes only `reviewNeeded=true` with no active label clawback;
- record-label-voided changes only a purchased label with no active clawback,
  appends a database-timestamped fixed explanation and marks review needed; and
- append-note accepts only 1..2,000 trimmed staff characters and appends them
  under a database-derived UTC timestamp.

Both note operations cap the complete stored note at 10,000 characters. Every
successful mutation inserts its exact `AdminAuditLog` row in the same function
and transaction. Status outputs are a closed enum and expose no Order data.
Runtime receives only function EXECUTE and no new table authority.

## Release order

1. Extra-High review all predicates, status semantics and audit inserts.
2. Apply the three functions database-first as a byte-pinned migration.
3. Prove staff denial, label-clawback fencing, length limits, atomic audit,
   replay/unchanged behavior and direct-table denial in PostgreSQL.
4. Deploy the compatible app before revoking Order CRUD.

Rollback is application-first because the candidate app calls these functions.
