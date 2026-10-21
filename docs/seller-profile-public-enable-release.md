# SellerProfile public policyless ENABLE release

Status: isolated candidate only. No Production migration, deployment, grant
change, ENABLE or FORCE is authorized or applied by this document.

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
`direct=0; relations=78; rawSql=15; relationFactories=5;
targetOpaquePredicates=2`.

The count-only, read-only inspector accepts only the reviewed predecessor or
the completed policyless ENABLE state. It verifies the direct owner session,
exact migration ledger, restricted roles, public-table grants and RLS posture,
and the private companion's unchanged policyless FORCE and zero-direct posture.
The workflow admits exactly the reviewed migration as pending, is restart-safe,
runs the global grant audit afterward and preserves mode-0600 sanitized
preflight/postflight evidence. It contains no application deployment and no
FORCE step.

The 47 compatible predecessor migrations have their own earlier protected
workflow and immutable manifest, documented in
`docs/seller-profile-public-preparation-release.md`. That workflow holds this
ENABLE migration out of the Prisma tree, installs only an exact restart-safe
preparation suffix, restores ENABLE, and requires ENABLE to be the sole pending
migration afterward. Git-triggered Vercel deployment is disabled, so the
converted runtime is promoted only after the preparation postflight succeeds.

## Release blockers

The database candidate and release machinery are locally compatible, but
Production remains blocked until the release head is concrete and rechecked:

1. Convert the 78 relation accesses, 15 raw-SQL accesses, five relation-bearing
   query factories and two opaque relation predicates to the reviewed
   bounded projections and purpose-bound operations. The source-readiness gate
   must read back zero in all five classes before ENABLE can reach a secret or
   database connection.
2. Repeat the Claude/audit reconciliation immediately before dispatch. The
   2026-10-19 pass closed the Austin default-pin, weak input-boundary and broad
   ship-from client-payload defects plus the three session-timezone write
   defects in source.
3. Install the compatible preparation functions while the predecessor
   application and grants remain live, then deploy the converted source.
4. Require successful exact-head CI and proof workflows, verify that exact
   deployment on the canonical aliases, and obtain the separately authorized
   Production ENABLE dispatch.
5. Accept the sanitized postflight and observed compatible flows before
   preparing the separate FORCE release.

The prior exact-location blockers are closed in this source candidate. The
workshop map now uses explicit-submit city/state-or-ZIP search, rejects numeric
street addresses and queries outside that narrow shape before Nominatim,
discards street-level results, and never reverse-geocodes the dragged pin.
Existing map opt-ins remain approximate until the maker gives the new
coordinate-bound consent. Privacy and Terms copy now describe the exact public
surfaces and withdrawal behavior.

## Release order

1. Merge the compatible preparation source while predecessor grants remain
   unchanged and apply only the reviewed preparation migrations.
2. Deploy the converted source after those fixed functions are present.
3. Confirm the exact source deployment and all required exact-head checks.
4. Run the protected ENABLE migration and pooled-runtime postflight.
5. Observe public/owner/staff/service flows and preserve sanitized evidence.
6. Prepare FORCE only after ENABLE evidence is accepted.
