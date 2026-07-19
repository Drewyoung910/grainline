# Production Database Credential Separation

Status: implementation staged on
`codex/rls-runtime-env-separation-20260719`; not active in production. This
release is barred until SavedSearch Phase B is live and its retained postflight
evidence is healthy.

## Security Goal

Production application Functions receive only the pooled
`grainline_app_runtime` `DATABASE_URL`. They must not receive `DIRECT_URL`,
`MIGRATION_DB_ROLE`, grant-audit URLs, or any owner/admin database URL under a
different name. Owner migrations run from a manually approved GitHub
`Production` environment against an exact clean `main` commit.

This separation closes the arbitrary-runtime-code gap left by RLS. A query made
through `grainline_app_runtime` remains subject to grants and RLS; code that can
read a valid `neondb_owner` credential can bypass all current and future RLS.

## Implemented Release Contract

- `vercel.json` no longer runs migrations. Its build command runs
  `guard:runtime-db-env` before the ordinary build.
- The runtime guard rejects any Vercel build containing `DIRECT_URL`,
  `MIGRATION_DB_ROLE`, `GRANT_AUDIT_DATABASE_URL`, any
  `*_ADMIN_DATABASE_URL`, or any `*_PROOF_DIRECT_URL`, including empty defined
  variables. Production must contain the exact reviewed pooled endpoint and
  `grainline_app_runtime` identity.
- Automatic Vercel deployment from `main` is disabled. Preview deployment
  remains available, but privileged database variables are forbidden there too.
- `.github/workflows/production-migrations.yml` is manual-only, serializes all
  production migration runs, has only `contents: read`, and references the
  GitHub `Production` environment.
- The workflow uses only the environment-scoped
  `PRODUCTION_MIGRATION_DIRECT_URL`; it deliberately does not fall back to the
  existing repository-wide `DIRECT_URL` or `DATABASE_URL` secrets.
- The preflight requires the typed confirmation, exact 40-character dispatched
  `main` commit, clean checkout, direct production endpoint, exact live
  owner/runtime role attributes and PostgreSQL 16 membership options,
  SavedSearch `ENABLE` plus `FORCE` with three policies, and zero incomplete
  Prisma migrations. `DATABASE_URL` is prohibited from the owner-only job.
- After preflight, the workflow runs `prisma migrate deploy`, `prisma migrate
  status`, and the exact final grant/RLS audit through the same direct owner
  URL.

## Verified Provider State Before Activation

Read-only inventory on 2026-07-19 found:

- Vercel Production still has Sensitive, production-only `DIRECT_URL`,
  `DATABASE_URL`, `RUNTIME_DB_ROLE`, and `MIGRATION_DB_ROLE`. Sensitive values
  cannot be read back outside builds/runtime.
- The public GitHub repository has repository-wide `DIRECT_URL` and
  `DATABASE_URL` secrets last updated 2026-04-28. They predate the July runtime
  role rollout and are untrusted/stale; no workflow currently references them.
- GitHub `Production` initially had no secret, reviewer, wait timer, or branch
  restriction. On 2026-07-19 it was updated and re-read successfully with one
  required reviewer, `Drewyoung910` (user id 234014962),
  `prevent_self_review=false`, and one selected branch policy: branch `main`
  (policy id 55079962). A fresh environment secret inventory remained empty.
- `main` itself is not branch-protected. Use an environment selected-branch
  policy, not “protected branches only,” because GitHub treats every branch as
  eligible when no branch protection rule exists.

## Activation Sequence

Perform this as a separate release after Phase B. Never combine these steps
with Bucket B policy activation.

1. Require Phase B retained evidence: exact deployment source, `ENABLE` plus
   `FORCE`, three SavedSearch policies, runtime direct denial, healthy canary,
   route smokes, old Phase-A owner credential rejection, and zero other owner
   sessions.
2. Merge the reviewed separation commit to `main`. Its Vercel Git policy must
   prevent an automatic production deployment.
3. Re-verify GitHub `Production` still has only selected branch `main`, required
   reviewer `Drewyoung910`, and `prevent_self_review=false`. This requires a
   separate approval click while allowing the sole operator to approve the
   manually dispatched run. Stop if the protection or empty pre-rotation secret
   inventory has drifted.
4. Remove Vercel Production `DIRECT_URL` and `MIGRATION_DB_ROLE`, then verify a
   fresh metadata inventory contains neither. This changes only future
   deployments; the current Phase B app remains live on `DATABASE_URL`.
5. Rotate `neondb_owner` a second time. Persist the new secret only in the
   mode-`0600` local operator file and the GitHub `Production` environment as
   `PRODUCTION_MIGRATION_DIRECT_URL`. Do not update Vercel. Use the same local
   SCRAM-verifier, new-authentication, old-`28P01`, exact-role, and zero-session
   proofs as the Phase B operator.
6. The second rotation invalidates the owner credential embedded in the current
   Phase B deployment and every other superseded deployment. Do not accept an
   environment-variable deletion alone as old-deployment invalidation.
7. Delete the stale repository-wide GitHub `DIRECT_URL` and `DATABASE_URL`
   secrets only after confirming no workflow references them. Retain the new
   owner secret only at environment scope.
8. Manually dispatch `Production Migrations` from `main`. Paste the exact
   current `main` SHA into `release_commit` and type
   `run-reviewed-production-migrations-from-main`; approve the `Production`
   environment job; retain the green run URL and final audit output.
9. From a clean checkout of that same commit, deploy explicitly with Vercel.
   The build must pass the runtime isolation guard with only the exact runtime
   `DATABASE_URL`; retain deployment source metadata and verify the live alias.
10. Re-run grant/RLS catalog proof, runtime no-context denial, ops-health,
    cron/webhook health, and live read-only route smokes. A fresh Vercel
    environment inventory must still omit every privileged database key.
11. Only after this release is stable may Bucket B Notification staging and
    production activation begin.

## Failure And Rollback

- If the GitHub environment cannot be protected, stop before storing the new
  secret.
- If Vercel variable removal or its absence proof fails, stop before the second
  owner rotation and deployment.
- If GitHub secret update is ambiguous, stop before altering PostgreSQL. A
  changed timestamp alone does not prove which concurrent secret value won.
- If owner rotation is ambiguous, test new and prior authentication, converge
  local/GitHub/PostgreSQL, and do not deploy.
- If the migration workflow fails, leave the existing app live and reconcile
  the database before deploying code.
- If the runtime-only deployment regresses application behavior, the previous
  deployment can serve normal traffic through unchanged `DATABASE_URL`; its
  embedded owner credential has already been invalidated. Roll back the app
  without restoring the owner credential to Vercel.

## Primary References

- Vercel project environment variables are available during both build and
  Function execution:
  <https://vercel.com/docs/environment-variables>
- Vercel supports disabling Git deployments by branch:
  <https://vercel.com/docs/project-configuration/git-configuration>
- GitHub environment secrets are released only after environment protection
  rules pass:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- GitHub supports required reviewers and selected-branch deployment policies:
  <https://docs.github.com/en/rest/deployments/environments>
