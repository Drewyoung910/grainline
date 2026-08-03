# DirectUpload activation production recovery

Status: corrected-migration PR #139 and recovery PR #140 are merged. The first
production recovery run stopped in its initial read-only migration-tree guard;
no recovery mutation ran and DirectUpload RLS remains off.

Read-only inspection run `30862128758` at exact main commit
`1cfc9c75f87c90fa82e989c4897a21fd9aa99d68` closed the historical-alias
timestamp uncertainty but found a second activation-preflight mismatch before
any recovery retry. It proved the current listing-variants row is the one
finished application and the historical full-timestamp alias has
`finished_at IS NULL`, one rollback marker and zero applied steps. The original
DirectUpload activation row is still unfinished, unrolled-back and zero-step;
the complete compatible table/function/grant posture is restored; the
transaction reported repeatable-read plus read-only; and
`productionChangedByInspection=false`.

The same live read-only preflight returned SQLSTATE `P0001`,
`DirectUpload runtime or cleanup role retains unreviewed role membership`.
The global production migration guard already requires `neondb_owner` to be a
non-inheriting, non-settable admin member of both `grainline_app_runtime` and
`grainline_direct_upload_cleanup_v2`. The corrected DirectUpload migration
currently allowlists that exact bootstrap edge only for the cleanup role, so
it still rejects the established runtime-role edge. Recovery remains blocked.
Any successor migration bytes must allow only the exact provider bootstrap
tuple for each restricted role, recursively reject any member beyond
`neondb_owner`, reproduce both edges in disposable PostgreSQL 16, refresh all
release hashes and recovery proofs, and pass another protected read-only live
preflight before production recovery is reconsidered.

Sanitized mode-0600 evidence
`direct-upload-activation-failure-inspection-1cfc9c75f87c90fa82e989c4897a21fd9aa99d68.json`
has SHA-256
`b881c9a64029c621b01e820975082b7a1eff4cfbd9b7851028724c41b72d708e`;
GitHub artifact `8874773325` is retained for run `30862128758`. It contains no
credentials, database rows, raw migration log or raw ledger rows.

The authorized isolated successor candidate permits only the exact
`cloud_admin`-granted, non-inheriting, non-settable admin edge from each
restricted role to `neondb_owner`. A recursive walk rooted separately at both
restricted roles rejects every other direct or transitive member. Its promoted
migration SHA-256 is
`1bceed7a5076f15ae5c9c46a89bbaecdf583953f7a1ff80b26a8b0e7c21157c4`;
the generator-equivalent disposable SHA-256 is
`6600e6b96bf1d151befb860bab2fa268199d3847b4e4b7ccb3be647ca44c4a8b`.
The disposable provider fixture now creates both exact edges and the focused
PostgreSQL proof rolls back every negative membership scenario before checking
zero residue. This preparation does not authorize merge or production
recovery; exact-head CI, the PostgreSQL 16 recovery proof and a fresh protected
read-only production preflight remain mandatory.

The first exact-head branch run, `30863620128`, passed the new seven-check
membership proof, including both exact bootstrap edges and all negative drift
cases. Its next recovery-posture step then failed because the older proof
helper still expected only the cleanup bootstrap edge. No resolve/replay step
ran and the workflow had no production credential. The helper now exports and
unit-tests the same exact two-edge contract used by the fixture before the
complete disposable recovery sequence is repeated.

The failed production activation remains unchanged. Production migration run
`30729632410` created one unfinished Prisma ledger row with the original
checksum, zero applied steps, no finish marker and no rollback marker. Both
owner-only read-only inspections proved the database transaction rolled back
fully and left the compatible pre-activation table, function and grant posture
intact. DirectUpload RLS is therefore still off in production.

The superseded cleanup-only membership preflight passed twice in disposable
PostgreSQL 16. Exact-head recovery proof run `30734098369` reproduced the original
zero-step failure, resolved only that disposable row, applied the corrected
bytes, and proved activated authority, migration status, grants and rollback.
The eventual production recovery was also required to bind an exact successful
main CI run for its release commit.

The isolated workflow head
`95943014716b4654b1654d740f601ae755ed1740` passed full PR CI run
`30757000208`. Corrected-migration PR #139 exact head
`d4a106d2bdf7e0af4c8fea9ca6c4770b2bfbdbdd` merged as exact main commit
`736bdc57d8ecac14dcac6690a386c96cf9e655e1`. Main CI run `30758315593`,
Conversation and Message RLS FORCE Proof run `30758315599`, and Notification
RLS FORCE Proof run `30758315577` all passed at that merge commit. PR #140 was
then retargeted to `main`; its three recovery-only commits remain a separate
review and merge boundary. The Vercel Preview status is expected to fail
closed on this operations-only branch; GitHub CI, including the ephemeral
PostgreSQL migrations, grants, RLS proofs, security audit and production
build, passed. A new exact successful main CI run was still required after the
future PR #140 merge before any production recovery dispatch.

Recovery PR #140 exact head
`e72bbfafd0539e9aefa2bb1ab09a94219c35c0c2` merged as main commit
`36484fcf02855308eac9d013307612afebb8f2e6`. Main CI run `30759433559`,
Conversation and Message RLS FORCE Proof run `30759433549`, and Notification
RLS FORCE Proof run `30759433526` all passed at that exact merge commit.
Authorized recovery run `30760097011` then verified all four run/commit
bindings but failed in the first repeatable-read, read-only inspection with
`production migration ledger names do not match the reviewed tree`. Every
resolve, migration, grant-convergence, status, audit and activated-proof step
was skipped. The run did not deploy or change database/provider state.

Read-only failure inspection run `30766662618` at exact main commit
`b814634bc0de9ea8e7c80972f13111bdf10e723d` identified the complete tree
delta: the reviewed tree contains 187 migration names, production contains 188,
no reviewed migration is missing, and the sole unexpected production name is
`20260423000000_add_listing_variants`. The original DirectUpload activation
row remains exact and zero-step, the compatible table/function/grant posture
remains restored, the transaction reported `read only`, and
`productionChangedByInspection=false`.

Repository history shows that commit `4ebb0502` renamed the listing-variants
migration from `20260423_add_listing_variants` to the unexpected full-timestamp
name and commit `477b403f` renamed the same bytes back about 94 minutes later.
The two historical files have identical SHA-256
`a54d0d3371a6149a683719963466305b449a6206ef8ddb4d5dc7eb0db1bb5d5e`.
Because production also contains the current reviewed name (it was not reported
missing), the ledger has both aliases.

Alias-proof PR #142 exact head
`db2d07a6d771d8382364af6df524b634ecc6fbc5` merged as exact main commit
`7d3cc70d4b1b0aa6513013a6d28c8a312357e67b`; main CI run `30767514448`
passed every migration, PostgreSQL authority, grant, RLS, test, audit and build
gate. Protected read-only run `30767685144` then proved the two exact alias
rows inside the same repeatable-read, read-only transaction:

- current `20260423_add_listing_variants` has one completed, non-rolled-back
  row, one applied step and the reviewed checksum;
- historical `20260423000000_add_listing_variants` has one rolled-back row,
  zero applied steps, zero incomplete rows and the same reviewed checksum; and
- no other migration-tree difference exists.

The diagnostic's provisional `exact` flag is false because it initially
accepted only two completed alias rows. The aggregate evidence instead proves
the safer historical shape: the renamed row was explicitly rolled back and
never applied a schema step. The original DirectUpload activation row and the
compatible RLS-off authority posture remain unchanged, and
`productionChangedByInspection=false`.

Recovery remains blocked from production execution. Isolated draft PR #143 now
contains the separately authorized verifier candidate: it admits only this one
checksum-matching, zero-step rolled-back historical alias while continuing to
reject every other missing, unexpected, incomplete, applied, step-count or
checksum-drifting ledger shape. Its PostgreSQL 16 workflow stages that exact
alias after the compatible baseline, proves it through the failed, resolved and
activated restart states, and has no production credential. Exact code head
`0c4a54e058a9d97faeba73563730c54ca88b11bb` passed full CI run
`30770032839` and disposable PostgreSQL 16 recovery proof run `30770031355`.
No merge or production recovery retry is authorized by this candidate.

An independent pre-merge review then tightened two aggregate-ledger
invariants. The historical alias must independently have `finished_at IS NULL`
as well as one rollback, zero applied steps and no incomplete row; a malformed
row with both finish and rollback timestamps cannot qualify. Every ordinary
predecessor must also have exactly one finished, non-rolled-back row and no
additional incomplete or rolled-back duplicate. The candidate fails closed on
either drift. Final exact-head proof runs are recorded on draft PR #143.

The same pre-merge review also requires migration-tree summaries to aggregate
by migration name rather than checksum. After a successful replay, Prisma
correctly retains the zero-step rolled-back failed activation row and adds the
completed corrected-checksum row under the same migration name. The verifier
must recognize that exact two-row activated state instead of rejecting its own
successful recovery postflight. A source-level regression guard pins the
name-only aggregation.

The disposable recovery workflow now triggers on production-verifier and
verifier-contract changes and runs that contract before its PostgreSQL stages.
This closes the coverage gap that previously let a production-verifier-only
change rely on full CI without entering the focused recovery workflow.

## Prepared read-only verifier

`scripts/direct-upload-activation-production-recovery.mjs` accepts only the
reviewed direct `neondb_owner` production credential and exact clean main
commit. It rejects runtime, cleanup and R2 credentials; binds the failed run,
disposable recovery proof, main CI run and recovery run IDs; verifies the
byte-pinned corrected migration; then opens a repeatable-read, read-only
transaction.

Before accepting any restart state, it also byte-pins the complete reviewed
migration tree and compares every migration directory with aggregate Prisma
ledger state. Every predecessor must have exactly one successful application
and no incomplete or rolled-back duplicate, there may be no unrecognized ledger
name, and the activation must be the sole pending migration until it is
activated.

The verifier recognizes only three exact restart states:

- `inspect` reports an exact original failed row, an exact resolved boundary,
  or the exact corrected activated boundary;
- `resolved` accepts only the original row marked rolled back with no corrected
  row and the complete compatible catalog; and
- `activated` accepts only the original rolled-back row plus one completed
  corrected row, policyless ENABLE plus FORCE on both service tables, zero
  runtime/cleanup table authority, and the exact 35-function source, mode and
  EXECUTE partition.

Every mode proves the production owner/runtime/SavedSearch baseline, cleanup
role attributes and provider-created membership edge. Compatible modes also
execute only the corrected migration's extracted role/function preflight inside
the read-only transaction. Evidence is sanitized, mode 0600 and contains no
database rows, logs, function source or credential.

## Exact wired recovery sequence

The isolated executable workflow shares the
`production-database-migrations` concurrency group and runs only from an exact
clean main commit in the protected Production environment. It must bind and
verify failed run `30729632410`, disposable recovery proof run `30734098369`,
and an exact successful main CI run for its release commit.

It must be restart-safe and use this ordering:

1. run `--inspect` read-only and stop on every unrecognized ledger or catalog
   state;
2. if and only if the state is `failed`, run Prisma `migrate resolve
   --rolled-back` for `20260801194000_enable_direct_upload_rls`;
3. run `--resolved` read-only before any replay;
4. if and only if the state is not already `activated`, run Prisma migrate
   deploy after proving the activation is the newest and only pending release;
5. converge the reviewed runtime and cleanup grants through `neondb_owner`;
6. run Prisma migration status and the global runtime grant/RLS audit;
7. run `--activated` read-only and upload only the sanitized phase evidence;
8. after the recovery workflow succeeds, run the already separate pooled
   runtime and cleanup-role activation postflights before accepting the rollout.

A runner interruption after step 2 leaves the exact `resolved` boundary and a
later run can continue from it. An interruption after step 4 can continue from
the exact `activated` boundary. A second failed corrected migration row is not
an accepted restart state and requires a fresh read-only investigation.

## Boundaries retained

The corrected migration/proof in PR #139 and recovery workflow in PR #140 are
merged. Recovery run `30760097011` was dispatched but stopped read-only before
the exact ledger resolve boundary. The original unfinished zero-step row and
compatible RLS-off DirectUpload posture therefore remain the expected
production state. The aggregate alias proof and isolated fail-closed verifier
candidate proofs are now complete. The next boundary is separate review and
merge; no recovery retry is accepted until exact-main CI passes and a new exact
production authorization is given.

The recovery must not deploy the app, enable Case evidence, schedule cleanup,
revoke Cloudflare tokens, change provider variables, or combine Case RLS. Those
remain separate releases. The generic Production Migrations guard remains
strict and must not be weakened to admit incomplete migrations.
