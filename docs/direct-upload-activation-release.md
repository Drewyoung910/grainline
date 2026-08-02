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
run. There is no accepted production activation claim. Dedicated owner-only,
repeatable-read inspectors later proved the transaction rolled back completely
and recovered the exact migration preflight error before any retry.

## Exact release artifact

- Production migration:
  `20260801194000_enable_direct_upload_rls`
- Failed original migration SHA-256:
  `41c2099157737e7457997d5ad71932671f5813dcbb436b699671b8af29458ffb`
- Corrected reviewed migration SHA-256:
  `810ecc8b7ab121ff13c517f5bd71ee71754cdf6421f25a71f10e3eb73c99aa71`
- Disposable proof migration SHA-256:
  `1db96ec58d7cfd9e53967c0fc1698f03679acfcf77ef30b6ee36b6daaf160554`
- Guard phase: `direct-upload-activation-reviewed`
- Reviewed production predecessor:
  `20260801175000_retire_direct_upload_compatibility_key`

The corrected reviewed migration differs from the disposable proof only in its
non-executable header and migration-directory name. The release verifier
regenerates the candidate, byte-compares the executable body, pins both
hashes, rejects the disposable migration name in production history and
requires this migration to remain the newest reviewed migration.

The original checksum remains pinned separately as failed evidence. Changing
the migration bytes is allowed only because read-only run `30731902991` proved
the original row has zero applied steps and the whole transaction rolled back.
The corrected bytes change only the membership preflight described below; a
disposable PostgreSQL recovery proof must prove failed-row resolution and
corrected replay before any production recovery is considered.

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
then may a reviewed recovery mark that exact row rolled back and apply the
corrected activation. Do not deploy, enable Case evidence, schedule cleanup,
revoke tokens or change provider variables during this recovery.

Read-only failure-inspection run `30731902991` at exact main
`4f56c3ba213d380b0eeb9bb94b51aab7e6a0a75b` proved the full activation
transaction rolled back. The exact migration row has the promoted checksum,
zero applied steps, no finish or rollback marker and is the only incomplete
row. `DirectUpload` remains RLS-off with compatible runtime CRUD;
`DirectUploadReference` remains policyless ENABLE plus FORCE with no runtime
CRUD; the 35-function compatible authority partition matches; and the
repeatable-read transaction was read-only. The inspection changed nothing.

Later authorized recovery run `30760097011` stopped in its initial read-only
migration-tree guard before any resolve, deploy or grant step. Follow-up
read-only run `30766662618` at exact main
`b814634bc0de9ea8e7c80972f13111bdf10e723d` proved the sole tree difference is
one production-only historical name,
`20260423000000_add_listing_variants`: reviewed count 187, ledger count 188,
no reviewed names missing. Commits `4ebb0502` and `477b403f` renamed and then
restored the byte-identical `20260423_add_listing_variants` directory. The
inspection retained only aggregate names/counts, ran repeatable-read/read-only,
left the exact failed DirectUpload row and compatible RLS-off posture intact,
and changed no production state.

Alias-proof PR #142 exact head
`db2d07a6d771d8382364af6df524b634ecc6fbc5` merged as exact main commit
`7d3cc70d4b1b0aa6513013a6d28c8a312357e67b`; exact-main CI run
`30767514448` passed. Protected read-only inspection run `30767685144`
subsequently proved both rows share reviewed SHA-256
`a54d0d3371a6149a683719963466305b449a6206ef8ddb4d5dc7eb0db1bb5d5e`.
The current name has one completed non-rolled-back row and one applied step;
the historical full-timestamp alias has one rolled-back row, zero applied
steps and zero incomplete rows. Thus the extra name is a never-applied rename
artifact, not a second schema application. The DirectUpload activation row
remains unfinished with zero steps, RLS remains off, and the inspection changed
nothing. Recovery remains blocked until its verifier is separately reviewed to
accept only this exact historical alias shape.

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
prevents any write. Its schema-version-2 artifact explicitly retains neither
the raw ledger log nor the raw live error. Do not resolve or retry the migration
until that result is classified and the recovery operator is separately
reviewed.

Follow-up read-only run `30732821707` at exact main
`a1b59157fc1fedcbb3ef9d6e0217a2ffec4e190e` executed only those two preflight
blocks and returned SQLSTATE `P0001`: `DirectUpload runtime or cleanup role
retains inbound or outbound role membership`. The failed row and complete
compatible posture remained exact and `productionChangedByInspection=false`.

The cause is a release-preflight defect, not unsafe live authority. PostgreSQL
16 automatically recorded `neondb_owner` as a member of
`grainline_direct_upload_cleanup_v2` when the LOGIN/NOINHERIT role was created:
grantor `cloud_admin`, `ADMIN=true`, `INHERIT=false`, `SET=false`.
Provider-remediation, provision and cleanup-worker proofs already accept only
that exact non-effective bootstrap edge (or no edge); the activation migration
incorrectly rejected every inbound edge. The corrected preflight preserves
zero runtime memberships and zero cleanup parent memberships, permits only
that exact provider-forced edge, rejects every other direct edge, and rejects
any transitive cleanup member beyond `neondb_owner`.

The sanitized schema-version-3 evidence is preserved mode 0600 as
`direct-upload-activation-failure-inspection-a1b59157fc1fedcbb3ef9d6e0217a2ffec4e190e.json`,
SHA-256
`10ffcb64168c3e98aefcb7261682f423910fd8116d367451877ea8f7702cf3a2`.
GitHub artifact `8828545633` has archive SHA-256
`658ec7b8e6cab80e5b9ddf1a6903e41c2c05c9cda1dee22048db3a6e01c6d0d8`.
No resolve, migration retry, deployment, RLS change or provider change ran.

Disposable PostgreSQL 16 recovery run `30733990797` / job `91459182538`
passed at exact branch head
`c38b9ac37c0b32b7bbf029ea1fa72db3dad5e995`. It reproduced the exact original
checksum failure with zero applied steps, proved the compatible table and grant
posture, marked only that disposable ledger row rolled back, applied the
corrected checksum as a second row, re-proved the exact provider bootstrap
edge, migration status, final global grant audit, activated authority and
database-first rollback. It used only loopback `grainline_ci`; no production
credential or persistent provider state was available.

Four earlier recovery-proof runs are retained failed harness evidence:

- `30733611929` tried to attribute a grant to a non-bootstrap fixture that did
  not possess a real `ADMIN OPTION` dependency;
- `30733684748` and `30733763559` proved that `SET ROLE` and `SET SESSION
  AUTHORIZATION` do not recreate PostgreSQL 16's bootstrap-superuser grantor
  catalog semantics; and
- `30733878697` reproduced the edge correctly, then proved the cleanup-role
  converger must run through the declared `neondb_owner` identity rather than
  the separate `ci` migration owner.

All four failed before the disposable resolve/replay step and changed no
production state. The passing harness now starts the disposable cluster with
`cloud_admin` as its bootstrap superuser, keeps Prisma migrations owned by
`ci`, and uses a separate loopback `neondb_owner` only for the cleanup-role
converger. This mirrors the three production responsibilities without granting
one test identity ambiguous authority.

Exact-head repeat run `30734098369` passed again at documentation head
`d4a106d2bdf7e0af4c8fea9ca6c4770b2bfbdbdd`, and full CI run `30734066701`
passed at the same head. The production recovery design is recorded in
`docs/direct-upload-activation-production-recovery-plan.md`. Its read-only,
restart-state verifier and executable workflow are prepared on an isolated
branch under wiring-only authorization. Draft PR #140 was initially stacked on
corrected migration/proof PR #139 so those changes were not duplicated against
`main`. Exact workflow head `95943014716b4654b1654d740f601ae755ed1740`
passed full PR CI run
`30757000208`; its expected Vercel Preview guard failure did not deploy the
operations-only branch. PR #139 exact head
`d4a106d2bdf7e0af4c8fea9ca6c4770b2bfbdbdd` then merged as main commit
`736bdc57d8ecac14dcac6690a386c96cf9e655e1`. Main CI `30758315593`,
Conversation and Message FORCE proof `30758315599`, and Notification FORCE
proof `30758315577` all passed at that merge commit. PR #140 exact head
`e72bbfafd0539e9aefa2bb1ab09a94219c35c0c2` later merged as main commit
`36484fcf02855308eac9d013307612afebb8f2e6`; exact-main CI `30759433559` and
focused FORCE proofs `30759433549` / `30759433526` passed.

Authorized production recovery run `30760097011` verified the exact release,
failed-run, disposable-proof and main-CI bindings, then failed safely in the
first repeatable-read, read-only inspection: aggregate production Prisma
migration names did not equal the reviewed directory tree. All ledger-resolve,
migration, grant, status, audit and activated-proof steps were skipped. No app
deployment, RLS change, provider change or other production mutation ran.
Production therefore still has the original unfinished zero-step row and
compatible RLS-off DirectUpload posture. The next step is a protected
aggregate-only migration-tree delta inspection; do not weaken or replay the
recovery before that discrepancy is classified.
