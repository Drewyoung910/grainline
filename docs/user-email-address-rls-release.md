# UserEmailAddress RLS release

## Scope

`UserEmailAddress` is private account history. The compatible application no
longer reads or writes the table directly. Four owner/service operations and
two account-deletion operations use six exact `SECURITY DEFINER` functions.
Production preparation and Phase A are accepted. Production has complete
current-row coverage, zero duplicate current owners, three supporting indexes,
the six reviewed function definitions, policyless RLS enabled without FORCE,
and zero direct runtime or PUBLIC table authority.

Phase A changed only the table authority boundary:

- revoked every `UserEmailAddress` table privilege from `PUBLIC` and
  `grainline_app_runtime`;
- enabled RLS without FORCE;
- created no policies; and
- retained exact runtime `EXECUTE` on the six reviewed functions.

The exact Phase A migration ran from main
`e935667852d1bcbae3084819182db689ceaf4c6f` after CI `37125414050`.
Protected run `37127420604` passed the exact ledger, catalog, and global grant
readbacks. Retain sanitized artifact `user-email-address-enable-37127420604`,
SHA-256
`6b364cf889cdf895f0dba8e97fde2d5c4a1a548f6e54e004a34c81a4fecf3a4f`.

Phase B is a separate posture-only candidate. It revalidates the exact Phase A
catalog and changes only `relforcerowsecurity` from false to true. It creates no
policy, grants no authority, changes no row or function, and keeps the six
fixed operations as the only runtime path.

## Accepted Phase A artifacts

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

The Phase A migration pins the exact prepared Production table owner, role
posture, row invariants, six table indexes, three supporting indexes, two
internal foreign-key triggers, six function bodies, and their ACL/security
metadata. It locks the table before checking and changing authority. Any
mismatch aborts the transaction before grants or RLS state change.

## Phase B FORCE candidate

- migration:
  `20261003030000_force_user_email_address_rls`
- migration SHA-256:
  `68bc032ecf38a63bd4ab9a219e315b69d8fa505bc3b99b6abf20e7d435812402`
- release tests:
  `tests/user-email-address-force-release.test.mjs`
- actual disposable database proof:
  `tests/user-email-address-force-postgres-proof.test.mjs`
- guarded Production workflow:
  `.github/workflows/user-email-address-force-production.yml`

The FORCE migration takes an access-exclusive lock, requires the exact
policyless Phase A predecessor, re-pins the owner, runtime-role posture, data,
indexes, triggers, function bodies, and ACLs, re-revokes table authority, and
then executes the single posture change. Any drift aborts the transaction.

## Proof

The actual Phase A and FORCE migrations have been executed in disposable
PostgreSQL-compatible proof against a prepared schema. Phase A reached
policyless ENABLE and removed all direct runtime table CRUD. Phase B reached
policyless FORCE, preserved the fixed function behaviors, and continued to
reject direct runtime table reads. A grant-drift fixture made the FORCE
preflight abort atomically while preserving the accepted Phase A posture.

CI runs the focused source and database proofs once, isolates the candidates
while historical release fixtures run, restores them, applies the five
prepared migrations in their existing scoped replay, then applies the actual
ENABLE and FORCE SQL in order and checks each resulting catalog before the
global grant audits. Historical Notification and Conversation/Message proofs
checksum-pin and isolate both successors so their older migration boundaries
remain meaningful.

## Production gate

After the FORCE candidate is merged, require one successful full push CI run
on the exact unchanged main commit. Then dispatch `UserEmailAddress FORCE
Production` with that exact commit, CI run, and confirmation
`force-reviewed-user-email-address-rls`.

The workflow verifies the recovered preparation and Phase A ledger, including
the single historical zero-step rolled-back row and all six accepted applied
rows. It requires zero incomplete migrations, hides only FORCE to prove that no
unrelated migration is pending, applies through Prisma, reads back the exact
ledger and catalog in read-only transactions, runs the global grant audit, and
retains sanitized evidence for 30 days. A restart after a successful apply
skips mutation and repeats the exact readbacks.

This boundary does not deploy application code, change credentials, create a
policy, or change any other table.

## Recovery

If the migration fails, PostgreSQL rolls back its transaction. Do not mark a
nonzero-step failure rolled back or retry blindly. Inspect the exact ledger and
catalog, correct source on a new exact-main release, and use a dedicated
recovery workflow if Prisma requires resolution.

Before Phase B, rollback of Phase A requires a separately reviewed transaction
that disables RLS and restores only the predecessor runtime table grants. After
Phase B, the narrow recovery is `NO FORCE ROW LEVEL SECURITY`, which returns to
the accepted policyless Phase A state while retaining zero direct runtime
authority. Any broader rollback remains separately reviewed; do not broaden
function ACLs or create direct PUBLIC authority.
