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

### Runtime-lock preflight correction integration

Merged-main CI `36638383343` completed successfully on `dedca7d9`. The first
approved Production runtime-lock run `36641938086` failed safely before SQL
because its preflight used `information_schema.column_privileges` to detect
explicit column grants; that view repeated the expected table-level grants for
every column. Exact correction commit
`2152b46d7dc9b81ca92abec7754a6671cb599269` now inspects
`pg_attribute.attacl` directly in preflight while retaining the effective
postflight access check. It is draft PR #478 and is privately backed up.

The FORCE successor has also been integrated on top of that exact correction
at private commit `5a9c469f7e7f80d6a7e3ce91d8080e76882cbd0a`, backed up at
`recovery/order-core-force-with-column-acl-fix-5a9c469f-20260929`. Seventeen
focused runtime-lock/FORCE assertions, the FORCE release verifier, workflow
formatting, migration checksum, and `git diff --check` pass. The FORCE
migration bytes remain unchanged. This integrated successor is still private
and has not been merged or applied.

The protected FORCE workflow now also proves that the successful runtime-lock
run's exact `head_sha` is identical to or an ancestor of the reviewed FORCE
release commit. This closes reuse of a successful but unrelated or future
runtime-lock run while allowing the expected later FORCE source merge. The
guard and its focused assertions are privately backed up at exact commit
`0cc09325b462d9c5776df9c7cd80d137518c7947` on branch
`recovery/order-core-force-with-column-acl-fix-0cc09325-20260929`. Twelve
directly affected assertions, workflow formatting, and `git diff --check`
pass. No migration, deployment, alias, credential, or Production state changed.

After correction PR #478 merged, the complete private FORCE source was rebuilt
without conflicts on exact main
`c7c0c3a3eed1a61d0ed55ce5f43fab9a13c49aa6`. The rebuilt candidate is exact
commit `217f98e781c95c2c8db916b25a338b877d08b7b4`, tree
`b726876d3424851a11d5b76d6633d540e2d53006`, privately recoverable at
`recovery/order-core-force-c7c0c3a3-217f98e7-20260929`. Twelve directly
affected runtime-lock/FORCE assertions pass, the FORCE release verifier passes,
workflow formatting and `git diff --check` pass, and the migration SHA-256
remains `1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139`.
The candidate remains private and unapplied while main CI `36645095118` and the
corrected Production runtime-lock gate complete.

Merged-main CI `36645095118` passed all 461 steps on exact main `c7c0c3a3`.
Corrected protected Production runtime-lock run `36647432346` then completed
successfully at `2026-09-29T23:53:44Z`, applying only migration
`20260929130000_revoke_order_item_shipping_quote_runtime_access` and accepting
its exact postflight. The FORCE predecessor gate is now satisfied. The next
unfinished implementation is publication and exact-head review of private
candidate `217f98e7`, followed by its own merged-main CI and a separately bound
protected FORCE dispatch.

Exact candidate `217f98e781c95c2c8db916b25a338b877d08b7b4` is now published to
public deployment-disabled branch
`codex/order-core-force-c7c0c3a3-20260929`; public main remained exact
`c7c0c3a3eed1a61d0ed55ce5f43fab9a13c49aa6` at publication. Automatic
approval review rejected opening the prepared public draft PR because its
description would disclose the FORCE migration, protected workflow, and
internal release gates without a separately explicit disclosure approval. No
PR was created and no FORCE Production action occurred. The next required
input is exact approval for that public draft PR and its conditional
exact-head merge; Production FORCE remains a later separately bound dispatch.

The user then explicitly approved that disclosure and conditional merge. Draft
PR #479 is open and mergeable with exact head
`217f98e781c95c2c8db916b25a338b877d08b7b4` against exact base
`c7c0c3a3eed1a61d0ed55ce5f43fab9a13c49aa6`. Its required runs are full CI
`36648833604`, account-deletion concurrency `36648833557`, paid-repair lock
proof `36648833592`, and staff-bootstrap TLS login `36648833546`. All must pass
on the unchanged exact head and public main must remain the exact base before
the PR can leave draft or merge. Opening the PR did not dispatch FORCE or
change Production.

Initial exact-head full CI `36648833604` failed safely at the early read-only
FORCE source-package step. CI had already isolated the accepted runtime-lock
migration, while the FORCE verifier correctly required that predecessor source
directory to be present; no database or Production step ran. The three
specialized checks passed.

Exact two-file correction `79f29a12b97f3db6e1109a76463d0f6b2f2342d6`
temporarily restores that exact isolated migration only for the FORCE package
tests and uses an exit trap to return it to the same isolated path before later
historical composition. A local simulation with the predecessor physically
isolated passed all 12 package/postflight tests and proved it was re-isolated;
workflow formatting, `git diff --check`, and the unchanged FORCE migration
checksum passed. It is privately backed up at
`recovery/order-core-force-c7c0c3a3-79f29a12-20260930` and is now the exact PR
#479 head. Replacement required runs are full CI `36649328787`, concurrency
`36649328781`, paid-repair lock `36649328834`, and staff TLS login
`36649328778`, still against unchanged base `c7c0c3a3`.

All four replacement checks passed on exact head `79f29a12`. Full CI completed
at `2026-09-30T00:43:53Z`, including broad tests, security audit, reviewed
successor restoration, application of only the accepted child runtime lock in
disposable PostgreSQL, application of only Core `Order` FORCE, the
FORCE-hardened runtime-grant audit, and the Production build. Final public
readback kept PR #479 mergeable and draft, its head `79f29a12`, its base and
public main `c7c0c3a3`, and all four checks green. Because the earlier explicit
merge approval named predecessor head `217f98e7`, the corrected exact head
requires a refreshed merge authorization before leaving draft.

## Exact forward sequence

1. Complete: correction PR #478 merged as exact main `c7c0c3a3`, merged-main
   CI `36645095118` passed, and protected runtime-lock run `36647432346`
   completed with accepted postflight.
2. Current: require all four replacement checks to pass on exact PR #479 head
   `79f29a12` against unchanged base `c7c0c3a3`. Mark ready and merge only
   under that immutable binding.
3. Require successful merged-main push CI, then re-read public main, the exact
   successful runtime-lock run, and the exact currently live zero-direct
   deployment.
4. Obtain one explicit Production FORCE dispatch authorization bound to that
   exact release commit, exact CI, exact runtime-lock run, exact deployment,
   migration checksum, and confirmation. Apply no other migration.
5. After the protected FORCE run succeeds, run the separate read-only pooled
   runtime postflight with phase `force`, save mode-0600 sanitized evidence,
   and write the final accepted Core Order checkpoint.

Do not combine steps 2 or 4 with unrelated migrations. Do not rerun accepted
Core ENABLE, credential rotation, staged smoke, or completed Order corrections.
