# User authority successor Production release

Date: 2026-10-07

## Scope

This release applies only the eight reviewed `User` authority migrations after
the accepted public-seller-state predecessor. The migrations add bounded
security-definer authorities and lifecycle snapshots; they do not enable or
force `User` row-level security, create `User` policies, revoke predecessor
table CRUD, deploy application code, or change provider credentials.

The eight migrations are, in order:

1. `20261006010000_prepare_user_staff_ban_authorities`
2. `20261006020000_prepare_user_account_deletion_authorities`
3. `20261006030000_prepare_user_relationship_authorities`
4. `20261007010000_prepare_user_public_blog_state`
5. `20261007020000_prepare_user_public_review_commission_state`
6. `20261007030000_prepare_user_block_email_authorities`
7. `20261007040000_prepare_user_follower_authorities`
8. `20261007150000_prepare_user_staff_admin_labels`

## Admission and recovery

`.github/workflows/user-authority-successors-production.yml` requires a manual,
first-attempt dispatch from exact current `main`, successful full push CI for
that commit, and a successful first-attempt User installed-catalog inspection
on the same commit. Migration bytes are pinned by SHA-256 before the protected
owner connection is opened.

The owner preflight accepts only a checksum-exact contiguous prefix from the
eight-migration Production predecessor through the complete sixteen-migration
catalog. This makes a new first-attempt dispatch restart-safe after a completed
subset while rejecting a gap, unfinished ledger row, body drift, overload,
grant drift, unexpected table grant, policy, or premature `User` RLS posture.

Before mutation, the workflow temporarily hides only the reviewed successors
that the catalog preflight proved pending, then requires full-tree Prisma status
to show that every other migration is already applied. It restores those exact
directories before one full-tree deploy. Because the reviewed staff migration
is pinned as the repository's latest migration, only the missing members of the
byte-pinned eight-migration successor set can run. A complete-prefix preflight
skips the mutation step. After apply, the workflow requires full-tree migration
status, the global grant audit, and a read-only complete-catalog inspection
proving all 53 functions and the expected 34-runtime/19-private partition. Both
preflight and postflight artifacts contain only sanitized metadata and digests.
The artifact step runs even after a failed mutation or postflight so any
successfully written preflight evidence remains available for recovery.

## Decision

**GO** for source review together with the installed-catalog inspection so the
two separately approved workflow runs can use one immutable main commit.

**NO-GO** for dispatch until the read-only inspection succeeds and its evidence
is read back. This source does not authorize Production SQL, application
deployment, User grant revocation, policies, ENABLE, or FORCE. Compatible-app
promotion and smoke remain after this additive authority release; final User
grant/policy design, ENABLE, and FORCE remain separate later releases.
