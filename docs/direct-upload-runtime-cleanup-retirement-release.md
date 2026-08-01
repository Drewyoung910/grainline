# DirectUpload ordinary-runtime cleanup retirement

Status on 2026-08-01: PR #132 merged as exact main commit
`a5d54e79d9b8747936bd2a7850115705461d0fbf` and that commit was manually
deployed as READY Vercel production deployment
`dpl_2o2yBehsStAiVWUhoj1LQTmZ9HJe`. `thegrainline.com` is aliased to that
deployment. DirectUpload RLS remains off, Case evidence remains disabled and
the protected GitHub cleanup worker remains manual-only.

Read-only `vercel inspect` on 2026-08-01 confirmed production deployment
`dpl_Gvsge8MWYW8DfDRSom34YPwsY8rH` is READY on `thegrainline.com` and its
deployed `vercelConfig.crons` contains `/api/cron/direct-upload-cleanup` at
`50 * * * *`. That is the pre-retirement baseline, not the current alias.

## Production acceptance evidence

The exact deployment completed at 2026-08-01T23:11Z with the production
database guard identifying the restricted `grainline_app_runtime` role. It did
not run Prisma migrations. Post-deploy checks proved:

- `thegrainline.com` resolves to READY deployment
  `dpl_2o2yBehsStAiVWUhoj1LQTmZ9HJe`;
- `/api/health` returns 200;
- the deployed build route inventory omits
  `/api/cron/direct-upload-cleanup`;
- the deployed `vercelConfig.crons` manifest omits the DirectUpload cleanup
  schedule; and
- an authenticated request to the retired path returns 404. An unauthenticated
  request returns 401 in middleware before route resolution, so it is not a
  valid route-existence probe.

No migration, RLS, Case-evidence, GitHub-schedule, cleanup, token, database-role
or provider-variable change was included. The rejected Cloudflare `v3`
credential revocation remains a separate pending confirmation.

## Why this is a prerequisite

The reviewed DirectUpload activation gives the three cleanup functions only to
`grainline_direct_upload_cleanup_v2`. The production Vercel cron currently
calls those functions through the ordinary `grainline_app_runtime` connection.
Activating FORCE RLS before retiring that route would make the hourly cron fail
with insufficient function authority.

This compatible application release removes:

- `/api/cron/direct-upload-cleanup` from `vercel.json`;
- the Vercel cleanup route; and
- the duplicate cleanup implementation from `src/lib/directUploadLifecycle.ts`.

The deletion implementation is not lost. The separately reviewed
`scripts/direct-upload-cleanup-worker.mjs` retains the lease, R2 delete,
complete and fail behavior behind the dedicated database and R2 credentials.
The GitHub worker remains manual-only in this release; no schedule is added and
no cleanup is executed.

## Safe release order

1. **Complete.** Merge and manually deploy this compatible application release
   by exact commit, without applying the DirectUpload activation migration.
2. **Complete.** Verify the production alias is on that commit, the Vercel
   DirectUpload cron and route are absent, and the ordinary upload routes remain
   in the deployed build. The retired schedule cannot start another cleanup
   invocation; its route maximum was 60 seconds and the old scheduled window
   had drained before this acceptance record.
3. Independently confirm the rejected Cloudflare `v3` credential is revoked.
4. Rebase and re-review draft PR #131 against the deployed compatible commit.
5. Apply the byte-pinned DirectUpload activation through the guarded production
   migration workflow, then run pooled-runtime and cleanup-role postflight.
6. Enable the protected GitHub cleanup schedule in its own reviewed release and
   prove its first scheduled pass before retiring the obsolete Vercel/Sentry
   monitor.
7. Keep Case evidence disabled until the DirectUpload activation and route
   smoke gates are complete.

The bounded cleanup pause between steps 1 and 6 retains otherwise-expirable
unclaimed objects; it does not delete live data or weaken upload ownership.
Do not compensate by granting cleanup functions back to the ordinary runtime
role or by copying cleanup credentials into Vercel.

## Explicit boundary

This production-record branch does not deploy another release, run a migration,
activate RLS, enable Case evidence, add a GitHub schedule, run cleanup, revoke a
token or change a provider variable. Draft PR #131 remains separate and blocked
until the rejected Cloudflare `v3` credential is independently confirmed
revoked and the activation branch is rebased and re-reviewed on current main.

## Validation

- DirectUpload/security/cron focused suite: 147 tests passed.
- Full repository suite: 2,629 passed, 7 intentionally skipped, 0 failed.
- Exact-head GitHub CI run `30719327322`: passed all PostgreSQL proofs,
  TypeScript, ESLint, tests, dependency audit and production build.
- The first production-record checkout test run had no `node_modules`; only
  1,961 tests loaded and 88 dependency-loader failures resulted. A test-only
  link to the already validated dependency tree restored dependency resolution,
  and the complete 2,636-test suite then passed with the totals above. This was
  a local checkout-preparation failure, not an application or production
  failure.
- TypeScript and ESLint: passed. ESLint emitted only the existing
  `jsx-ast-utils` unresolved-expression warning.
- Production build: passed; the built route inventory contains no
  `/api/cron/direct-upload-cleanup` route.
- Executable retirement verifier: passed and fails closed if the Vercel
  schedule, runtime route, runtime cleanup functions, worker isolation or
  manual-only GitHub posture drifts.
- The first disposable-worktree build attempts were non-code failures: an
  out-of-root `node_modules` symlink rejected by Turbopack, sandbox denial of
  Turbopack's localhost worker port, and then the intentionally absent local
  Upstash environment. Replacing the dependency symlink with an APFS clone,
  running outside the port sandbox and loading the existing local environment
  in-process produced the successful build without copying or printing secrets.
