# DirectUpload FORCE-RLS activation release

Status on 2026-08-01: PR `#131` merged the byte-pinned activation release at
exact head `07c745bd0578a0020d14697c25ed4b6ca52da4a2` into main commit
`f23437779e101d6ec3beddf14d03abbf938ae000`. PR `#133` then repaired only the
two older focused FORCE-proof workflows and merged at exact head
`d3564724b3739b392960b48e9a5723f0ef2364ce` into main commit
`bd27a4b2397fb6b97ddf11eb5466f48a98ee1891`. Full main CI and both focused
FORCE proofs passed on `bd27a4b2`. Guarded production migration run
`30729632410` later attempted the activation from exact main
`9eeb7ceb828ac1a6f9817e270f2933237bd4cdfc`. Every release-byte and authority
guard passed, but Prisma stopped while applying the activation and surfaced
only the secondary PostgreSQL message `current transaction is aborted`.
Migration status, the final grant audit and both activation postflights did not
run. There is no accepted production activation claim. A dedicated owner-only,
repeatable-read failure inspector is being added to recover the original
ledger diagnostic and prove the post-failure catalog before any retry.

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
Main correction runs `30726387832` (Notification FORCE), `30726387838`
(Conversation/Message FORCE) and `30726387850` (full CI) all passed on exact
merge commit `bd27a4b2397fb6b97ddf11eb5466f48a98ee1891`.

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
bytes, the older disposable activation evidence was superseded for promotion.
Fresh exact-tree PostgreSQL 16 activation and rollback proofs then passed in
main runs `30726387832` and `30726387838`; full CI passed in `30726387850`.

## Activation-aware production postflight

The pre-activation pooled-runtime and cleanup-role operators intentionally
assert `DirectUpload` is still RLS-off and therefore cannot be reused after
activation. The isolated postflight release adds
`scripts/direct-upload-activation-production-postflight.mjs` with two strict
read-only modes:

- `--runtime` accepts only the reviewed pooled production `DATABASE_URL`,
  rejects every privileged or aliased database credential, proves the exact
  runtime role, policyless ENABLE plus FORCE table posture, zero DirectUpload
  table/column authority, all 35 source/signature/mode/ACL identities, direct
  denial, cleanup-function denial and fail-closed invalid-actor reads; and
- `--cleanup` accepts only the protected unpooled v2 cleanup-role URL and its
  digest, proves the exact three-function cleanup partition and all other
  catalog invariants, direct-table and runtime-function denial, then proves the
  cleanup lease reaches PostgreSQL's read-only `25006` fence without leasing or
  changing a row.

The cleanup mode runs in a dedicated `Production DirectUpload Cleanup`
workflow that never receives the owner URL, runtime URL or R2 credentials. The
runtime mode remains a separate exact-clean-commit local proof using only the
pooled runtime credential. Both bind evidence to the exact release, successful
main-CI and migration run ids, execute `BEGIN TRANSACTION READ ONLY`, roll back,
write only a fresh mode-0600 sanitized artifact and record
`productionChangedByPostflight=false`.

## Production gates still open

The compatible app retirement is live: deployment
`dpl_2o2yBehsStAiVWUhoj1LQTmZ9HJe` serves exact commit
`a5d54e79d9b8747936bd2a7850115705461d0fbf`, its deployed cron manifest omits
the old cleanup schedule, and the authenticated retired route returns 404.

Signed-in Cloudflare dashboard inspection on 2026-08-01 showed exactly the
existing account token `grainline-uploads` and active user token
`grainline-direct-upload-cleanup-v4`; the rejected `v3` user token was absent.
No raw access key or secret was displayed or retained. The accepted `v4`
cleanup-only credential had already passed the exact two-bucket
disposable-object proof in protected run `30710557050`. The credential gate is
accepted.

The activation-aware postflight branch must merge and pass exact-main CI before
the guarded production migration runs. A successful migration must be followed
by both postflight modes before the rollout is accepted. Case-evidence
enablement, cleanup scheduling, provider-variable changes and token retirement
remain separate releases and must not be bundled into this activation.

## Failed production activation evidence

Production Migrations run `30729632410` at exact main
`9eeb7ceb828ac1a6f9817e270f2933237bd4cdfc` passed checkout, locked install,
owner/source/role guards, every byte-equivalence verifier and Prisma generation.
It then selected only `20260801194000_enable_direct_upload_rls` and failed in
`npx prisma migrate deploy`. Prisma retained only the secondary aborted-
transaction error in the Actions log, so the run is failed evidence and must
not be treated as an activation or replayed blindly. The later status and grant
audit steps were skipped, and neither activation postflight was dispatched.

Read-only legacy-inspection run `30729803125` was also rejected, before writing
evidence, because that older operator deliberately pins the pre-retirement
dual-column Case attachment posture and therefore still requires
`CaseMessageAttachment.objectKey`. The retirement migration intentionally
removed that column. This is a stale-phase operator mismatch, not rollback
evidence and not a new database defect; it made no production change.

The recovery sequence is fail-closed: merge and run the dedicated read-only
failure inspector, require one exact unfinished activation ledger row, classify
the original stored Prisma diagnostic without retaining raw logs, and prove the
complete compatible pre-activation catalog apart from that ledger row. Only
then may a byte-preserving recovery mark that exact row rolled back and retry
the exact activation. Do not deploy, enable Case evidence, schedule cleanup,
revoke tokens or change provider variables during this recovery.

Read-only failure-inspection run `30731902991` at exact main
`4f56c3ba213d380b0eeb9bb94b51aab7e6a0a75b` proved the full activation
transaction rolled back. The exact migration row has the promoted checksum,
zero applied steps, no finish or rollback marker and is the only incomplete
row. `DirectUpload` remains RLS-off with compatible runtime CRUD;
`DirectUploadReference` remains policyless ENABLE plus FORCE with no runtime
CRUD; the 35-function compatible authority partition matches; and the
repeatable-read transaction was read-only. The inspection changed nothing.

Prisma's ledger `logs` value is empty (zero bytes, SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`),
so the first database error cannot be recovered from the ledger. The sanitized
mode-0600 evidence is
`direct-upload-activation-failure-inspection-4f56c3ba213d380b0eeb9bb94b51aab7e6a0a75b.json`,
SHA-256
`89250c0ac5d1d08f7fd86880c19e90ce153d9699e25673c7cfa628780b587b8e`;
GitHub artifact `8828241114` has archive SHA-256
`6bb5b224ba2c1c086cd12d9e502cfa104981dbba0945cf0fde5490e3c63b33a0`.

The follow-up diagnostic extends the same inspector without broadening its
authority: only the exact role and function preflight `DO` blocks are extracted
from the byte-pinned migration and executed as the final statement inside the
same read-only transaction. It fails before that query unless the one exact
failed ledger row, promoted checksum, read-only mode and compatible
pre-activation posture all match. PostgreSQL can therefore return the first
preflight SQLSTATE and allowlisted message directly while the transaction
prevents any write. Do not resolve or retry the migration until that result is
classified and the recovery operator is separately reviewed.
