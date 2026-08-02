# DirectUpload activation production recovery

Status: corrected-migration PR #139 and recovery PR #140 are merged. The first
production recovery run stopped in its initial read-only migration-tree guard;
no recovery mutation ran and DirectUpload RLS remains off.

The failed production activation remains unchanged. Production migration run
`30729632410` created one unfinished Prisma ledger row with the original
checksum, zero applied steps, no finish marker and no rollback marker. Both
owner-only read-only inspections proved the database transaction rolled back
fully and left the compatible pre-activation table, function and grant posture
intact. DirectUpload RLS is therefore still off in production.

The corrected membership preflight has passed twice in disposable PostgreSQL
16. Exact-head recovery proof run `30734098369` reproduced the original
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
missing), the ledger has both aliases. The source history and byte identity do
not yet prove both ledger rows' completion/checksum state, so the recovery
guard must remain strict.

The protected failure inspector is being extended again to read only aggregate
row counts, completion/rollback counts, applied-step totals and checksum-match
booleans for those two exact alias names. It continues to require the failed
zero-step activation row and restored compatible authority posture inside the
same repeatable-read, read-only transaction. Do not weaken or retry recovery
until that alias-row proof passes and the exception is reviewed as an exact
historical invariant.

## Prepared read-only verifier

`scripts/direct-upload-activation-production-recovery.mjs` accepts only the
reviewed direct `neondb_owner` production credential and exact clean main
commit. It rejects runtime, cleanup and R2 credentials; binds the failed run,
disposable recovery proof, main CI run and recovery run IDs; verifies the
byte-pinned corrected migration; then opens a repeatable-read, read-only
transaction.

Before accepting any restart state, it also byte-pins the complete reviewed
migration tree and compares every migration directory with aggregate Prisma
ledger state. Every predecessor must have exactly one successful application,
there may be no unrecognized ledger name or incomplete predecessor, and the
activation must be the sole pending migration until it is activated.

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
production state. The aggregate tree delta is now known; a targeted read-only
checksum/completion proof for the two listing-variants aliases is the next
boundary. No recovery retry is accepted until that proof is reviewed and the
verifier admits only the exact historical alias shape.

The recovery must not deploy the app, enable Case evidence, schedule cleanup,
revoke Cloudflare tokens, change provider variables, or combine Case RLS. Those
remain separate releases. The generic Production Migrations guard remains
strict and must not be weakened to admit incomplete migrations.
