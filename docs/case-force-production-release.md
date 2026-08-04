# Case-family FORCE RLS release

Prepared 2026-08-04 on isolated branch
`agent/case-force-release-20260804`. This package has not been merged or
applied. Production remains at the accepted policyless Phase A state: RLS is
enabled without FORCE on `Case`, `CaseMessage` and
`CaseMessageAttachment`, with zero policies and zero direct runtime table or
column authority.

## Exact release unit

- Migration: `20260804191000_force_case_rls`
- Reviewed FORCE draft SHA-256:
  `2620be10dba8e1c9074742f925e7f146ce2a8f4acaea4b6a6dd88e0a0b92b4d9`
- Reviewed production membership correction SHA-256:
  `9332c0a5e2139944c41e5c386ec130f5e8c0e22dfcd439fde9af6413fc6c5839`
- Promoted migration SHA-256:
  `531bb44a9be15b8817baf717c09a4293f4aaa53ce3cabda8ae8311eb2f61a9a0`
- Reviewed rollback draft SHA-256:
  `dc6ead925a61509465925d880f6338d0494ab583b9c38dda012f0eeea6e0a59d`
- Complete 189-migration tree SHA-256:
  `120721e84b25ca66c25e61bdbaf10451c7dfd363a072fa3a9c11675ee1d9003e`
- Guard phase: `case-force-reviewed`

The transaction changes only `relforcerowsecurity` for the three Case-family
tables. It changes no row, policy, grant, function, trigger, constraint,
private ledger or provider resource. It takes the existing Case rollout
advisory lock plus an `ACCESS EXCLUSIVE` lock, rejects owner-session overlap,
and accepts only the exact live Phase A predecessor: the reviewed owner and
runtime role posture, all three owner-held policyless ENABLE/NO FORCE tables,
zero direct runtime/PUBLIC table or column authority, exactly 27 fixed runtime
functions, and the reviewed 5-DEFINER/3-INVOKER invariant function partition.
The historical reviewed FORCE draft required a membership-free runtime role.
The promoted bytes apply a separately pinned correction for the proven Neon
bootstrap shape only: `neondb_owner` may be the `cloud_admin`-granted admin
member of `grainline_app_runtime` only when that edge cannot inherit or set the
runtime role. Every other direct or transitive membership still fails closed.

## Accepted predecessor

Policyless Case Phase A is live from exact main
`a9abaec057ab80a455a81503080bcd3b9027c4be`. Main CI `30937766824`, guarded
Production Migrations run `30939836526` and the pooled-runtime read-only
postflight all passed. Sanitized production evidence is retained outside the
repository as
`case-activation-production-postflight-a9abaec057ab80a455a81503080bcd3b9027c4be.json`
with SHA-256
`117590a50316ff0efb783c490e95aa31014221a4b93e4372f5f6995c5a15ee15`.
The durable Phase A record is `docs/case-activation-production-release.md`.

## Proof and workflow ordering

The release verifier reconstructs the FORCE migration from the byte-pinned
historical draft plus the separately pinned production membership correction,
verifies the exact Phase A predecessor bytes, pins the separate FORCE rollback,
and seals the complete migration tree. CI then physically removes both the
Phase A and FORCE migrations before its first Prisma deploy. It:

1. applies and proves the compatible authority, invariant, read-mode and
   DirectUpload predecessor tree;
2. restores and applies Phase A alone, reconverges grants, audits the catalog,
   and proves policyless ENABLE/NO FORCE plus direct runtime denial;
3. restores and applies FORCE alone, reconverges grants, verifies migration
   status, audits the final catalog, and proves policyless ENABLE/FORCE plus
   the same direct runtime denial; and
4. runs TypeScript, lint, the complete repository suite, dependency audit and
   production build.

The guarded Production Migrations workflow accepts only
`case-force-reviewed`, verifies the exact source/owner/role boundary and the
same byte-pinned FORCE release before `prisma migrate deploy`, then verifies
migration status and the global grant/RLS catalog. It does not deploy
application code or alter Vercel, Cloudflare, Clerk, Neon configuration,
tokens or Case-evidence flags.

## Separate later boundaries

Case evidence remains disabled. Enabling its UI/API feature flag, private R2
route smoke, DirectUpload cleanup scheduling, cleanup-token retirement, any
provider-variable change, and any application deployment remain separate
operations. Order, payment and shipping RLS remain the next separately audited
sensitive-data group after the Case-family database boundary is fully
accepted.

After a guarded production FORCE migration, run a fresh pooled-runtime
read-only FORCE postflight from the exact successful main release and retain
sanitized evidence before declaring the Case-family RLS group complete.
