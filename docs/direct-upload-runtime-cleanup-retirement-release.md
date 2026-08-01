# DirectUpload ordinary-runtime cleanup retirement

Status on 2026-08-01: prepared on isolated branch
`agent/direct-upload-runtime-retirement-20260801` only. It has not been merged
or deployed. DirectUpload RLS remains off and the existing Vercel cleanup cron
remains live in production until a separately authorized exact-commit deploy.

Read-only `vercel inspect` on 2026-08-01 confirmed production deployment
`dpl_Gvsge8MWYW8DfDRSom34YPwsY8rH` is READY on `thegrainline.com` and its
deployed `vercelConfig.crons` contains `/api/cron/direct-upload-cleanup` at
`50 * * * *`. The inspection changed no deployment or provider state.

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

1. Merge and manually deploy this compatible application release by exact
   commit, without applying the DirectUpload activation migration.
2. Verify the production alias is on that commit, the Vercel DirectUpload cron
   is absent, the retired route returns not found, ordinary upload routes still
   work, and no old cleanup invocation remains in flight.
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

This branch does not merge or deploy either release, run a migration, activate
RLS, enable Case evidence, add a GitHub schedule, run cleanup, revoke a token,
or change a provider variable. Draft PR #131 remains separate and blocked.

## Validation

- DirectUpload/security/cron focused suite: 147 tests passed.
- Full repository suite: 2,628 passed, 7 intentionally skipped, 0 failed.
- TypeScript and ESLint: passed. ESLint emitted only the existing
  `jsx-ast-utils` unresolved-expression warning.
- Production build: passed; the built route inventory contains no
  `/api/cron/direct-upload-cleanup` route.
- The first disposable-worktree build attempts were non-code failures: an
  out-of-root `node_modules` symlink rejected by Turbopack, sandbox denial of
  Turbopack's localhost worker port, and then the intentionally absent local
  Upstash environment. Replacing the dependency symlink with an APFS clone,
  running outside the port sandbox and loading the existing local environment
  in-process produced the successful build without copying or printing secrets.
