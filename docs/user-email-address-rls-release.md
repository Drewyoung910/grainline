# UserEmailAddress RLS release

## Scope

`UserEmailAddress` is private account history. The compatible application no
longer reads or writes the table directly. Four owner/service operations and
two account-deletion operations use six exact `SECURITY DEFINER` functions.
Production preparation is accepted with complete current-row coverage, zero
duplicate current owners, three supporting indexes, the six reviewed function
definitions, RLS disabled, zero policies, and the predecessor runtime CRUD
grants still present.

This release changes only the table authority boundary:

- revoke every `UserEmailAddress` table privilege from `PUBLIC` and
  `grainline_app_runtime`;
- enable RLS without FORCE;
- create no policies; and
- retain exact runtime `EXECUTE` on the six reviewed functions.

The table owner remains exempt during Phase A so the existing fixed functions
continue to work. FORCE is a later, separately reviewed release.

## Candidate artifacts

- migration:
  `20261003020000_enable_user_email_address_rls`
- migration SHA-256:
  `d61df27c1c565d6fffde2fea130eb27b2ef95e842dbffef5e6b2862cd57bcbee`
- catalog verifier:
  `scripts/user-email-address-authority-catalog.mjs`
- release tests:
  `tests/user-email-address-enable-release.test.mjs`
- actual disposable database proof:
  `tests/user-email-address-enable-postgres-proof.test.mjs`
- guarded Production workflow:
  `.github/workflows/user-email-address-enable-production.yml`

The migration pins the exact prepared Production table owner, role posture,
row invariants, six table indexes, three supporting indexes, two internal
foreign-key triggers, six function bodies and their ACL/security metadata. It
locks the table before checking and changing authority. Any mismatch aborts
the transaction before grants or RLS state change.

## Proof

The actual migration has been executed in disposable PostgreSQL-compatible
proof against a prepared schema. It reached policyless ENABLE, left FORCE off,
removed all direct runtime table CRUD, preserved the four active
UserEmailAddress function behaviors, and rejected direct runtime table reads.
A realistic parent/current-email mismatch caused the preflight to abort and
left RLS disabled with predecessor CRUD intact.

CI runs the focused source and database proofs once, isolates the candidate
while historical release fixtures run, restores it, applies the five prepared
migrations in their existing scoped replay, then applies the actual ENABLE SQL
and checks the resulting catalog before the global grant audit. Historical
Notification and Conversation/Message proofs checksum-pin and isolate the new
successor so their older migration boundaries remain meaningful.

## Production gate

After the candidate is merged, require one successful full push CI run on the
exact unchanged main commit. Then dispatch `UserEmailAddress ENABLE
Production` with that exact commit, CI run, and confirmation
`enable-reviewed-user-email-address-rls`.

The workflow verifies the recovered preparation ledger, including the single
historical zero-step rolled-back row and all five corrected applied rows. It
requires zero incomplete migrations, hides only this activation to prove that
no unrelated migration is pending, applies through Prisma, reads back the exact
ledger and catalog in read-only transactions, runs the global grant audit, and
retains sanitized evidence for 30 days.

This boundary does not deploy application code, change credentials, create a
policy, or enable FORCE.

## Recovery

If the migration fails, PostgreSQL rolls back its transaction. Do not mark a
nonzero-step failure rolled back or retry blindly. Inspect the exact ledger and
catalog, correct source on a new exact-main release, and use a dedicated
recovery workflow if Prisma requires resolution.

After a successful Phase A release, rollback requires a separately reviewed
transaction that disables RLS and restores only the four predecessor runtime
table grants. Do not use rollback to broaden function ACLs or create direct
PUBLIC authority.
