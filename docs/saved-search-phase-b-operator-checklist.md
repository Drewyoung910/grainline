# SavedSearch Phase B Production Operator Checklist

This one-off checklist supports sealed release
`17bf93dc8837fd6c5e6988569f993781800b6318`. The operator helper lives on a
separate branch and must never be added to or substituted for the deployment
artifact.

## Hard Stop

Do not run either operator mode before `2026-07-20T06:25:00Z`. The helper also
requires the exact completed `2026-07-20T06` ops-health row to have started at
or after 06:20 UTC with every actionable count zero and the SavedSearch canary
healthy.

Run the helper directly. Do not wrap it in `vercel env run`: Vercel CLI 56.3.2
merges downloaded values first and then lets local files and the parent process
override them, while Vercel Sensitive values are deliberately non-readable
outside builds. The helper loads only the current owner `DIRECT_URL` from the
exact `/Users/drewyoung/grainline/.env.local`, ignores inherited shell values
and that file's legacy owner-valued `DATABASE_URL`, pins both reviewed role
names in code, and requires the credential file to be a mode-`0600` regular
file. The helper normalizes the omitted standard port and strengthens the local
`sslmode=require` spelling to `verify-full` in memory. Both `.env.local` and
`.env` were tightened from `0644` to `0600` on 2026-07-19. The helper prints
and records no URLs, passwords, SCRAM verifiers, canary ids, or caught database
errors.

## Verified Role Baselines

A read-only live query on 2026-07-19 disproved the draft assumption that owner
and runtime roles share one posture:

- `neondb_owner` is `NOSUPERUSER`, `CREATEDB`, `CREATEROLE`, `INHERIT`,
  `LOGIN`, `REPLICATION`, and `BYPASSRLS`. Its `grainline_app_runtime`
  membership has `ADMIN=true`, `INHERIT=false`, `SET=false`; its
  `neon_superuser` membership has `ADMIN=false`, `INHERIT=true`, `SET=true`.
- `grainline_app_runtime` is `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
  `NOINHERIT`, `LOGIN`, `NOREPLICATION`, and `NOBYPASSRLS`; it is
  membership-free.

The helper checks these as separate exact contracts before and after rotation.
Owner membership does not make the runtime principal privileged; membership
direction is owner-as-member-of-runtime, while runtime remains membership-free.
The owner cannot `SET ROLE grainline_app_runtime` because that membership's
`SET` option is false, so the operator does not manufacture a false runtime
no-context proof through the owner. Phase B does not mutate either role's
attributes or memberships.

## 1. Read-Only Preflight

From a clean checkout of branch
`codex/saved-search-phase-b-operator-20260719`:

```sh
PHASE_B_OWNER_ROTATION_MODE=preflight-only \
PHASE_B_OWNER_ROTATION_CONFIRM=verify-production-phase-b-after-post-skew-canary \
PHASE_B_OWNER_ROTATION_RELEASE_COMMIT=17bf93dc8837fd6c5e6988569f993781800b6318 \
PHASE_B_OWNER_ROTATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/saved-search-phase-b-owner-preflight-20260720.json \
PHASE_B_VERCEL_PROJECT_DIRECTORY=/Users/drewyoung/grainline \
node scripts/saved-search-phase-b-owner-rotation.mjs
```

Require exit zero, `status=passed`, `issueCount=0`,
`acceptanceEligible=false`, and a mode-`0600` evidence file. Preflight confirms
the exact Vercel project, Sensitive Production `DIRECT_URL` and `DATABASE_URL`
metadata, local credential file posture, production endpoint, owner and runtime role posture,
SavedSearch Phase-A catalog state, and post-skew canary. It performs no update.

## 2. Owner Credential Rotation And Drain

Only after independently inspecting the preflight artifact:

```sh
PHASE_B_OWNER_ROTATION_MODE=rotate \
PHASE_B_OWNER_ROTATION_CONFIRM=rotate-production-owner-after-post-skew-canary \
PHASE_B_OWNER_ROTATION_RELEASE_COMMIT=17bf93dc8837fd6c5e6988569f993781800b6318 \
PHASE_B_OWNER_ROTATION_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/saved-search-phase-b-owner-rotation-20260720.json \
PHASE_B_VERCEL_PROJECT_DIRECTORY=/Users/drewyoung/grainline \
node scripts/saved-search-phase-b-owner-rotation.mjs
```

The helper:

1. Repeats every preflight check.
2. Generates a 256-bit base64url password in memory.
3. Builds a PostgreSQL SCRAM-SHA-256 verifier locally using 4096 iterations and
   a fresh 128-bit salt. The implementation is unit-checked against
   PostgreSQL's published `createuser` example.
4. Atomically persists the proposed new `DIRECT_URL` to mode-`0600`
   `.env.local` first, so a failed or ambiguous external update cannot lose the
   generated credential.
5. Records the existing Sensitive Production `DIRECT_URL` and `DATABASE_URL`
   metadata, updates only the future-deployment `DIRECT_URL` through stdin,
   requires the bounded CLI command to succeed, requires its non-secret
   `updatedAt` metadata to advance, and requires the `DATABASE_URL.updatedAt`
   value to remain exact. Sensitive values are
   intentionally non-readable, so the operator does not claim an impossible
   exact-value read-back. The bounded stdin-only CLI attempt and changed
   Sensitive-record metadata are the Vercel-side proof.
6. Requires live `password_encryption=scram-sha-256`, then sends
   `ALTER ROLE CURRENT_USER PASSWORD '<SCRAM verifier>'`. PostgreSQL stores a
   valid pre-encrypted verifier as-is, so the cleartext password cannot enter
   SQL text, activity displays, command history, or server query logs.
7. Verifies the new owner connection, exact owner/runtime role and membership
   posture, and Phase-A catalog state; requires the old owner credential to
   fail specifically with PostgreSQL code `28P01`; and waits at most 30 seconds
   for zero other owner client sessions. Runtime protection is evidenced by the
   retained Phase-A direct-denial proof, the required 06:20 production canary,
   unchanged Sensitive `DATABASE_URL` metadata, and unchanged runtime role
   posture—not by possessing or changing the non-readable runtime credential.

This intentionally does not use Neon's role-password reset endpoint. Neon
documents that reset as dropping compute-endpoint connections; using a
pre-encrypted PostgreSQL verifier avoids that unnecessary live-traffic risk.
Existing runtime sessions are not terminated by this helper.

If the Vercel CLI reports any failure, or its metadata proof fails, the helper
does not alter PostgreSQL; mode-`0600` `.env.local` retains the proposed new
secret for reconciliation. A CLI failure is never treated as success merely
because metadata advanced, because the Sensitive value cannot be read back to
prove which concurrent update won. If Vercel is proved updated but new database
authentication cannot be proved, stop: `.env.local` and Vercel hold the
proposed new secret while database acceptance is ambiguous. Do not deploy or
blindly restore/retry. Test which credential works, then converge Vercel and
PostgreSQL. Runtime `DATABASE_URL` is separate and is never changed by this
operation.

## 3. Phase B Deployment

Proceed only when the rotation artifact is mode `0600`, `status=passed`,
`acceptanceEligible=true`, every named check is true, and
`ownerSessionCount=0`. Then:

1. Set temporary Production `SAVED_SEARCH_RLS_DEPLOY_PHASE=phase-b-reviewed`.
2. Deploy only sealed commit `17bf93dc8837fd6c5e6988569f993781800b6318`.
3. Require the guarded migration, migration status, grant/catalog audit, and
   build to pass.
4. Remove `SAVED_SEARCH_RLS_DEPLOY_PHASE` immediately.
5. Prove exact deployment source metadata, `ENABLE` plus `FORCE`, the same three
   policies, runtime `NOBYPASSRLS`, owner `NOSUPERUSER BYPASSRLS`, runtime
   no-context denial, healthy canary, and live route smokes.
6. Stop before Bucket B. Externalize `DIRECT_URL` and `MIGRATION_DB_ROLE` from
   application Functions in the next independently reviewed release.

If Phase B causes an application regression, disable RLS at the database before
rolling app code back. Do not roll the app back while FORCE remains active.

## Primary References

- PostgreSQL accepts a valid pre-encrypted SCRAM password string as-is:
  <https://www.postgresql.org/docs/16/sql-createrole.html>
- PostgreSQL recommends client-side password encryption before sending an
  `ALTER ROLE` command and documents `PQencryptPasswordConn` for that purpose:
  <https://www.postgresql.org/docs/16/libpq-misc.html>
- PostgreSQL's `createuser` documentation publishes the SCRAM example used by
  this helper's deterministic unit test:
  <https://www.postgresql.org/docs/16/app-createuser.html>
- Vercel Sensitive values are non-readable after creation and available only
  during builds/runtime:
  <https://vercel.com/docs/environment-variables/manage-across-environments>
- Vercel CLI documents stdin updates and `--sensitive`:
  <https://vercel.com/docs/cli/env>
- Neon documents that its control-plane password reset drops compute-endpoint
  connections, which is why this operator does not use it:
  <https://api-docs.neon.tech/reference/resetprojectbranchrolepassword>
