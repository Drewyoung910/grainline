# SellerProfile public compatible preparation release

Status: isolated source candidate only. No Production migration, deployment,
grant change, RLS change or provider action is authorized or applied by this
document.

## Scope

The public SellerProfile conversion depends on 64 additive preparation
migrations from
`20261019010000_prepare_seller_profile_public_map_authority` through
`20261020235997_prepare_seller_profile_actor_report_resource_target`. They add
or replace purpose-bound functions, exact-map consent evidence, and supporting
triggers while leaving public `SellerProfile` RLS off and its predecessor
runtime CRUD grants in place. The current application remains compatible while
this prefix is installed.

The policyless ENABLE migration
`20261020240000_enable_seller_profile_rls` is explicitly outside this release.
It remains pending until the converted application is deployed and its
compatible flows are accepted.

## Immutable source manifest

`scripts/seller-profile-public-preparation-manifest.mjs` pins the name and
SHA-256 digest of every preparation plus the later ENABLE migration. The
manifest rejects a missing, duplicated or changed migration and identifies the
exact first, final-preparation and ENABLE boundaries. It is shared by local,
CI, inspector and protected-workflow tests instead of relying on a manually
maintained migration count.

## Protected Production workflow

`.github/workflows/seller-profile-public-preparation-production.yml`:

- runs only as a first-attempt manual dispatch on exact `main` in the
  Production environment and the shared database-migration concurrency group;
- binds the requested commit to current `main`, an exact successful full CI
  run, the exact Conversation/Message FORCE proof job, and every required
  exact-main push workflow;
- verifies all 64 immutable migration sources before any owner connection;
- uses the direct-owner connection guard and a repeatable-read, read-only,
  count-only inspector;
- accepts only zero preparations, an exact successful prefix, or all 64;
- rejects checksum drift, duplicate success, an unresolved failed attempt, a
  non-prefix ledger, premature ENABLE, RLS/grant drift, or private-companion
  drift;
- moves ENABLE outside `prisma/migrations`, proves that only the reviewed
  preparation suffix is pending, and invokes `prisma migrate deploy` once;
- restores ENABLE source even when an earlier release step fails;
- then requires ENABLE to be the only pending migration, reads back all 64
  exact successes and unchanged predecessor posture, runs the global grant
  audit, and stores sanitized preflight/postflight evidence.

The workflow does not deploy application code and cannot ENABLE or FORCE RLS.
A failed migration attempt remains failed closed; a later retry requires the
ordinary reviewed Prisma resolution procedure rather than silently rewriting
the ledger.

## Evidence

Nine manifest, inspector and workflow behavior/structure checks pass. The
complete 415-migration PostgreSQL 16 proof invokes the Production inspector at
two real-schema boundaries:

1. immediately before the first public SellerProfile preparation, where it
   reads `ready` with all 64 reviewed preparations pending; and
2. immediately before policyless ENABLE, where it reads `prepared` with none of
   those 64 pending and confirms the unchanged predecessor RLS/grant posture.

That same full-chain run exercises the public, owner, staff, service,
checkout, deletion, listing-card, bounded historical broadcast-label, exact
staff verification-target, actor-bound review-vote target, participant-bound
conversation-listing target used by both conversation entry surfaces, retained
conversation-context card/link authority, actor-bound listing/review report
target and retained-authority flows through policyless ENABLE.

## Release order

1. Merge the compatible source on exact green `main`. Git-triggered Vercel
   deployment remains disabled.
2. Separately authorize and run the protected preparation workflow for that
   exact main commit and accept its sanitized postflight.
3. Build and promote the converted runtime from the same exact main commit.
4. Verify the canonical deployment and compatible flows while RLS remains off.
5. Separately authorize the existing protected ENABLE workflow.
6. Observe and accept ENABLE evidence before preparing FORCE.

This ordering prevents the converted application from calling absent functions
and prevents ENABLE from revoking the predecessor table grants before the
converted runtime is live.
