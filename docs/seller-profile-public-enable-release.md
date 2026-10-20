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

The behavior proof failed on the real 397-migration PostgreSQL 16 predecessor
with the exact expected difference:

- RLS was off;
- four runtime table grants remained; and
- runtime column authority was effective.

The same proof passed on the complete 398-migration candidate. It established:

- policyless ENABLE without FORCE;
- zero ordinary-runtime, staff-runtime or `PUBLIC` table/column authority;
- direct runtime SELECT, INSERT, UPDATE, DELETE and TRUNCATE denial;
- direct staff SELECT denial;
- unchanged policyless FORCE posture for `SellerProfilePrivate`; and
- passing public, owner, map, staff, service, checkout, account-deletion and
  retained-authority behavior scenarios after activation.

The retained callable catalog is complete at 98 authorities: 96 direct
PostgreSQL behavior proofs and two composed behavior proofs, with zero
source-only gaps. The source scanner remains at zero direct SellerProfile
operations and zero direct writes.

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

## Release blockers

The database candidate is locally compatible, but Production remains blocked
until all current `FIX_BEFORE_ACTIVATION` items are resolved and rechecked:

1. Reconcile any new Claude/audit allegations against the exact release head.
2. Add the exact-main protected ENABLE workflow, inspector and sanitized
   postflight only after the source candidate and the blockers above are
   accepted. FORCE remains a separate later release.

The prior exact-location blockers are closed in this source candidate. The
workshop map now uses explicit-submit city/state-or-ZIP search, rejects numeric
street addresses and queries outside that narrow shape before Nominatim,
discards street-level results, and never reverse-geocodes the dragged pin.
Existing map opt-ins remain approximate until the maker gives the new
coordinate-bound consent. Privacy and Terms copy now describe the exact public
surfaces and withdrawal behavior.

## Release order

1. Merge and deploy the compatible source/functions with predecessor grants
   unchanged.
2. Confirm the exact source deployment and all required exact-head checks.
3. Run the protected ENABLE migration and pooled-runtime postflight.
4. Observe public/owner/staff/service flows and preserve sanitized evidence.
5. Prepare FORCE only after ENABLE evidence is accepted.
