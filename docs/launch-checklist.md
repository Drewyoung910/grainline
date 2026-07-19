# Grainline Launch Checklist

This checklist is for the final pre-launch pass before accepting live marketplace transactions.
It is the canonical master launch-readiness checklist: also resolve or explicitly
accept the tracked launch/runtime/legal/product backlog in
`docs/deferred-launch-backlog.md` before official launch.
Do not treat the audit ledger's deferred count as sufficient launch tracking on
its own.

## Environment Variables

Confirm production and preview values in Vercel:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` if using the root metadata tag for
  Search Console ownership verification.
- `DATABASE_URL`
- `DIRECT_URL`
- `RUNTIME_DB_ROLE=grainline_app_runtime` (required by the production
  post-migration grant audit)
- `MIGRATION_DB_ROLE=neondb_owner` for this rollout (required by the production
  post-migration grant audit; change only after ownership evidence supports it)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_V2_WEBHOOK_SECRET`
- `ADMIN_PIN`
- `ADMIN_PIN_SHA256_BY_CLERK_ID` preferred for per-staff admin PINs; if unset, document why the shared `ADMIN_PIN` fallback is still acceptable.
- `ADMIN_PIN_COOKIE_SECRET`
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `CLOUDFLARE_R2_PUBLIC_URL`
- `SHIPPO_API_KEY`
- `SHIPPING_RATE_SECRET`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `EMAIL_FROM`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `OPENAI_API_KEY`
- `CRON_SECRET`
- `HEALTH_CHECK_TOKEN`
- `UNSUBSCRIBE_SECRET`
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`

Use distinct production secrets. Rotate any credential that appeared in terminal output.

## Vendor Setup

- Clerk: production domain configured.
- Clerk: bot protection, disposable email blocking, email subaddress blocking, enumeration protection, and account lockout enabled, with current dashboard evidence retained.
- Clerk/GitHub/Stripe/Vercel/Neon/Cloudflare/Resend/Sentry/Shippo/OpenAI/domain registrar: owner/admin credentials protected by hardware MFA, with one offline backup key stored separately.
- Clerk: seller MFA requirement or documented enforcement plan at the Stripe-Connect-completed boundary.
- Clerk: breached-password protection and multi-account/spam controls enabled when available on the active plan, or a documented exception retained with launch evidence.
- Clerk: webhook endpoint registered at `https://thegrainline.com/api/clerk/webhook` for `user.created`, `user.updated`, and `user.deleted`.
- Stripe: Connect live mode enabled and identity verification complete.
- Stripe: live snapshot webhook endpoint registered at `https://thegrainline.com/api/stripe/webhook` with exactly the current handled event set: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `account.updated`, `account.application.deauthorized`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, and `payout.failed`. Do not subscribe this endpoint to `payment_intent.*` events while Checkout Sessions are card-only and order creation is driven by Checkout events.
- Stripe: Connect v2 thin webhook endpoint registered at `https://thegrainline.com/api/stripe/webhook/v2` with `v2.core.account` account-notification events only, using a distinct `STRIPE_V2_WEBHOOK_SECRET`.
- Stripe: `npm run audit:stripe-webhooks` passes in live read-only mode with a retained sanitized artifact for endpoint URLs and event subscriptions, plus separate signing-secret matching evidence from Stripe/Vercel because Stripe does not return endpoint secrets after creation.
- Stripe: `thegrainline.com` registered for Apple Pay/payment method domains.
- Stripe: PCI SAQ A completed and evidence retained with launch records.
- Stripe/payment pages: checkout-page script inventory completed in `docs/checkout-script-inventory.md`; CSP reports from checkout pages verified in Sentry.
- Resend: sending domain verified.
- Resend/DNS: SPF, DKIM, and DMARC policy verified. Move DMARC to `p=reject` only after monitoring shows legitimate mail is aligned.
- Resend: webhook endpoint registered at `https://thegrainline.com/api/resend/webhook` with bounce, complaint, failed, and suppressed events enabled; `RESEND_WEBHOOK_SECRET` configured in production. Delivery-delayed provider events may be monitored in the Resend dashboard, but the app intentionally ignores them for durable suppression.
- Shippo: live API key configured.
- Cloudflare R2: bucket CORS and public URL verified.
- Cloudflare R2: `npm run audit:r2-upload` passes with production-like credentials after any R2 credential, CORS, public-domain, or bucket-policy change. `/api/health` only proves `HeadBucket` reachability.
- Cloudflare R2: public bucket listing/ListBucket exposure is disabled or otherwise non-public, with dashboard or CLI evidence retained.
- Cloudflare R2: bucket-level max object-size defense verified where available; app-level upload validation remains required.
- Cloudflare: TLS 1.0/1.1 disabled, TLS 1.2+ enabled, TLS 1.3 enabled, HSTS header present in production and preload-list status verified against hstspreload.org, SSL Labs grade recorded. Do not treat source-configured `preload` as preload-list acceptance.
- Cloudflare: WAF managed rules and bot protection mode enabled only after provider/webhook/API smoke tests confirm Stripe, Clerk, Resend, Shippo, Vercel health checks, and uptime checks are not challenged.
- Upstash: production Redis database configured.
- Sentry: production project receiving errors and source maps.
- Sentry: cron monitors configured for every `vercel.json` cron; alert routing verified for `source=cron_ops_health` warnings, including completed-cron partial record failures, `AccountDeletionSideEffect` cleanup issues, direct-upload cleanup failures, and webhook failure spike messages.
- Sentry: `npm run audit:sentry-crons` passes with live read-only Sentry credentials and a retained sanitized artifact for cron monitor coverage and alert-routing configuration. Keep separate dashboard screenshots or exported evidence for actual notification delivery tests.
- UptimeRobot: monitoring `https://thegrainline.com/api/health`.
- GitHub: branch protection on `main`, required CI, Dependabot alerts/updates, secret scanning/push protection where available, and CodeQL/code scanning where available.
- Security disclosure: `/security` and `/.well-known/security.txt` are live; `security@thegrainline.com` mailbox routing verified.
- Google Search Console: production ownership verified through
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` or an equivalent domain-level method,
  and `https://thegrainline.com/sitemap_index.xml` submitted after deployment.

## Database And Deploy

- `npx prisma validate`
- `npx prisma generate`
- Non-counted owner setup must pass via `npm run audit:rls-context` against exact reviewed staging endpoint `ep-bold-recipe-aavx4plv`, database `neondb`, and region `westus3.azure`, using the pooled runtime URL plus direct admin URL. Before any owner mutation, live `current_user` and `session_user` must both equal the exact direct-URL username and `current_database()` must equal its reviewed database path. Rollback cleanup must restore `ENABLE` and `FORCE ROW LEVEL SECURITY` without swallowing errors and then positively retain `pg_class.relrowsecurity=true` plus `relforcerowsecurity=true`. It persists the exact SECURITY INVOKER RPC-shaped fixture used unchanged by both counted repeats; write its sanitized `setup_passed` artifact to a distinct `RLS_CONTEXT_GATE_EVIDENCE_PATH` (mode `0600`) and retain it separately.
- Both counted repeats must use the exact manifest: `RLS_CONTEXT_GATE_CONFIRM=staging-only`, `RLS_CONTEXT_GATE_LOCALITY_CONFIRM=production-runtime`, `RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION=sfo1`, `RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION=westus3.azure`, `RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID=ep-bold-recipe-aavx4plv`, `RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME=neondb`, `RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime`, `RLS_CONTEXT_GATE_REQUESTS=500`, `RLS_CONTEXT_GATE_WARMUP_REQUESTS=50`, `RLS_CONTEXT_GATE_TURNOVER_REQUESTS=64`, `RLS_CONTEXT_GATE_TARGET_CONCURRENCY=8`, `RLS_CONTEXT_GATE_BURST_CONCURRENCY=16`, `RLS_CONTEXT_GATE_POOL_SIZE=16`, `RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS=10000`, `RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS=30000`, `RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS=35000`, `RLS_CONTEXT_GATE_TX_TIMEOUT_MS=5000`, `RLS_CONTEXT_GATE_SCHEMA=grainline_rls_canary`, and `RLS_CONTEXT_GATE_TABLE=context_canary`. Reviewed code pins Prisma pool `10`, claim table `context_gate_run_claim`, policy `context_canary_select`, and RPC `context_canary_rpc`; any manifest or pinned-code change requires two new slots.
- Configure branch-scoped `DATABASE_URL` and `RLS_CONTEXT_GATE_DATABASE_URL` to the same byte-for-byte pooled staging URL authenticated as `grainline_app_runtime` before pushing the attested gate commit; neither value is trimmed or normalized, and the Preview route verifies digest equality before claiming a run slot. Both URLs require an explicit non-empty password, explicit `:5432`, and one unencoded, bounded database path segment. They may contain only one lowercase `sslmode=verify-full` plus an optional single lowercase `channel_binding=require`; duplicate, case-variant, fragment, encoded/reserved database delimiter, disabled Node TLS verification, inherited `PGOPTIONS`, or other connection parameters fail closed. Node `pg` prefers SCRAM-PLUS when optional `channel_binding=require` is present but does not prove libpq-style hard channel binding; retained transport proof relies on `sslmode=verify-full`. Set a fresh `RLS_CONTEXT_GATE_TRIGGER_SECRET`, fresh `RLS_CONTEXT_GATE_RUN_ID`, and `RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA` to the exact Git-integrated Preview gate commit SHA. That SHA is not the later cleaned production Release 0 SHA, because removing the temporary runner necessarily creates a different commit. Confirm a fresh read-only Vercel environment/deployment inventory shows no branch-scoped `DIRECT_URL`, `RLS_CONTEXT_GATE_ADMIN_DATABASE_URL`, `RLS_CONTEXT_GATE_EVIDENCE_PATH`, or owner-only prepare/rollback/teardown flags.
- Two identical repeat-mode POSTs (run slots `1`, then `2`) must pass through one Git-integrated Vercel Preview in `sfo1`, benchmarking that same persistent one-statement RPC candidate against a true one-statement autocommit baseline. The 2026-07-17 slot 1 is not a pass: correctness/isolation succeeded, but 10 performance/adoption checks failed (wrapped p95 approximately 96--100 ms versus 39--40 ms autocommit, average hold approximately 93--96 ms versus 37--40 ms, and Prisma burst approximately 199 ms versus 78 ms), and the ledger correctly blocked slot 2. That deployment used a Prisma probe pool of 8. Before retrying, use the corrected harness with an uncapped raw control pool/burst of 16 and the application Prisma pool of 10 under the 16-request burst, record both pool sizes, represent unavailable Prisma acquisition timing honestly instead of as zero, and add SavedSearch route/SLO evidence. Do not lower thresholds after seeing the result. Capture each retained sanitized HTTP response separately outside the repository with mode `0600`; it must be HTTP `200` with `run.status=runtime_candidate_passed`, `result.issueCount=0`, `locality.runtimeEvidenceCandidate=true`, `locality.acceptanceEligible=false`, the requested `runner.runSlot`, and `run.commitSha`/`run.deploymentId` matching independent Vercel source/ref/SHA/id attestation. A provider response is not an `RLS_CONTEXT_GATE_EVIDENCE_PATH` file; that path is only for local owner-only setup, rollback, and teardown. This synthetic result is transport-only and is not real `SavedSearch` policy proof. After both responses are retained and independently attested, run owner-only `RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE=1` with the direct owner URL; the runtime role must never perform fixture teardown.
- The 2026-07-19 slot 1 at commit `c188ea4306ed15b1160a8525ad8c38baf934dfa4` and deployment `dpl_2U8ccnSKFcgiPUrF9SyYtDYz2woQ` is failed evidence and consumed its run; slot 2 was not called. The one-statement RPC candidate passed target/burst p95 (19.9/35.5 ms versus 19.8/35.6 ms), but the legacy wrapper-versus-autocommit Prisma burst comparison failed (146.5 ms versus 71.0 ms). For SavedSearch Bucket A/Phase A only, that generic legacy latency comparison is diagnostic because the promoted list/delete candidate is the separately gated one-statement RPC and the remaining wrappers were already transactions. Its errors/correctness/isolation findings, turnover, wrapper-versus-transaction thresholds, and both RPC performance comparisons remain blocking. Restore generic wrapper-versus-autocommit latency as a blocking gate before Bucket B or any newly wrapped formerly-autocommit path. This does not convert the failed run into a pass; use a fresh run id, trigger, commit, deployment, and two new slots.
- Provider transport proof completed 2026-07-19 on Git-integrated Preview commit `ef8622b1822bf700d3bc97757a631bdaed503018`, deployment `dpl_3xnFJFFr2qt5gZjKDGXzm6Hzk7RD`: slots 1 and 2 both returned `runtime_candidate_passed` with `issueCount=0` on the same manifest and run id. RPC target/burst p95 was 20.3/36.1 ms and 20.6/37.2 ms; request/correctness/isolation errors were zero. Both mode-`0600` responses and independent deployment attestation were retained outside the repository. Owner-only teardown proved the synthetic RPC absent, all 24 branch-scoped Preview variables were removed, temporary secrets were deleted, and the staging runtime password was rotated. This satisfies only the synthetic transport/performance prerequisite for constructing Release 0; real-table proof remains mandatory before Phase A, and production RLS plus Bucket B remain unauthorized.
- If a `500`, timeout, or provider failure occurs after durable claim, do not retry that slot, call slot 2, or edit/reset the run-claim ledger. Fix the cause, use a fresh `RLS_CONTEXT_GATE_RUN_ID` and fresh Git-integrated Preview deployment, and restart at slot 1.
- Vercel Preview deployment-protection bypass rotated after any audit-log exposure and kept separate from the gate trigger token.
- The previous Preview runner trigger secret is treated as exposed because it appeared in captured tool/session output. Rotate it before another run, delete local temporary files containing it after sanitized evidence is retained, prove the old value fails, then remove the new trigger secret, opaque run id, allowed commit SHA, and staging runtime URL after capture and delete the temporary Preview. The temporary Preview artifact alone contains the runner route, the exact `/api/internal/rls-context-gate` middleware exemption, and the marker-bearing runner-only test; run that test before capture. Release 0 and every production artifact must exclude all three. The deploy guard recursively detects an exact, renamed, or copied marker-bearing runner test and treats any test-tree symlink as blocking.
- The 2026-07-16 locality baseline selected Vercel `sfo1` for the reviewed Neon
  `westus3.azure` branch. RLS locality evidence records a warmed, checked-out,
  sequential 25-query `SELECT 1` RTT proxy for diagnosis only. Do not normalize,
  subtract, or discount the unchanged acceptance thresholds with it. The prior
  `context-gate-failed-pre-pool-fix.json` laptop artifact is failed
  diagnostic-only evidence and satisfies neither required pass.
- Corrected provider responses must pass before production Release 0, with independent deployment
  attestation retained. Release 0: RLS remains off throughout. Then deploy both pre-RLS owner-RPC
  migrations (`20260717024500_add_saved_search_owner_rpcs` and the forward-only
  `20260717025000_harden_saved_search_owner_rpc_projection`) while RLS is still
  off, verify them, and only then deploy the app release that calls the RPCs.
  Because `vercel.json` automatically runs every pending migration, the exact
  Release 0 artifact/cherry-pick must exclude the later RLS policy migration,
  temporary runner route, exact middleware exemption, and runner-only test.
  Release-0 CI must assert those temporary acceptance artifacts are absent and
  the policy migration is absent. The temporary provider-proof branch is
  intentionally not mergeable and must fail this clean-artifact CI step while
  the runner exists. On the later clean Release-0 artifact only, set
  `SAVED_SEARCH_RLS_DEPLOY_PHASE=release-0`; the production deploy guard requires
  both RPC migrations present and the RLS migration absent before
  `prisma migrate deploy` can run.
- First query `public."SavedSearch"` ownership through `DIRECT_URL` and retain the
  result. For this rollout, both `current_user`/`session_user` and the table owner
  must be `neondb_owner`; do not substitute a planned role name.
- `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=neondb_owner -f scripts/provision-runtime-db-role.sql` to converge the reviewed runtime role, current grants, and migration-owner default privileges before migration. Release 0 retains CRUD while RLS is off. Phase A revokes `SavedSearch` `UPDATE`, and the Phase-A provisioning script repeats that revoke after its bulk table grant so a later rerun cannot restore the unused privilege.
- Export `SAVED_SEARCH_RLS_DEPLOY_PHASE=release-0` for this exact artifact, then
  run `npx dotenv-cli -e .env -- npm run migrate:deploy:guarded`. Do not run a
  naked `prisma migrate deploy` from a SavedSearch rollout checkout. The guarded
  command runs the source/artifact guard, `prisma migrate deploy`, and then the
  live grant audit against the same exact `DIRECT_URL` in that order; its
  `--require-direct-url` mode rejects a different `GRANT_AUDIT_DATABASE_URL`.
  Before any migration runs, the source guard requires `DATABASE_URL` and
  `DIRECT_URL`; exact `RUNTIME_DB_ROLE=grainline_app_runtime` and
  `MIGRATION_DB_ROLE=neondb_owner`; matching URL usernames; pooled/runtime and
  direct/owner Neon endpoints that identify the same endpoint, region, port,
  and database; only lowercase `sslmode=verify-full` plus optional lowercase
  `channel_binding=require`, each at most once; and an absent or exactly matching
  `GRANT_AUDIT_DATABASE_URL`. Every URL also requires an explicit password,
  explicit `:5432`, and one unencoded, bounded database path segment;
  `NODE_TLS_REJECT_UNAUTHORIZED=0` and inherited `PGOPTIONS` fail before migration. A
  loopback CI audit requires `--allow-loopback-ci` and cannot combine it with
  `--require-direct-url`. Inside the same repeatable-read, read-only
  transaction, the post-migration audit must compare live `current_database()`
  with the URL database path and verify `current_user`/`session_user` before any
  grant or catalog evidence. A failed post-migration audit then stops the production build before
  application traffic. Retain the sanitized
  `SAVED_SEARCH_CATALOG_STATE={...}` output line as the parseable catalog proof.
- Record the current deployment-credential residual in the release evidence:
  because `vercel.json` runs owner migrations in the production Build Step,
  Vercel also makes that project-level `DIRECT_URL` available to production
  Function execution. This rollout improves wrong-context isolation through
  `DATABASE_URL` but does not claim arbitrary-code isolation from the owner
  credential. Keep the separate follow-up to externalize owner migrations and
  the grant audit, then remove `DIRECT_URL`/`MIGRATION_DB_ROLE` from the
  production Function environment, before expanding RLS to Bucket B.
- After Phase B, follow
  `docs/runtime-db-credential-separation.md` as a separate release. Require the
  selected-main and reviewer-protected GitHub `Production` environment, a
  newly rotated environment-scoped migration secret, absence of every
  privileged database variable from Vercel, a second owner rotation that
  invalidates the credential embedded in Phase B and superseded deployments,
  the exact manual migration workflow, and a runtime-only Vercel deployment.
  Do not begin Bucket B until that postflight is retained.
- `npx dotenv-cli -e .env -- npx prisma migrate status`
- `GRANT_AUDIT_DATABASE_URL="$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=neondb_owner npm run audit:db-grants -- --require-direct-url` only after migration/status, so this retained second audit covers the final catalog, verifies the raw `pg_proc.prosrc` SHA-256 fingerprints for both owner RPCs, and proves runtime DML was revoked from `_prisma_migrations` and every other untracked public table. The guarded migration command has already run the same audit before the build; this explicit rerun is the post-status retained release record. For Release 0, retain explicit live-catalog evidence that `public."SavedSearch"` has `relrowsecurity=false`, `relforcerowsecurity=false`, and zero policies before application traffic is promoted. Run from a clean checkout of the exact release commit so untracked migration files cannot change the source-derived audit inventory.
- A future branch may substitute `MIGRATION_DB_ROLE=grainline_migration_owner` only after catalog evidence proves that dedicated role actually owns every tracked app object; it is not the owner for this rollout.
- After Release 0, the real-table `SavedSearch` proof must pass before Phase A: a known non-customer fixture is returned by exact id through API/account/dashboard/export reads, the real `grainline_saved_search_list` owner list/read RPC returns only the requested owner's rows, the real `grainline_saved_search_delete_one` RPC deletes exactly one own row and zero foreign rows, and account cleanup removes its rows under trusted target-user context. Direct DB denial/rollback tests must also pass. Empty 200 responses do not count when the fixture exists. Before phase A, the static guard also rejects every direct or aliased Prisma `savedSearch` delegate access outside the owner helper, Prisma `createManyAndReturn`/`updateManyAndReturn`, literal relation `include`/`select: { savedSearches: ... }`, raw `TRUNCATE`/`MERGE`/`COPY`, all `Prisma.raw`, and every new unreviewed `$queryRawUnsafe`/`$executeRawUnsafe` escape hatch. The guard does not claim whole-program data-flow proof for indirectly assembled relation objects, so clean-checkout review of changed raw/query-construction code remains mandatory. This proves behavior under reviewed asserted identities only; it does not prove resistance to a wrong asserted id, arbitrary SQL, or compromised runtime credentials. The account-deletion test pins `timeout: 30000`/`maxWait: 10000` on its outer context transaction.
- A separate permanent non-customer `SavedSearch` canary row must be seeded and retained with `npm run seed:rls-saved-search-canary` using independently reviewed database identity, pooled runtime and direct owner URLs, and a mode-`0600` artifact path. The idempotent seed proves the synthetic user is banned, `notifyEmail=false`, exact runtime-role visibility, and post-commit context cleanup without retaining ids or credentials. Sequence this before the canary-aware release: seed/verify the row, set both matching nonce environment variables together while the old release ignores them, deploy ops-health code with RLS still off, and immediately require `savedSearchRlsCanaryStatus=healthy`. If the code is deployed first, missing/partial configuration intentionally produces an actionable ops-health 503; that is a failure signal, not an alternate approved sequence. Keep both variables through phase A/B; remove them only after a later code release stops requiring the canary. Require healthy status before Phase A, immediately after Phase A, and after the release-skew window. Canary-owned retained monitoring evidence contains only status/counts and never attaches canary ids, row data, or caught database errors.
- The staging exact-policy gate must pass and its mode-`0600` artifact must be retained outside the repository. `REVIEWED_PRODUCTION_DATABASE_ENDPOINT_ID` comes from independently reviewed Neon production inventory, not either staging URL: `SAVED_SEARCH_RLS_GATE_CONFIRM=staging-only SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID=ep-bold-recipe-aavx4plv SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID="$REVIEWED_PRODUCTION_DATABASE_ENDPOINT_ID" SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME=neondb SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION=westus3.azure SAVED_SEARCH_RLS_GATE_DATABASE_URL="$STAGING_RUNTIME_URL" SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL="$STAGING_DIRECT_URL" SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH="/private/tmp/saved-search-rls-staging.json" npm run audit:rls-saved-search`. Never run this mutating fixture gate against production; use the clean-checkout catalog/grant audit plus bounded live route reads of retained non-customer canary ids for production verification.
- Do not set `SAVED_SEARCH_RLS_DEPLOY_PHASE=phase-a-reviewed` until the exact
  real-table staging proof, route fixture, grant/canary checks, rollback proof,
  and exact Phase-A artifact review have passed. That value is human promotion
  authorization, not a repair for a rejected build, and requires all three
  rollout migrations. Missing/unknown/mismatched values fail closed. Remove or
  reset each temporary phase value immediately after its intended release;
  review or retire the guard before phase B or any later migration.
- Continue `SavedSearch` activation after Release 0: phase A applies exact
  policies + `NO FORCE` + `ENABLE`; Phase B is a separate reviewed release that
  applies `FORCE`. A
  12-hour wait is not drain proof: disable superseded callable deployments or
  rotate/revoke their owner runtime credentials, then retain `pg_stat_activity`
  evidence that owner-backed application sessions are gone. Before `FORCE`,
  choose and test the owner/maintenance path for migrations, restore drills,
  controlled maintenance, and emergency repair. Production provisioning uses
  the actual migration owner (`neondb_owner` for this rollout), and emergency
  rollback disables RLS before any app rollback. This pass stops after Bucket A
  (`SavedSearch`); Bucket B is explicitly paused and requires a separate pass.
- Phase B artifact gate: use only the persistent branch descended from the
  exact Phase-A commit and require `SAVED_SEARCH_RLS_DEPLOY_PHASE=phase-b-reviewed`,
  the fingerprinted `20260720060000_force_saved_search_rls` migration, and
  `SAVED_SEARCH_RLS_FORCE_EXPECTED=true`. For Phase-A deployment
  `dpl_H5tnmGyL8fK3oriwawjHBhg2Yomz`, the earliest reviewed promotion time is
  `2026-07-20T06:25:00Z`, after both the full skew window plus margin and the
  06:20 UTC post-skew canary. Before promotion, retain evidence that the
  migration-owner password was rotated, the prior owner credential is rejected,
  Production `DIRECT_URL` uses the replacement while runtime `DATABASE_URL`
  remains `grainline_app_runtime`, and `pg_stat_activity` has zero other
  `neondb_owner` client sessions. The migration enforces the session count too.
- Run `npm run audit:rls-saved-search-force` only against an independently
  identified direct staging endpoint after applying the exact Phase-B migration.
  It must prove the exact `NOSUPERUSER BYPASSRLS` owner maintenance path under
  FORCE, bounded transactional emergency disable/ENABLE/FORCE restoration,
  rollback cleanup, and final exact FORCE state in a mode-`0600` artifact. The
  owner secret remains a tracked Function-environment residual that must be
  externalized before Bucket B. In production, database-first
  `DISABLE ROW LEVEL SECURITY` precedes any emergency app rollback.
- `STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM=live-read STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH="stripe-webhook-subscriptions-evidence.json" npm run audit:stripe-webhooks` (live Stripe read-only; verifies the classic snapshot webhook endpoint and Connect v2 thin event destination URLs/event families; does not prove deployed signing-secret values)
- `STRIPE_MONEY_PROOF_CONFIRM=test-mode STRIPE_MONEY_PROOF_DB_CONFIRM=staging-or-local STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID="<acct_test...>" STRIPE_MONEY_PROOF_EVIDENCE_PATH="stripe-money-proof-evidence.json" npm run audit:stripe-money` (Stripe test mode plus staging/local DB only; writes sanitized money-movement evidence for refunds and label clawbacks)
- `BUYER_DELETION_REPLAY_PROOF_CONFIRM=test-mode-replay BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM=staging-or-local-read BUYER_DELETION_REPLAY_PROOF_SESSION_ID="<cs_test...>" BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH="buyer-deletion-replay-evidence.json" npm run audit:buyer-deletion-replay` (after a real Stripe test-mode checkout completion/replay whose source buyer was deleted, suspended, or missing before webhook processing; verifies the local blocked-review order, buyer-PII purge, processed webhook row, refund ledger, and audit evidence)
- `R2_UPLOAD_SMOKE_CONFIRM=write-delete R2_UPLOAD_SMOKE_EVIDENCE_PATH="r2-upload-smoke-evidence.json" npm run audit:r2-upload` (production-like R2 credentials; writes and deletes synthetic objects, verifies R2 metadata, public availability, public root listing behavior, and writes sanitized evidence)
- `DEPLOYED_HEADERS_PROOF_CONFIRM=production-read DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH="deployed-security-headers-evidence.json" npm run audit:deployed-headers` (production domain only; writes sanitized evidence for enforced root security headers and `/api/health` private cache/vary headers; does not replace securityheaders.com, SSL Labs, or hstspreload.org records)
- `SENTRY_CRON_PROOF_CONFIRM=live-read SENTRY_ORG_SLUG="<org>" SENTRY_PROJECT_SLUG="<project>" SENTRY_CRON_PROOF_EVIDENCE_PATH="sentry-cron-alert-evidence.json" npm run audit:sentry-crons` (live Sentry read-only; verifies every `vercel.json` cron has a matching monitor and configured alert routing includes the launch-critical warning terms; does not replace dashboard evidence for delivered notifications)
- `SHIPPING_CURRENCY_PROOF_CONFIRM=read-only SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH="shipping-currency-drift-evidence.json" npm run audit:shipping-currency` (production data read-only; verifies no historical non-USD or mixed-currency shipping-rate rows need reconciliation under the current USD launch posture)
- `FOUNDING_MAKER_PROOF_CONFIRM=staging-or-local-write-delete FOUNDING_MAKER_PROOF_EVIDENCE_PATH="founding-maker-concurrency-evidence.json" npm run audit:founding-maker` (staging/local database only; creates and deletes synthetic users, sellers, listings, and grant rows to prove concurrent Founding Maker assignment, durable non-reuse, and cap behavior)
- `LAUNCH_EVIDENCE_INVENTORY_CONFIRM=local-read LAUNCH_EVIDENCE_INVENTORY_PATH="launch-evidence-inventory.json" npm run audit:launch-evidence` (final local evidence-bundle inventory; reads retained machine artifacts plus `launch-evidence-manifest.json` manual records and fails until launch-required evidence is present)
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npx vercel --prod`

Do not rename a migration directory after it has been applied in production.

## Smoke Tests

Run these in test mode before switching to live money:

- Sign up, sign in, sign out.
- Admin PIN gate: page access and `/api/admin/*` access. If `ADMIN_PIN_SHA256_BY_CLERK_ID` is configured, verify every active EMPLOYEE/ADMIN Clerk user id has a digest entry and missing users cannot use the shared fallback.
- Seller onboarding and Stripe Connect return flow.
- Create draft listing, preview it, publish listing.
- Add variant listing to cart, change quantity, remove item.
- Buy Now checkout with variant selection.
- Cart checkout with multiple sellers.
- Shipping quote selection and fallback path.
- Stripe webhook creates orders and order items correctly.
- Seller order fulfillment: shipped and pickup paths.
- Seller refund and staff case refund paths.
- Private custom listing is visible only to the reserved buyer.
- Public listing visibility: draft, hidden, pending review, rejected, private, vacation, banned seller.
- `/api/health` returns 200 when DB/Redis/R2 dependency checks are healthy and 503 on dependency failure; verbose dependency output works only with `Authorization: Bearer $HEALTH_CHECK_TOKEN`, not a query string token. Confirm deployed responses include `Cache-Control: private, no-store, max-age=0` and `Vary: Authorization, X-Health-Check-Token`.

## Security Evidence

Record links/screenshots/dates for:

- SSL Labs result for `thegrainline.com`.
- securityheaders.com result for `thegrainline.com`.
- HSTS preload result.
- Deployed security header proof artifact from `npm run audit:deployed-headers`, covering enforced CSP/HSTS/header presence and `/api/health` cache/vary headers.
- Stripe PCI SAQ A completion.
- GitHub code-security settings.
- Cloudflare WAF/Bot/TLS settings.
- Clerk production security settings evidence: bot protection, disposable email blocking, email subaddress blocking, enumeration protection, account lockout, staff/admin MFA or enforcement plan, breached-password protection, and multi-account/spam controls where available.
- Stripe snapshot webhook and Connect v2 thin webhook delivery, including the read-only artifact from `npm run audit:stripe-webhooks`, screenshots or exported evidence of the exact event subscriptions listed above, and separate signing-secret matching evidence for `STRIPE_WEBHOOK_SECRET` and `STRIPE_V2_WEBHOOK_SECRET`.
- Stripe test-mode money-movement proof artifact from `npm run audit:stripe-money`, covering full and partial reverse-transfer refunds, platform-only refund/manual-reconciliation handling, label-cost transfer reversal, retry-pending label clawback failure, manual-review exhaustion, and local `OrderPaymentEvent`/`SystemAuditLog` evidence.
- Stripe test-mode buyer-deletion replay proof artifact from `npm run audit:buyer-deletion-replay`, covering a real paid Checkout Session whose original buyer was deleted, suspended, or missing before webhook processing, with blocked review state, purged buyer snapshot fields, processed webhook state, automatic refund evidence, and local audit rows.
- Shipping-rate currency drift proof artifact from `npm run audit:shipping-currency`, or written not-applicable evidence if production has no historical seller/listing/order data before launch.
- Founding Maker concurrency proof artifact from `npm run audit:founding-maker` against staging/local data with production migrations applied before relying on the badge program at launch scale.
- Clerk and Resend webhook delivery.
- Cloudflare R2 public bucket-listing/ListBucket posture, bucket-level max object-size setting, CORS/public-domain settings, and upload smoke-test artifact from `npm run audit:r2-upload`.
- Neon backup/PITR setting and most recent restore drill.
- Sentry alert rules for CSP/script/frame violations, production error spikes, Sentry cron monitors, `source=cron_ops_health` warnings including completed-cron partial record failures, `AccountDeletionSideEffect` cleanup issues, direct-upload cleanup failures, and webhook failure spike messages, including the read-only artifact from `npm run audit:sentry-crons` plus dashboard screenshots or exported notification-delivery evidence.
- Google Search Console ownership verification and sitemap index submission.
- Launch evidence inventory artifact from `npm run audit:launch-evidence`, generated after the machine artifacts and manual evidence manifest have been assembled.

## Business And Legal

- Attorney sign-off on Terms and Privacy.
- DRAFT banners removed only after attorney sign-off.
- Clickwrap and age-attestation decision finalized.
- Money transmitter analysis documented.
- INFORM Consumers Act scope documented.
- Business insurance decision documented.
- Texas marketplace facilitator filing calendar set.
- DMCA agent details verified.
