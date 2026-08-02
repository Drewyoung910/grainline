# DirectUpload activation production recovery

Status: draft PR #140 stacked on corrected-migration PR #139; neither merged
nor dispatched.

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
The exact successful main CI run for the future recovery release must also be
bound before any production recovery is dispatched.

The isolated workflow head
`95943014716b4654b1654d740f601ae755ed1740` passed full PR CI run
`30757000208`. PR #140 targets PR #139's exact corrected-migration branch, not
`main`, so the corrected migration/proof and executable production recovery
remain two review and merge boundaries. The Vercel Preview status is expected
to fail closed on this operations-only branch; GitHub CI, including the
ephemeral PostgreSQL migrations, grants, RLS proofs, security audit and
production build, passed.

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

The workflow is prepared only in draft PR #140, stacked on PR #139, under
explicit wiring authorization. Neither PR has been merged and the workflow has
not been dispatched. The verifier, tests, workflow preparation and PR CI
changed no production state. Merging the two PRs in order and dispatching the
recovery remain separate boundaries; dispatch is the step that can mark the
ledger row rolled back and apply the activation.

The recovery must not deploy the app, enable Case evidence, schedule cleanup,
revoke Cloudflare tokens, change provider variables, or combine Case RLS. Those
remain separate releases. The generic Production Migrations guard remains
strict and must not be weakened to admit incomplete migrations.
