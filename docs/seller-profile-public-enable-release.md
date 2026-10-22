# SellerProfile public policyless ENABLE release

Status: accepted in Production. Policyless ENABLE is live; FORCE remains a
separate, unapplied release.

## Production acceptance

The reviewed compatible application commit
`b56e226d327347fe155aa07ded0bde999ca929be` is live as Vercel deployment
`dpl_DPS8x8vfkQqandrvAgVWxRLCgT43`. Protected workflow run `39869437488`
applied only migration `20261020240000_enable_seller_profile_rls` on
2026-10-22 after exact-main CI run `39863855920` and Conversation/Message FORCE
proof run `39863855882` passed.

The retained postflight records policyless ENABLE with NO FORCE, zero policies,
zero non-owner table or column grants, no runtime/staff column authority, and
the unchanged policyless FORCE posture of `SellerProfilePrivate`. The strict
live-deployment verification and focused public route smoke passed after the
migration. The migration changed catalog posture and grants only; it did not
change SellerProfile rows or application behavior.

## Candidate

The candidate migration is
`20261020240000_enable_seller_profile_rls`. It is deliberately limited to the
first posture stage:

- require the direct migration-owner session and the reviewed restricted-role
  attributes;
- require the exact final preparation migration and checksum;
- require the predecessor table to have RLS off, no policies, exactly the four
  non-grantable ordinary-runtime CRUD privileges and no column grants;
- require `SellerProfilePrivate` to remain policyless FORCE;
- enable policyless RLS without FORCE;
- revoke every table privilege from `PUBLIC`, the ordinary runtime and the
  isolated staff runtime; and
- read back policyless ENABLE, zero non-owner table/column authority and the
  unchanged private-companion posture in the same transaction.

The canonical runtime-role convergence script now preserves predecessor CRUD
only while SellerProfile RLS is cleanly off. Once ENABLE or FORCE is present,
every provisioning replay revokes direct table authority again. A partial RLS
or policy posture makes provisioning refuse to continue.

## Evidence

The database behavior proof failed on the real 397-migration PostgreSQL 16 predecessor
with the exact expected difference:

- RLS was off;
- four runtime table grants remained; and
- runtime column authority was effective.

The same proof passed on the complete 398-migration candidate. It established
the prepared authority scenarios below, but it did not execute every remaining
Prisma relation or raw-SQL caller after ENABLE:

- policyless ENABLE without FORCE;
- zero ordinary-runtime, staff-runtime or `PUBLIC` table/column authority;
- direct runtime SELECT, INSERT, UPDATE, DELETE and TRUNCATE denial;
- direct staff SELECT denial;
- unchanged policyless FORCE posture for `SellerProfilePrivate`; and
- passing public, owner, map, staff, service, checkout, account-deletion and
  retained-authority behavior scenarios after activation; and
- UTC-stable Follow, Founding Maker and owner-bootstrap writes while the proof
  session is deliberately set to `America/Los_Angeles`.

The retained callable catalog is complete at 98 authorities: 96 direct
PostgreSQL behavior proofs and two composed behavior proofs, with zero
source-only gaps. The source scanner remains at zero direct SellerProfile
operations and zero direct writes, but independent exact-head review found 84
relation accesses, 15 raw-SQL accesses, five relation-bearing query factories
and eight opaque relation predicates that still need base-table authority.
Those are activation blockers rather than accepted coverage.

The live grant auditor now binds the public-table posture to the exact applied
preparation and ENABLE migration checksums. Before ENABLE it continues to
expect the predecessor CRUD grants; after the exact ENABLE ledger is present it
requires policyless ENABLE, NO FORCE and zero direct table authority. The audit
passed against the complete disposable 398-migration PostgreSQL 16 database.

The database-first rollback was applied to the disposable PostgreSQL 16
candidate and read back successfully. It restores RLS-off/no-policy posture
while keeping all direct runtime, staff and `PUBLIC` grants revoked. Returning
from that rollback to ENABLE requires a separately reviewed forward operation;
the rollback never restores broad predecessor CRUD.

The protected workflow is
`.github/workflows/seller-profile-enable-production.yml`. It refuses owner
database access until it has bound all of the following to the exact current
`main` commit:

- the successful full push CI run;
- the successful Conversation and Message FORCE proof and its `proof` job;
- every required exact-main push workflow, with no failed, cancelled or pending
  latest run;
- the exact compatible Vercel deployment on every canonical alias; and
- the immutable ENABLE migration checksum while that migration remains latest.

Before any deployment or owner database access, the workflow also runs
`scripts/assert-seller-profile-enable-source-ready.mjs`. It requires zero
direct, relation, raw-SQL, relation-factory and target-opaque SellerProfile
consumers. At the current candidate head it deliberately refuses dispatch with
`direct=0; relations=6; rawSql=2; relationFactories=3;
targetOpaquePredicates=0`.

The count-only, read-only inspector accepts only the reviewed predecessor or
the completed policyless ENABLE state. It verifies the direct owner session,
exact migration ledger, restricted roles, public-table grants and RLS posture,
and the private companion's unchanged policyless FORCE and zero-direct posture.
The workflow admits exactly the reviewed migration as pending, is restart-safe,
runs the global grant audit afterward and preserves mode-0600 sanitized
preflight/postflight evidence. It contains no application deployment and no
FORCE step.

The 71 compatible predecessor migrations have their own earlier protected
workflow and immutable manifest, documented in
`docs/seller-profile-public-preparation-release.md`. That workflow holds this
ENABLE migration out of the Prisma tree, installs only an exact restart-safe
preparation suffix, restores ENABLE, and requires ENABLE to be the sole pending
migration afterward. Git-triggered Vercel deployment is disabled, so the
converted runtime is promoted only after the preparation postflight succeeds.

## Next release

The ENABLE evidence is accepted. The separate FORCE candidate is documented in
`docs/seller-profile-public-force-release.md`. FORCE still requires its own
exact-head CI, independent database/security review, protected workflow and
separate Production authorization.

The prior exact-location blockers are closed in this source candidate. The
workshop map now uses explicit-submit city/state-or-ZIP search, rejects numeric
street addresses and queries outside that narrow shape before Nominatim,
discards street-level results, and never reverse-geocodes the dragged pin.
Existing map opt-ins remain approximate until the maker gives the new
coordinate-bound consent. Privacy and Terms copy now describe the exact public
surfaces and withdrawal behavior.

## Release order

1. Compatible preparations, source deployment and policyless ENABLE are live.
2. Preserve the accepted ENABLE evidence and compatible deployment identity.
3. Review the posture-only FORCE release on exact main.
4. Run FORCE only through its protected workflow after separate authorization.
