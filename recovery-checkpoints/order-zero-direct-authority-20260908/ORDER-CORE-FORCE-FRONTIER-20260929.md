# Core Order FORCE frontier — 2026-09-29

This is a sanitized continuation checkpoint. It contains no credential, raw
database URL, session value, row data, or synthetic fixture value.

## Current Production posture

Core `Order` RLS is enabled in Production with zero policies and no ordinary
runtime direct table or column authority. FORCE remains disabled. The accepted
source of truth is
`ORDER-CORE-RLS-ENABLE-PASSED-C09C678F-20260928.md`; do not repeat ENABLE or
its accepted runtime postflight.

## Immediate predecessor: item and shipping-quote runtime lock

Merged PR #477 carried exact head
`ae4f332ba93758d21c2e75fd5824bf4dfc7b067b` against exact base
`19e0cece5a72d86df2b22c739f70bb6fb36d1656` and produced exact main merge
commit `dedca7d9fd7b7f7c64587af688c922d11ae44192`. Its change stages only migration
`20260929130000_revoke_order_item_shipping_quote_runtime_access` and its
guarded Production workflow, plus the audit/provisioning contracts required to
keep those grants closed after application. The head is privately recoverable
as `recovery/order-item-quote-runtime-lock-ae4f332b-20260929`.

The first published head's three specialized checks passed, but exact-head full CI `36627116812`
failed at the late global grant audit. The disposable database had restored the
accepted Core Order ENABLE source without applying those accepted bytes, so the
audit correctly saw predecessor Order CRUD/no RLS instead of the Production
ENABLE posture. No product assertion, migration-specific proof, or Production
state failed.

A two-file CI correction at commit
`7cc7bd06277ecc764508bc17950f9c41dd8184f1`, tree
`0b9f89fca4f885671ecc679050d12f4140742556`, applies the exact already-accepted
Core Order ENABLE predecessor in the disposable database before the runtime
lock and its global audit. Nine focused assertions and workflow formatting
pass. It is privately recoverable as
`recovery/order-item-quote-runtime-lock-7cc7bd06-20260929` and was published as
exact PR #477 head `7cc7bd06`. Its three specialized checks passed, but full CI
`36631883561` failed early because the historical ENABLE workflow test still
asserted that the migration path appeared exactly twice; the new accepted
predecessor application correctly made it appear three times.

The semantic test correction is complete at commit
`8fca8d6fe8be7b06dd7eb54146ab88a3feb20f43`, tree
`1e34dde1d00588e0bc940df181e48f22e6bef087`. It asserts the actual ordering:
restore accepted ENABLE source, apply accepted ENABLE to the disposable
database, then run the runtime-lock audit. Eighteen directly affected
assertions pass, and it is privately recoverable as
`recovery/order-item-quote-runtime-lock-8fca8d6f-20260929`. It is the exact
public PR #477 head. Its three specialized checks have passed; exact-head full
CI `36632606634` passed the broad tests, security audit, and every database
step through successor restoration, then failed at step 449 while replaying
the accepted Core Order ENABLE migration. The preceding staff-login proof had
correctly dropped its disposable staff role during cleanup, so ENABLE rejected
the missing role identity. No product, migration, or Production assertion
failed.

A two-file CI-only correction is complete at local commit
`ae4f332ba93758d21c2e75fd5824bf4dfc7b067b`, tree
`a64ceb9897abb341a0bba96af1285d0ea89d8096`. It recreates the exact restricted
disposable staff identity, runs the existing staff grant provisioner, and
asserts that this restoration occurs between the final predecessor and ENABLE.
Eleven focused runtime-lock/ENABLE assertions pass, workflow formatting passes,
and `git diff --check` passes. It is privately recoverable as exact remote branch
`recovery/order-item-quote-runtime-lock-ae4f332b-20260929`; it is the exact
public PR #477 head. All four checks passed, including exact-head full CI run
`36636202493`, and the PR merged. Merged-main CI run `36638383343` is in
progress on exact commit `dedca7d9`. The Production migration has not been
authorized or applied.

## Prepared FORCE source

The isolated successor has been integrated onto exact merged runtime-lock main
`dedca7d9fd7b7f7c64587af688c922d11ae44192` at local commit
`3c9c6f454cb81f54bb212b913924747c97237eb4`, tree
`eb2780ed29ecfb3de627d0248df4269ad4047c12`. The integration retained main's
newer staff-role restoration and omitted two superseded CI-only commits. It is
privately backed up at exact remote branch
`recovery/order-core-force-integrated-3c9c6f45-20260929`; private remote
readback matches the exact commit.

The successor:

- stages byte-pinned migration `20260929160000_force_order_rls` with SHA-256
  `1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139`;
- changes only `public."Order"` from enabled/no-FORCE to enabled/FORCE;
- fails closed unless the ordinary runtime role has the complete reviewed
  `NOSUPERUSER NOINHERIT LOGIN NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS` posture and no unreviewed membership path;
- enforces the same exact restricted posture and membership boundary for the
  isolated staff role before trusting its six bounded SECURITY DEFINER entry
  points;
- fails closed unless Production owner `neondb_owner` owns Core Order, is
  `NOSUPERUSER BYPASSRLS`, and has no other active owner session; disposable
  CI must instead use its expected superuser owner;
- adds a manual, Production-environment workflow bound to exact main, exact
  successful main CI, a successful item/quote runtime-lock Production run, and
  an exact currently live zero-direct deployment;
- requires the exact accepted ENABLE and runtime-lock ledger rows and rejects
  any other pending migration before applying FORCE;
- takes short fail-fast locks on Core Order and both child tables, and refuses
  FORCE unless both child tables retain the exact accepted runtime-lock
  catalog with no PUBLIC/runtime table or column authority;
- verifies the owner-visible catalog, absence of every non-owner table/column
  ACL on Core Order and both runtime-locked child tables, and the global
  grant/RLS inventory after the change;
- runs the global runtime-grant audit against the exact pre-FORCE posture before
  applying FORCE, with the pending FORCE source temporarily isolated so that
  the audit cannot mistake it for an already-applied migration;
- retains the separate pooled ordinary-runtime read-only postflight, which
  already supports `ORDER_CORE_RLS_POSTFLIGHT_PHASE=force`;
- changes no application route, credential, deployment, alias, or provider.

Verification on the exact integrated tree: 21 focused
ENABLE/FORCE/postflight/runtime-lock assertions pass; both changed workflows
pass Prettier/YAML formatting; the migration bytes retain SHA-256
`1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139`;
the release verifier passes; and `git diff --check` passes. No broad suite was
repeated locally. Merged-main CI is separately proving the runtime-lock
predecessor before this private FORCE source can be published.

The FORCE commit is not public, merged, or applied to Production.

## Exact forward sequence

1. Complete: exact head `ae4f332ba93758d21c2e75fd5824bf4dfc7b067b`
   passed all four checks and merged through PR #477 as exact main commit
   `dedca7d9fd7b7f7c64587af688c922d11ae44192`.
2. Require successful merged-main CI run `36638383343`, then bind one explicit Production
   runtime-lock dispatch to the exact merge, exact CI run, and exact currently
   live deployment. Apply no other migration.
3. After the runtime-lock Production result is accepted, re-read the prepared
   FORCE source at exact private commit `3c9c6f45`, bind it to that result, and
   publish a deployment-disabled public PR after explicit authorization. Merge
   only on unchanged exact head/base and passing checks.
4. Require successful merged-main CI, then obtain one explicit Production
   FORCE dispatch authorization bound to the exact release commit, exact CI,
   exact successful runtime-lock run, and exact live deployment.
5. After the protected FORCE run succeeds, run the separate read-only pooled
   runtime postflight with phase `force`, save mode-0600 sanitized evidence,
   and write the final accepted Core Order checkpoint.

Do not combine steps 2 or 4 with unrelated migrations. Do not rerun accepted
Core ENABLE, credential rotation, staged smoke, or completed Order corrections.
