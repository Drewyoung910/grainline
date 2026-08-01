# DirectUpload FORCE-RLS activation release

Status on 2026-08-01: prepared on an isolated branch only. This release has
not been merged, dispatched, applied or deployed. `DirectUpload` remains in
its production-compatible RLS-off posture. `DirectUploadReference` remains a
policyless FORCE-RLS service table.

## Exact release artifact

- Production migration:
  `20260801194000_enable_direct_upload_rls`
- Promoted migration SHA-256:
  `8afb997dde6c0feb605cf366ea30a5f3dfdde4a7505c2cf2b6f2c98a43ffe40d`
- Disposable proof migration SHA-256:
  `e725b852945dde6ac8b4b40799da8fb209e6a246fe2969dffe5d5907cf05ff61`
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
shape, not authorization to apply this promoted production migration.

## Production gates still open

Before this migration may merge or run, independently confirm or revoke the
rejected Cloudflare `v3` R2 token. The accepted replacement `v4` cleanup-only
credential passed the exact two-bucket disposable-object proof in protected
run `30710557050`; that does not prove the rejected credential is absent.

After the credential gate is recorded, merge and production migration remain
separate exact-commit decisions. A successful migration must be followed by
the pooled-runtime and cleanup-role postflight. Case-evidence enablement,
cleanup scheduling, provider-variable changes and token retirement are
separate releases and must not be bundled into this activation.
