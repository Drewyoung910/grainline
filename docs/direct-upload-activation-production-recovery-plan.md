# DirectUpload activation production recovery

Status on 2026-08-04: recovery and restricted-role acceptance are complete.
Restart-safe production recovery run `30877508811` accepted the exact activated
ledger, converged the reviewed grants and passed migration status, the global
grant/RLS audit and activated owner proof. PR `#150` merged the ledger-safe
postflight verifier as exact main
`b98490ab09bcf395b45af04750d9b5606dbff7d5`; exact-main CI
`30881395864`, the pooled-runtime postflight and protected cleanup-role run
`30924905247` all passed. Neither postflight changed production state.
DirectUpload activation acceptance is closed; Case evidence, cleanup
scheduling, provider changes and token retirement remain separate releases.

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

The corrected executable head
`595098e9f19af737a2f70f5567a99c00a6d15c55` then passed the complete
disposable PostgreSQL 16 recovery sequence in run `30863895210` / job
`91851469212`: membership drift proof, exact old-failure reproduction,
compatible rollback posture, disposable resolution boundary, corrected
activation, dual-row ledger, grant convergence, activated authority and
database-first rollback all passed. Full PR CI run `30863897027` / job
`91851475050` passed at the same executable head, including TypeScript, lint,
2,680 tests, security audit and the production build. These are branch-only
proofs and do not authorize merge or production recovery.

Extra-High review found no SQL-policy defect, but it found that the executable
membership proof exercised direct-member, parent-membership and option-drift
rejection asymmetrically. Commit
`99eab93713a7bfcbbea450c97e5e0b1192f4e3c9` expands that proof from seven to
14 checks: both restricted roles now reject unexpected direct members and
parent roles, and each role independently rejects drift in `ADMIN`, `INHERIT`
and `SET` while every negative scenario rolls back and leaves zero role
residue. Exact-head disposable PostgreSQL 16 run `30865221934` / job
`91855473752` passed the full failure, resolution, activation, grant,
authority and rollback sequence. Exact-head CI run `30865224129` / job
`91855481718` passed all database proofs, TypeScript, lint, 2,680 tests,
security audit and the production build. This is stronger branch-only review
evidence; it still does not authorize merge, ledger resolution, production
recovery, deployment or any provider change.

The same review then found a separate fail-closed operator mismatch: the
production recovery workflow and verifier still pinned superseded disposable
proof `30734098369`, whose branch contained the cleanup-edge-only candidate.
The isolated successor now pins successful two-edge proof run `30865542314` /
job `91856468869`, branch
`agent/direct-upload-activation-runtime-bootstrap-preflight-20260803`, and
exact proof head `5f8f761ead7619baf5037dcdce595bfc4e877329`. Static contracts reject the
old run, branch or SHA. This changes only branch-side recovery evidence
bindings and does not authorize or execute the production recovery workflow.
The corrected operator contract then passed exact-head disposable PostgreSQL
run `30866643733` / job `91859847929` and full CI run `30866645901` / job
`91859854716` at commit
`dfa9bad6f17abe7079ee955be097f68bc345ba01`. The focused run re-proved the
complete failure, resolution, activation, grant, authority and rollback
sequence; CI also passed TypeScript, lint, 2,680 tests, security audit and the
production build.

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
verify failed run `30729632410`, disposable recovery proof run `30865542314`,
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
production state. The aggregate alias proof and fail-closed verifier proofs are
complete. PR #146 exact head
`4ea7c2f47480795d74ad4dafc5461d5ed060555c` merged as exact main commit
`3b5efc3e4c56f3918e2b0d6191685a044354f092`. Exact-main CI run
`30867712101`, Conversation and Message RLS FORCE Proof run `30867712139`,
and Notification RLS FORCE Proof run `30867712080` all passed.

Protected Failure Inspection run `30869536394` / job `91868485683` then ran
against that exact main commit and failed migration run `30729632410`. Inside a
repeatable-read, read-only transaction it proved all of the following:

- the original activation ledger row still has failed checksum
  `41c2099157737e7457997d5ad71932671f5813dcbb436b699671b8af29458ffb`,
  no finish or rollback marker and zero applied steps;
- the reviewed recovery migration remains byte-pinned separately to
  `1bceed7a5076f15ae5c9c46a89bbaecdf583953f7a1ff80b26a8b0e7c21157c4`;
- the corrected role/function preflight passes live for both restricted roles,
  including only the proven non-effective `neondb_owner` bootstrap edges;
- the sole migration-tree difference remains the exact listing-variants alias:
  one completed canonical row plus one same-checksum, zero-step rolled-back
  historical row;
- `DirectUpload` remains policyless with RLS and FORCE off,
  `DirectUploadReference` remains policyless ENABLE plus FORCE, and the
  compatible grant/function posture is restored; and
- `productionChangedByInspection=false`.

The sanitized artifact is
`direct-upload-activation-failure-inspection-3b5efc3e4c56f3918e2b0d6191685a044354f092`;
the GitHub artifact archive digest is
`8ad0d9e1132bf6241c5eb6f894748eac43aca2013a00b10a56c9d81a7a173a9a`.
No production recovery has been dispatched from this commit. The successful
CI and inspection satisfy the read-only prerequisites for reconsidering the
restart-safe recovery, but they do not themselves authorize the ledger resolve,
migration replay, grant convergence or activation.

## First authorized restart attempt

Authorized recovery run `30871995372` / job `91875721796` used the exact
reviewed bindings above. Its initial repeatable-read, read-only proof classified
the original failed state; Prisma marked only that zero-step row rolled back;
the resolved repeatable-read, read-only proof passed with zero incomplete
migrations and only the corrected activation pending. Prisma then applied
`20260801194000_enable_direct_upload_rls` successfully. The migration itself
committed the reviewed policyless ENABLE plus FORCE table posture, table
revokes, function EXECUTE partition and its in-transaction catalog postflight.

The following grant-convergence step failed before either `psql` command
connected. The owner URL correctly retains `sslmode=verify-full`, but the step
did not supply libpq's required `PGSSLROOTCERT=system`; libpq therefore looked
for a runner-local `~/.postgresql/root.crt` and exited with code 2. Migration
status, the global grant/RLS audit and the activated owner proof were skipped.
The run did not deploy the app, enable Case evidence, schedule cleanup, revoke
tokens or change provider variables. Its sanitized artifact archive digest is
`cf9ecb53dce537ab8982dde8a3cae9d42ec6e4f708c1c6b4e42323211eb74136` and
contains exact `inspect=failed` and `resolved=resolved` evidence; it contains no
activated proof.

This is the same libpq trust-root requirement already proven by cleanup-role
provisioning run `30398188163`. The narrow workflow correction supplies
`PGSSLROOTCERT=system` only to the production `psql` convergence step, retaining
hostname and certificate-chain verification without changing the protected
URL or Node connection behavior. A repository-wide inventory test now requires
that setting on every protected owner-URL `psql` step. Do not declare the
activation accepted until a restart classifies the exact activated ledger,
converges grants, passes migration status and the global grant audit, and writes
the activated owner proof.

## Second authorized restart attempt

PR #148 exact head `e8f3f8c4d420fcaaec0f72b985da8bfaf34bdfdc`
merged as exact main `4fd7f60108237cabaaa9c88d360d7dd87e5a66cc`.
Exact-main CI run `30872943444` passed every migration, PostgreSQL, grant,
TypeScript, lint, test, audit and build gate. Authorized recovery run
`30873322551` / job `91879565759` verified the exact failed-run, disposable-proof
and main-CI bindings, then stopped in `--inspect` before every mutation-capable
step. It did not run Prisma generation, resolve or deploy a migration, connect
through `psql`, converge grants, deploy the app, enable Case evidence, schedule
cleanup, revoke tokens or change provider variables. The evidence writer was
not reached, so the artifact uploader correctly reported no file rather than
publishing partial evidence.

The read-only failure reported identity-argument drift for exactly 28 of the 35
reviewed functions. Those are exactly the 28 functions with input arguments;
the seven no-argument functions passed. The reviewed activation catalog and
disposable activation/rollback proofs deliberately use type-only identities
from `pg_catalog.oidvectortypes(procedure.proargtypes)`, for example `text,
text`. The production recovery reader and the shared cleanup/postflight reader
instead used `pg_catalog.pg_get_function_identity_arguments(procedure.oid)`,
which includes declared parameter names such as `p_user_id text, p_key text`.
This is a verifier representation defect, not evidence that the live function
types, source, owner, execution mode or ACL drifted.

The isolated correction changes only those two comparison readers to the
reviewed type-only representation. Human-readable unexpected-privilege
diagnostics may retain `pg_get_function_identity_arguments`; they do not compare
against the type-only catalog. The disposable PostgreSQL 16 recovery sequence
must call both exact production readers against the real named-parameter
functions and prove all 35 normalized signatures in failed, resolved and
activated modes. Static contracts must reject reintroducing the named-argument
reader at either comparison boundary. This correction does not authorize a
merge or recovery retry.

The recovery must not deploy the app, enable Case evidence, schedule cleanup,
revoke Cloudflare tokens, change provider variables, or combine Case RLS. Those
remain separate releases. The generic Production Migrations guard remains
strict and must not be weakened to admit incomplete migrations.

## Successful activated-state recovery acceptance

PR #149 exact head `faff8af9908bc129b176ad66b2dab6d1c2bc76e3`
corrected the two type-only signature readers and merged as exact main commit
`64409058d0023a434b36f1af31655caeb4915ac3`. Exact-main CI run
`30875687956` passed, and the additional exact-main disposable PostgreSQL 16
recovery run `30877377186` passed the complete failed, resolved, activated,
grant, authority and rollback sequence.

Authorized recovery run `30877508811` / job `91891843696` then classified the
live database as the exact already-activated restart state. It therefore
skipped ledger resolution, the resolved-state proof and migration replay. It
converged the reviewed runtime and cleanup-role grants, proved zero pending or
incomplete migrations, passed the global runtime grant/RLS audit and passed
the activated owner proof. Both `DirectUpload` and `DirectUploadReference`
were policyless ENABLE plus FORCE, the runtime and cleanup roles had no table
CRUD, all 35 function identities matched and the proof transaction was
repeatable-read plus read-only.

Sanitized artifact `8880075629` has archive digest
`5c21c3d283a8bb1170bbca17ce957fc84d1bf55280a9a8bb50fd1c755f38365b`.
Its inspect and activated evidence files have SHA-256 values
`ca452ceb69e769d9d22be7670da9799a5b2670fd7f960cbf71f1c96b0e58b3ab`
and
`a1c5f6bd54ea3a2235eb0292e2cb86c132b58e6c0561055eb490c501faa1da54`.
They retain no credential, row, migration log or function source. Recovery
did not deploy, enable Case evidence, schedule cleanup, revoke tokens or change
provider variables.

## Restricted-role postflight verifier correction

The first cleanup-role acceptance run `30877717135` / job `91892430762`
failed safely inside its read-only proof with SQLSTATE `42501`, `permission
denied for table _prisma_migrations`. No evidence artifact was written and the
run changed no production state. The denial is the reviewed least-privilege
posture: both the cleanup role and pooled runtime role must have no direct
migration-ledger access. The postflight verifier was wrong to query the owner
ledger through either restricted credential.

The isolated correction removes that invalid ledger query rather than granting
new authority. Migration completeness remains established by successful owner
recovery `30877508811`. The cleanup workflow separately verifies through the
GitHub Actions API that this exact recovery succeeded at activation commit
`64409058d0023a434b36f1af31655caeb4915ac3` and that full CI succeeded for
the exact postflight release commit before the cleanup credential is used.
Disposable PostgreSQL must prove both restricted roles receive SQLSTATE
`42501` on direct ledger reads while their exact read-only authority
postflights pass and leave mode-0600 sanitized evidence. This correction does
not authorize merge or either production postflight rerun.

The first exact-head disposable proof of this correction, run `30879641020`,
reached the restricted runtime session and failed because the disposable
migration tree owns its functions as `ci`, while the unchanged production
postflight correctly requires `neondb_owner`. Do not parameterize or weaken the
production owner invariant. The corrected loopback-only harness temporarily
mirrors the 35 exact function owners to `neondb_owner`, runs both production
postflight implementations and the `42501` ledger-denial checks, then restores
every function to `ci` before migration status, global grants and rollback
proofs continue. A restoration failure fails the disposable run; no owner
fixture is ever used against production.

## Restricted-role postflight acceptance

PR `#150` merged the correction at exact main
`b98490ab09bcf395b45af04750d9b5606dbff7d5`. Exact-main CI run
`30881395864` passed, as did the automatic Notification FORCE proof
`30881395925` and Conversation/Message FORCE proof `30881395867`.

The pooled-runtime proof passed from the exact clean merge commit as
`grainline_app_runtime`. Protected cleanup-role workflow run `30924905247` /
job `92044644153` separately verified the exact recovery and CI runs through
the GitHub API, then passed as `grainline_direct_upload_cleanup_v2`. Both used
PostgreSQL-attested read-only transactions and reported
`productionChangedByPostflight=false`.

The retained mode-0600 evidence digests are:

- runtime: `3d43c66b6f18ea5d6e5b25b4d7677eda0b0a7bf3e38fe9390623dec95bd611c2`;
- cleanup: `86b638ffe67ee31b56980e0d22ae922922dd7b88ccbe476d9c51c6940784d0eb`.

No migration was resolved or replayed, and no deployment, grant, provider,
Case-evidence, scheduler or token change was part of acceptance.
