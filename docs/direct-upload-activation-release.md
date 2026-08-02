# DirectUpload FORCE-RLS activation release

Status on 2026-08-01: refreshed on the isolated activation branch after the
ordinary-runtime cleanup retirement reached production at exact commit
`a5d54e79d9b8747936bd2a7850115705461d0fbf`. This activation release has not
been merged, dispatched, applied or deployed. `DirectUpload` remains in its
production-compatible RLS-off posture. `DirectUploadReference` remains a
policyless FORCE-RLS service table.

## Exact release artifact

- Production migration:
  `20260801194000_enable_direct_upload_rls`
- Promoted migration SHA-256:
  `41c2099157737e7457997d5ad71932671f5813dcbb436b699671b8af29458ffb`
- Disposable proof migration SHA-256:
  `b017fd8898b3aa901457977a5aa4f8fb2ac495546c59c348788722a6569d370d`
- Guard phase: `direct-upload-activation-reviewed`
- Reviewed production predecessor:
  `20260801175000_retire_direct_upload_compatibility_key`

The promoted migration differs from the disposable proof only in its
non-executable header and migration-directory name. The release verifier
regenerates the candidate, byte-compares the executable body, pins both
hashes, rejects the disposable migration name in production history and
requires this migration to remain the newest reviewed migration.

CI temporarily isolates only the activation directory, applies the compatible
tree through retirement, converges the same pre-activation runtime and cleanup
grants that already exist in production, restores the byte-pinned directory,
and lets Prisma apply it normally. This models the real external-role
predecessor without weakening the migration preflight or editing Prisma's
ledger by hand.

PR CI run `30716441830` / job `91412674837` is retained failed evidence. All
release-byte and phase guards passed, but a from-empty-cluster Prisma deploy
reached the activation before the externally managed cleanup-role grant had
been reproduced and failed closed on
`grainline_direct_upload_cleanup_lease`. It changed no production state. The
CI split above fixes the disposable-environment model; it does not relax or
change the byte-pinned production migration.

The next PR CI run `30716761313` / job `91413525569` proved that correction:
the compatible tree, both pre-activation grant convergers, the exact
activation migration, both activated grant convergers and every Case authority
proof passed. It then failed safely because the legacy-repair harness was
still scheduled after FORCE activation even though it proves only the
compatible RLS-off repair shapes. The harness is now kept in the compatible
window before the activation directory is restored; this is test sequencing,
not a change to production SQL or authority.

Push runs `30723862284` / job `91431938257` and `30724165993` / job
`91432731002` are also retained failed evidence. The workflow isolated the
promoted retirement and activation migrations before running static contracts
that derive their expectations from the complete migration tree. The first run
failed with `ENOENT` in the retirement-candidate contract; after a too-narrow
ordering correction, the second exposed the same class in the grant inventory.
All static contracts now run before any promoted migration is isolated, while
database proofs retain their original compatible and activated windows. A
regression assertion pins that boundary. These were CI orchestration defects;
no database authority proof failed and production was not contacted or
changed.

Post-merge main runs `30725212564` (Notification FORCE) and `30725212570`
(Conversation/Message FORCE) are retained failed evidence. Both older focused
workflows tried to apply the newly merged DirectUpload activation on a fresh
cluster before recreating the externally managed cleanup role and predecessor
grants, so the activation failed closed before either table-specific proof ran.
They now isolate the activation, apply the compatible tree, converge both
external roles, restore and apply the exact activation, reconverge grants, and
then run their original authority and rollback proofs. This changes disposable
CI orchestration only; it does not alter migration bytes or production state.

## Authority boundary

The migration takes an advisory transaction lock and ACCESS EXCLUSIVE locks
on both service tables, validates the two non-bypass service roles and exact
predecessor catalog, then:

- enables and forces RLS on both `DirectUpload` and
  `DirectUploadReference`;
- retains zero policies and zero direct table or column authority for PUBLIC,
  `grainline_app_runtime` and `grainline_direct_upload_cleanup_v2`;
- exposes exactly 17 validated fixed functions to ordinary runtime;
- exposes exactly three lease/complete/fail functions to the cleanup role;
- leaves the other 15 DirectUpload functions private;
- withholds `grainline_direct_upload_record_private_message` from runtime;
- validates all 35 function identities, owners, modes, pinned search paths,
  source hashes and ACLs before and after the change.

The exact disposable PostgreSQL 16 sequence already proved activation,
direct denial, fixed-function authority, cleanup authority and database-first
rollback in run `30709645196` / job `91394729233`. That is proof of the SQL
shape, not authorization to apply this promoted production migration. The
Extra-High refresh added a migration-local preflight proving the SECURITY
DEFINER owner is a superuser or has BYPASSRLS before policyless FORCE RLS can
commit. The guarded production runner already proved that property for
`neondb_owner`; the SQL-local check makes the invariant fail closed even if a
future operator bypasses that wrapper. Because this changes the exact release
bytes, the older disposable activation evidence is superseded for promotion
until a fresh PostgreSQL 16 activation and rollback proof passes.

## Production gates still open

The compatible app retirement is live: deployment
`dpl_2o2yBehsStAiVWUhoj1LQTmZ9HJe` serves exact commit
`a5d54e79d9b8747936bd2a7850115705461d0fbf`, its deployed cron manifest omits
the old cleanup schedule, and the authenticated retired route returns 404.

Before this migration may merge or run, independently confirm or revoke the
rejected Cloudflare `v3` R2 token. The accepted replacement `v4` cleanup-only
credential passed the exact two-bucket disposable-object proof in protected
run `30710557050`; that does not prove the rejected credential is absent.

After the credential gate is recorded, merge and production migration remain
separate exact-commit decisions. A successful migration must be followed by
the pooled-runtime and cleanup-role postflight. Case-evidence enablement,
cleanup scheduling, provider-variable changes and token retirement are
separate releases and must not be bundled into this activation.
