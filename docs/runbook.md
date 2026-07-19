# Grainline Operations Runbook

Last updated: 2026-07-18

This runbook covers the minimum operational steps for production incidents, deploy rollback, secret rotation, webhook recovery, database restore drills, and public support/legal request handling.

## Incident Triage

1. Check `/api/health` for anonymous uptime status.
2. Check verbose health with `Authorization: Bearer $HEALTH_CHECK_TOKEN` when backend dependency details are needed. Do not put the token in the URL.
3. Check Sentry for the current deploy SHA, request IDs, and recent error spikes.
4. Check Vercel deployment logs for failed middleware, route-handler, or build errors.
5. Check Stripe Dashboard for payment, webhook, dispute, and Connect-account alerts.
6. Check Clerk Dashboard for auth/session incidents and webhook delivery failures.
7. Check Resend Dashboard for failed, bounced, or delayed transactional email.

The verbose health route's R2 check is intentionally a cheap `HeadBucketCommand`
reachability check. Treat `checks.r2 = "ok"` as evidence that the configured R2
bucket can be reached with the current credentials; it does not prove
`PutObject`, `GetObject`, `DeleteObject`, CORS, public custom-domain delivery,
public bucket-listing/ListBucket posture, or bucket-level object-size settings.
After any R2 credential, CORS, public-domain, or bucket-policy change, run a
real upload smoke test through both processed image upload and direct
upload/verify before calling media healthy.

Pre-launch Cloudflare R2 upload smoke:

- Run with production-like R2 credentials after any R2 credential, CORS,
  public-domain, or bucket-policy change. The script writes two synthetic
  objects, verifies R2 metadata, object bytes, public availability, and public
  root listing behavior, then deletes the synthetic objects.
- Required inputs:
  - `CLOUDFLARE_R2_ACCOUNT_ID`
  - `CLOUDFLARE_R2_ACCESS_KEY_ID`
  - `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
  - `CLOUDFLARE_R2_BUCKET_NAME`
  - `CLOUDFLARE_R2_PUBLIC_URL`
  - `R2_UPLOAD_SMOKE_CONFIRM=write-delete`
  - `R2_UPLOAD_SMOKE_EVIDENCE_PATH=r2-upload-smoke-evidence.json`
- Command:
  `R2_UPLOAD_SMOKE_CONFIRM=write-delete R2_UPLOAD_SMOKE_EVIDENCE_PATH="r2-upload-smoke-evidence.json" npm run audit:r2-upload`.
- Retain the sanitized JSON artifact with launch records. The artifact records
  bucket/key hashes, public origin, HTTP status for the public listing probe,
  metadata checks, byte-signature checks, public-availability checks, and
  cleanup evidence.
- This smoke test does not replace Cloudflare dashboard or CLI evidence for
  CORS settings, bucket policy, bucket-level object-size defenses, or public
  ListBucket posture. Keep those provider records with the launch evidence.

Pre-launch deployed security headers proof:

- Run against the production domain after any security-header, middleware,
  Vercel, or Cloudflare routing change that could affect deployed responses.
- Required inputs:
  - `DEPLOYED_HEADERS_PROOF_CONFIRM=production-read`
  - `DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH=deployed-security-headers-evidence.json`
  - Optional `DEPLOYED_HEADERS_PROOF_URL=https://thegrainline.com` if the default
    target must be made explicit.
- Command:
  `DEPLOYED_HEADERS_PROOF_CONFIRM=production-read DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH="deployed-security-headers-evidence.json" npm run audit:deployed-headers`.
- Retain the sanitized JSON artifact with launch records. The artifact records
  the target origin, enforced root CSP/HSTS/security-header checks, absence of
  `x-powered-by`, and `/api/health` private cache/vary header checks.
- This proof does not replace securityheaders.com, SSL Labs, or
  hstspreload.org evidence. Keep those external scanner and preload-list
  records with the same launch evidence bundle.

Pre-launch shipping-rate currency drift proof:

- Run against production data before launch, and again after any migration or
  backfill that changes listing/order currencies, seller shipping settings, or
  persisted Shippo rate quotes.
- The current launch posture is USD-only for seller flat-rate/free-shipping
  settings. Leave `SHIPPING_CURRENCY_PROOF_ALLOWED_CURRENCIES` unset unless a
  deliberate multi-currency launch decision has been documented.
- Required inputs:
  - `DATABASE_URL`
  - `SHIPPING_CURRENCY_PROOF_CONFIRM=read-only`
  - `SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH=shipping-currency-drift-evidence.json`
- Command:
  `SHIPPING_CURRENCY_PROOF_CONFIRM=read-only SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH="shipping-currency-drift-evidence.json" npm run audit:shipping-currency`.
- Retain the sanitized JSON artifact with launch records. The artifact records
  allowed currencies, listing/order currency counts, hashed sample ids for any
  non-allowed or mixed-currency seller shipping rows, non-allowed paid shipping
  or label-cost orders, and persisted Shippo quote currency mismatches.
- A failing run means affected rows need reconciliation or a written launch
  decision before accepting live marketplace transactions. Do not close this
  item from source review alone.

Pre-launch Founding Maker concurrency proof:

- Run against a staging or local database with production migrations applied.
  Do not run against production because the proof creates and deletes synthetic
  users, sellers, listings, and Founding Maker grant rows.
- Required inputs:
  - `DATABASE_URL`
  - `FOUNDING_MAKER_PROOF_CONFIRM=staging-or-local-write-delete`
  - `FOUNDING_MAKER_PROOF_EVIDENCE_PATH=founding-maker-concurrency-evidence.json`
- Optional bounded tuning:
  - `FOUNDING_MAKER_PROOF_SYNTHETIC_SELLERS` defaults to 8 and must be 2..32.
  - `FOUNDING_MAKER_PROOF_REPEAT_CALLS` defaults to 3 and must be 1..10.
- Command:
  `FOUNDING_MAKER_PROOF_CONFIRM=staging-or-local-write-delete FOUNDING_MAKER_PROOF_EVIDENCE_PATH="founding-maker-concurrency-evidence.json" npm run audit:founding-maker`.
- Retain the sanitized JSON artifact with launch records. The artifact records
  database host hash, baseline ledger consistency, synthetic concurrent grant
  range, hashed sample seller/grant ids, durable non-reuse after a synthetic
  hard delete, cap fail-closed behavior, and cleanup evidence.
- A failing run means the Founding Maker badge program should not be treated as
  launch-scale ready until the allocator, data drift, or cleanup issue is fixed
  and rerun.

Pre-launch launch evidence inventory:

- Run after the machine proof artifacts and manual dashboard/legal/provider
  evidence records have been assembled. This is a final local inventory check,
  not a replacement for the underlying proofs.
- Required machine artifacts are read from `LAUNCH_EVIDENCE_DIR` when set, or
  the repository root by default: Stripe webhook subscriptions, Stripe
  money-movement proof, buyer-deletion replay proof, R2 upload smoke, deployed
  headers, Sentry cron alerts, and shipping currency drift.
- Manual records live in `launch-evidence-manifest.json` by default, or
  `LAUNCH_EVIDENCE_MANIFEST_PATH` when set. Each manual record should use:
  `{ "status": "retained", "reference": "...", "capturedAt": "YYYY-MM-DD" }`.
  Use `status: "not_applicable"` only with a concrete `reason`.
- Required inputs:
  - `LAUNCH_EVIDENCE_INVENTORY_CONFIRM=local-read`
  - `LAUNCH_EVIDENCE_INVENTORY_PATH=launch-evidence-inventory.json`
  - Optional `LAUNCH_EVIDENCE_DIR=<path>` if artifacts are stored in a bundled
    launch-evidence folder instead of the repository root.
  - Optional `LAUNCH_EVIDENCE_MANIFEST_PATH=<path>` if the manual manifest is
    stored outside the evidence directory.
  - Optional `LAUNCH_EVIDENCE_REQUIRE_CONDITIONAL=1` to fail on conditional
    RLS/Founding Maker items too.
- Command:
  `LAUNCH_EVIDENCE_INVENTORY_CONFIRM=local-read LAUNCH_EVIDENCE_INVENTORY_PATH="launch-evidence-inventory.json" npm run audit:launch-evidence`.
- Retain the generated inventory with launch records. A passing inventory means
  the required evidence files and manual records are present and shaped
  correctly; it does not independently prove provider state beyond those
  retained records.

Every incident note should include: start time, affected surface, current deploy SHA, primary request IDs, customer-visible impact, mitigation, owner, and follow-up issue.

## Security Incident Addendum

Use this section when an incident may involve unauthorized access, account takeover, payment abuse, credential exposure, private-message/order/address exposure, malware/script injection, or vendor compromise.

Immediate containment checklist:

1. Preserve evidence before deleting or rotating anything: deploy SHA, request IDs, Sentry issue IDs, provider event IDs, suspicious IPs/user IDs, affected routes, webhook event IDs, and relevant database row IDs.
2. Stop active exploitation with the narrowest control available: route flag, rate-limit block, Cloudflare rule, feature flag, or forward hotfix.
3. Rotate only the secrets that plausibly entered the blast radius. Broad secret rotation during an incident can create secondary outages.
4. Check Stripe, Clerk, Cloudflare, Vercel, Neon, Resend, Shippo, Sentry, Upstash, and GitHub dashboards for matching events.
5. Decide whether user notification, regulator notice, card-brand/acquirer notice, vendor escalation, or law-enforcement preservation is required. This decision needs counsel when personal data, payment state, or credentials may be involved.

Breach-notification clocks are jurisdiction-specific and change over time. Maintain a counsel-reviewed appendix outside this runbook with current state/federal deadlines, affected-data thresholds, and notice templates. Do not rely on AI-generated legal deadlines without counsel verification.

Vendor contact tree to maintain before launch:

- Stripe support/security and Stripe account manager path if available.
- Clerk support/security.
- Vercel support.
- Neon support.
- Cloudflare support/security.
- Resend support/security.
- Shippo support/security.
- Sentry support.
- Upstash support.
- Domain registrar support.
- GitHub support/security.

Every contact entry should include: console URL, support URL/email, account owner, MFA recovery path, emergency notes, and last-verified date.

## Deploy Rollback

1. Identify the last known-good deployment in Vercel.
2. Promote or roll back to that deployment from Vercel's deployment UI.
3. Confirm `/api/health` returns `{ ok: true }`.
4. Confirm a public page, authenticated dashboard page, and admin page load.
5. Confirm Stripe, Clerk, and Resend webhooks still target the production URL.
6. Leave the bad commit in git history and land a forward fix; do not rewrite main.

If rollback follows a schema migration, verify the older deploy is compatible with the current schema before promotion. If it is not compatible, ship a forward fix instead.

## Secret Rotation

Rotate one dependency at a time and verify before moving to the next one.

1. Create the new secret in the provider dashboard.
2. Add it to Vercel Production, Preview, and Development as appropriate.
3. Redeploy production.
4. Verify the dependent endpoint or job.
5. Revoke the old secret only after the new deploy is healthy.

Recommended cadence:

- Rotate hot HMAC/application secrets every 90 days:
  `ADMIN_PIN`, `ADMIN_PIN_SHA256_BY_CLERK_ID` entries,
  `ADMIN_PIN_COOKIE_SECRET`, `UPLOAD_VERIFICATION_SECRET`,
  `UNSUBSCRIBE_SECRET`, `SHIPPING_RATE_SECRET`, `CRON_SECRET`, and
  `HEALTH_CHECK_TOKEN`.
- Rotate provider API keys at least annually or immediately after any suspected
  exposure: Stripe, Clerk, Resend, Shippo, Upstash, Sentry, OpenAI, Cloudflare
  R2, Neon, and GitHub/Vercel tokens.
- Rotate webhook signing secrets annually when the provider supports a
  dual-secret or staged endpoint cutover. For emergency webhook rotation, create
  the new endpoint/secret, deploy support for it, replay failed events, then
  disable the old endpoint only after deliveries are healthy.

Zero-downtime rotation preference:

- Verification-only secrets should support a short dual-verify window whenever
  practical (`*_PREVIOUS` accepted for verification, current secret used for new
  signatures). `CRON_SECRET_PREVIOUS` already follows this pattern.
- Secrets that cannot safely support dual verification must use the provider
  dashboard cutover flow plus a production deploy before revocation.
- Document the rotation date, old-secret revocation time, owner, and smoke-test
  evidence in the launch/security evidence record.

High-risk secrets:

- `DATABASE_URL`: runtime Neon pooled URL. Must use the `-pooler` host.
- `DIRECT_URL`: Neon direct URL for migrations and restore operations.
- `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SECRET`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and Connect-related Stripe settings.
- `RESEND_API_KEY`, `EMAIL_FROM`, and `RESEND_WEBHOOK_SECRET`.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- `ADMIN_PIN`, `ADMIN_PIN_SHA256_BY_CLERK_ID`, `ADMIN_PIN_COOKIE_SECRET`, `UPLOAD_VERIFICATION_SECRET`, `UNSUBSCRIBE_SECRET`, and `HEALTH_CHECK_TOKEN`.
- `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, and `NEXT_PUBLIC_SENTRY_DSN`.

## Sentry Cron And Alert Proof

Pre-launch Sentry cron/alert proof:

- Run only with a read-only Sentry token that can list monitors, workflows,
  detectors, and issue alert rules for the production project.
- Required inputs:
  - `SENTRY_AUTH_TOKEN`
  - `SENTRY_ORG_SLUG`
  - `SENTRY_PROJECT_SLUG`
  - `SENTRY_CRON_PROOF_CONFIRM=live-read`
  - `SENTRY_CRON_PROOF_EVIDENCE_PATH=sentry-cron-alert-evidence.json`
- Command:
  `SENTRY_CRON_PROOF_CONFIRM=live-read SENTRY_ORG_SLUG="<org>" SENTRY_PROJECT_SLUG="<project>" SENTRY_CRON_PROOF_EVIDENCE_PATH="sentry-cron-alert-evidence.json" npm run audit:sentry-crons`.
- Retain the sanitized JSON artifact with launch evidence. A passing run proves
  every `vercel.json` cron has an enabled Sentry monitor with the matching
  crontab schedule, and that enabled Sentry alert/workflow configuration includes
  notification routing plus the launch terms `cron_ops_health`,
  `AccountDeletionSideEffect`, `direct-upload`, webhook failure spike, and CSP.
- This proof reads Sentry monitor and alert configuration only; it does not
  replace dashboard screenshots or exported evidence for actual notification
  delivery tests.

## Webhook Recovery

Stripe:

1. Confirm the production endpoint is `/api/stripe/webhook`.
2. Confirm the deployed `STRIPE_WEBHOOK_SECRET` matches the Stripe endpoint secret.
3. Confirm the endpoint is subscribed only to the handled snapshot events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired`, `checkout.session.async_payment_failed`,
   `account.updated`, `account.application.deauthorized`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
   `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, and
   `payout.failed`. Do not add `payment_intent.*` events unless checkout payment
   methods and webhook failure handling are expanded.
4. Confirm the Connect v2 thin-event endpoint is `/api/stripe/webhook/v2`, uses
   `STRIPE_V2_WEBHOOK_SECRET`, and is subscribed only to the `v2.core.account`
   account-notification event family.
5. Before launch, run the read-only provider subscription proof:
   `STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM=live-read STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH="stripe-webhook-subscriptions-evidence.json" npm run audit:stripe-webhooks`.
   Retain the sanitized artifact with launch evidence. This proves the classic
   snapshot endpoint and Connect v2 event destination URLs/event families from
   Stripe's API. It does not prove deployed `STRIPE_WEBHOOK_SECRET` or
   `STRIPE_V2_WEBHOOK_SECRET` values because Stripe does not return signing
   secrets after creation; keep separate Stripe/Vercel dashboard evidence for
   endpoint-secret matching and rotation records.
6. In Stripe Dashboard, filter failed events and replay after the app is healthy.
7. Verify `StripeWebhookEvent` rows show processed state for replayed events.
8. For checkout or refund incidents, compare Stripe charge/payment/refund IDs against `OrderPaymentEvent`.
9. If a seller refund, staff case refund, or blocked-checkout refund was accepted by Stripe, confirm the refund ID is durably recorded on the `Order`, in `OrderPaymentEvent`, and in the related `SystemAuditLog` entry. For reverse-transfer refunds, also inspect `metadata.refundAccounting.transferReversalId` and `transferReversalAmountCents` when Stripe returned them so buyer refund amount and seller recovery are not conflated. If the Stripe webhook delivery is still failed, replay it rather than issuing another manual refund first; the blocked-checkout refund idempotency key is session-scoped.
10. For first-party refund recovery incidents, check Sentry tags `seller_refund_orphaned_after_stripe`, `seller_refund_orphan_record_failed`, `case_refund_orphaned_after_stripe`, `case_refund_orphaned_review_update_failed`, `stripe_webhook_blocked_checkout_orphaned_after_stripe`, `stripe_webhook_blocked_checkout_orphan_record_failed`, `stripe_webhook_blocked_checkout_refund`, and `stripe_webhook_blocked_checkout_refund_notification`. Notification failures are warning telemetry. Refund errors without a Stripe refund ID mean the local sentinel was released and the route/webhook should remain failed/retryable so Stripe can retry the refund attempt; orphan-record failures mean local refund evidence may be incomplete and the failed request/webhook should stay retryable until the refund ID is recorded in all three local evidence surfaces.
11. For label purchases with Sentry tag `shippo_label_purchase_ambiguous`, check Shippo for a transaction tied to the order/rate before clearing `labelStatus` or retrying. If Shippo created a label, write the transaction, label URL, tracking, and label-cost fields to the order and reconcile the Stripe label clawback; if Shippo did not create a label, staff may clear the review hold and label status before retry.
12. For Stripe Connect orderability drift, check recent `SystemAuditLog` rows for `STRIPE_ACCOUNT_CHARGES_UPDATED` or `STRIPE_ACCOUNT_DEAUTHORIZED`, then check the latest `CronRun` for `stripe-connect-reconcile`. The six-hour reconciliation cron is a backstop for missed account-state events, not a substitute for replaying failed Stripe webhook deliveries.

Pre-launch Stripe money-movement proof:

- Run only in Stripe test mode against a staging or local database where
  synthetic `Order`, `OrderPaymentEvent`, and `SystemAuditLog` rows may be
  retained as launch evidence.
- Required inputs:
  - `STRIPE_SECRET_KEY` set to a `sk_test_...` key.
  - `STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID` set to a test connected account
    that can receive destination-charge transfers.
  - `STRIPE_MONEY_PROOF_CONFIRM=test-mode`.
  - `STRIPE_MONEY_PROOF_DB_CONFIRM=staging-or-local`.
  - `STRIPE_MONEY_PROOF_EVIDENCE_PATH=stripe-money-proof-evidence.json`.
- Command:
  `STRIPE_MONEY_PROOF_CONFIRM=test-mode STRIPE_MONEY_PROOF_DB_CONFIRM=staging-or-local STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID="<acct_test...>" STRIPE_MONEY_PROOF_EVIDENCE_PATH="stripe-money-proof-evidence.json" npm run audit:stripe-money`.
- Retain the sanitized JSON artifact with launch records. A passing run records
  real Stripe test-mode evidence for full reverse-transfer refunds, partial
  reverse-transfer refunds, platform-only refund/manual-reconciliation handling,
  label-cost transfer reversal, retry-pending label clawback failure, and
  manual-review exhaustion, plus local order ledger/audit evidence for refund
  paths.
- Do not run this command with live Stripe keys or against production data.

Pre-launch buyer-deletion Stripe replay proof:

- Run only in Stripe test mode against a staging or local database that has
  production migrations applied and can receive the test webhook replay.
- This proof does not create or fake a paid Checkout Session. First create a
  real test Checkout Session through the app, delete/suspend/remove the source
  buyer before webhook processing, complete or replay the Stripe test checkout
  event, then run the verifier against that `cs_test_...` session.
- Required inputs:
  - `STRIPE_SECRET_KEY` set to a `sk_test_...` key.
  - `DATABASE_URL` set to the staging/local database that processed the replay.
  - `BUYER_DELETION_REPLAY_PROOF_CONFIRM=test-mode-replay`.
  - `BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM=staging-or-local-read`.
  - `BUYER_DELETION_REPLAY_PROOF_SESSION_ID=<cs_test...>`.
  - `BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH=buyer-deletion-replay-evidence.json`.
  - Optional: `BUYER_DELETION_REPLAY_PROOF_EXPECTED_BUYER_STATE=deleted`,
    `suspended`, or `missing`, and `BUYER_DELETION_REPLAY_PROOF_EVENT_ID=<evt_...>`.
- Command:
  `BUYER_DELETION_REPLAY_PROOF_CONFIRM=test-mode-replay BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM=staging-or-local-read BUYER_DELETION_REPLAY_PROOF_SESSION_ID="<cs_test...>" BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH="buyer-deletion-replay-evidence.json" npm run audit:buyer-deletion-replay`.
- Retain the sanitized JSON artifact with launch records. A passing run verifies
  the Stripe session is test-mode and paid, the source buyer is no longer valid,
  the local order is blocked for review with buyer snapshots purged, the webhook
  event row is processed, and the blocked-checkout refund ledger plus system
  audit evidence were written.
- Do not close this launch blocker from source tests alone, and do not run this
  verifier with live Stripe keys or against production data.

Clerk:

1. Confirm the production endpoint is `/api/clerk/webhook`.
2. Confirm `CLERK_WEBHOOK_SECRET` matches the Svix endpoint secret.
3. Replay failed Svix deliveries from Clerk Dashboard.
4. Verify `ClerkWebhookEvent` rows prevent duplicate processing.
5. For ban, deletion, password, or email changes, confirm platform session invalidation still works.

Resend:

1. Confirm the production endpoint is `/api/resend/webhook`.
2. Confirm `RESEND_WEBHOOK_SECRET` matches Resend.
3. Replay or inspect failed events in Resend.
4. Verify suppression and failure counters are updated.
5. If email delivery is degraded, pause non-critical broadcast sends and prioritize transactional order/case/support emails.

## Database Restore Drill

Run a quarterly restore drill against a non-production database. Never restore over production without a written incident decision.

1. Create a temporary Neon branch or restore target from the desired point in time.
2. Set `DIRECT_URL` to the temporary direct connection string.
3. Run `npx prisma migrate status` against the restore target.
4. Run `npx prisma db pull` only for inspection; do not commit introspection output.
5. Run representative read-only smoke checks: users, active listings, orders, email outbox, support requests, and webhook event tables.
6. Document RPO, RTO, restore timestamp, validation result, and cleanup.
7. Delete the temporary branch after validation.

Production migration rules:

- Use `DIRECT_URL` for migrations.
- `DIRECT_URL` must authenticate as the declared migration owner role. Do not
  point migrations at a different owner role and rely on later object reassignment
  to make grant audits pass; default privileges apply to the role that creates
  future objects.
- Keep runtime-role grants and default-privilege setup in reviewed,
  version-controlled SQL or migrations before production promotion. Manual
  staging setup is acceptable for proving the shape, but production should not
  depend on untracked dashboard or shell changes.
- For every least-privilege/RLS rollout, keep the operational order explicit:
  query and retain object ownership first; run provisioning to converge current
  grants and migration-owner defaults; run the rollout's guarded migration
  command and
  `prisma migrate status`; then run the exact grant/RLS audit against the final
  catalog. A pre-migration audit is not a substitute for the post-migration
  audit because `_prisma_migrations` and other new public objects can inherit
  runtime DML from default privileges.
- Current reviewed staging and production role/grant template (the actual table
  owner is `neondb_owner`; re-query ownership immediately before execution):
  `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=neondb_owner -f scripts/provision-runtime-db-role.sql`.
  This script must be run while connected as the declared migration owner. It
  does not store or generate the runtime role password; create that role through
  Neon/admin SQL with a secret managed outside git. It also grants runtime
  `EXECUTE` on `pg_trgm` extension functions because search/autocomplete uses
  `similarity()` and the `%` operator; if extension/function PUBLIC privileges
  are locked down manually, rerun provisioning and the grant audit before deploy.
  Trusted `pg_trgm` functions may be owned by a bootstrap/admin role even when
  `CREATE EXTENSION` runs as the migration role; standard provisioning grants
  only functions the migration role can grant and verifies runtime `EXECUTE`
  still exists for the rest. If PUBLIC function privileges are removed for
  non-grantable extension functions, use an explicitly reviewed admin-owned
  provisioning step in staging first; the grant audit fails when runtime lacks
  access that the declared migration role cannot restore.
  The Phase-A version also re-revokes `UPDATE` on `SavedSearch` immediately
  after its bulk table grant. Keep that order: a Phase-A provisioning rerun must
  converge to exact non-grantable `SELECT`/`INSERT`/`DELETE` and must not restore
  `UPDATE`. The clean Release-0 artifact and audit still expect CRUD while RLS
  is absent; other tracked tables and migration-owner table defaults remain
  CRUD in both phases.
- After migrations that add tables, sequences, `grainline_*` functions, enum
  types, or role/default-privilege changes, run `npm run audit:db-grants` from
  the same environment/secret set that will run migrations and retain the run
  output with deploy evidence. For Release 0, that retained live-catalog audit
  must prove `public."SavedSearch"` has `relrowsecurity=false`,
  `relforcerowsecurity=false`, and zero policies both after migration and before
  application traffic is promoted.
- For the current `SavedSearch` Release 0, deploy
  `20260717024500_add_saved_search_owner_rpcs` followed by
  `20260717025000_harden_saved_search_owner_rpc_projection` while RLS is still
  off and verify both. This production step remains blocked until both corrected
  synthetic provider repeats described below pass with independent deployment
  attestation. Then deploy the app release that calls those RPCs. `vercel.json`
  automatically runs every pending
  migration, so the exact Release 0 artifact/cherry-pick must exclude the later
  `SavedSearch` RLS policy migration, temporary runner route, exact middleware
  exemption, and runner-only test. Release-0 CI must assert those are absent; do
  not let the app deploy enable RLS or retain Preview-only gate code as an
  accidental side effect. The temporary provider-proof branch must fail that
  clean-artifact CI step while the runner remains and is never mergeable; only
  its later cleaned Release-0 derivative may pass and promote.
  Production builds run `scripts/guard-saved-search-rls-deploy.mjs` before
  `prisma migrate deploy`, then run `audit:db-grants` before the application
  build. Before any migration runs, its source guard requires both
  `DATABASE_URL` and `DIRECT_URL`, exact role declarations
  `RUNTIME_DB_ROLE=grainline_app_runtime` and
  `MIGRATION_DB_ROLE=neondb_owner`, a pooled runtime URL whose username is the
  runtime role, and a direct owner URL whose username is the migration role.
  The two URLs must identify the same Neon endpoint, region, port, and database,
  without surrounding whitespace. Remote rollout URLs may contain only one
  lowercase `sslmode=verify-full` and an optional single lowercase
  `channel_binding=require`; duplicate, case-variant, fragment, or other
  connection parameters fail closed. Every URL must also contain an explicit
  non-empty password, explicit `:5432`, and one unencoded, bounded database path
  segment. The guard rejects `NODE_TLS_REJECT_UNAUTHORIZED=0` and non-empty
  `PGOPTIONS`. It also rejects a differing
  `GRANT_AUDIT_DATABASE_URL` at that pre-migration boundary. The guarded command
  then fails closed when the audit fails or when the sanitized
  `SAVED_SEARCH_CATALOG_STATE={...}` record cannot be read from the final live
  catalog. `GRANT_AUDIT_DATABASE_URL` is optional for manual audits; the guarded
  production command passes `--require-direct-url`, preventing migration/audit
  target drift and disallowing the loopback-only CI `sslmode=disable` exception.
  A manual loopback CI audit must opt in with `--allow-loopback-ci`, which cannot
  be combined with `--require-direct-url`. Optional `channel_binding=require`
  configures Node `pg` to prefer SCRAM-PLUS but does not prove libpq-style hard
  channel binding; retained transport proof relies on `sslmode=verify-full`.
  After opening the repeatable-read, read-only transaction and before reading
  grant/catalog evidence, the audit compares live `current_database()` with the
  URL database path and verifies `current_user`/`session_user` are the reviewed
  migration owner. Set `SAVED_SEARCH_RLS_DEPLOY_PHASE=release-0` only on
  the clean RPC-only artifact. The guard requires both pre-RLS RPC migrations
  to be present, the phase-A migration to be absent, and the exact reviewed
  migration-directory inventory and SQL-content fingerprint to match.
- `SAVED_SEARCH_RLS_DEPLOY_PHASE=phase-a-reviewed` is a separate, explicit
  human promotion authorization. Set it only after the two corrected provider
  repeats, exact real-table staging proof, rollback proof, and exact artifact
  review have passed. It requires both pre-RLS RPC migrations and the Phase-A
  policy migration to be present. Never
  use it to bypass the guard on this combined working branch before those gates.
  Missing, empty, unknown, or migration-mismatched values fail production
  before migrations run; Preview builds do not run the production guard. These
  values are temporary and deployment-specific: remove/reset them immediately
  after the intended release. The guard also rejects later migrations, so it
  must be reviewed or retired before phase B or any subsequent migration.
- If a migration adds RLS policies to a tracked public app table, the grant
  audit must show `ENABLE ROW LEVEL SECURITY` and the table's reviewed rollout
  phase must declare the exact `FORCE ROW LEVEL SECURITY` expectation. During
  `SavedSearch` phase A the audit requires `FORCE=false`; phase B changes that
  expectation only in its separate post-skew commit and migration.
- The same post-migration audit is phase-aware for table grants: Release 0
  expects runtime CRUD on `SavedSearch`; Phase A expects exactly
  `SELECT`/`INSERT`/`DELETE` and fails on effective or direct `UPDATE`.
- Non-model public tables created by the migration role can inherit runtime DML
  from default privileges. Add intentional non-model tables to the grant-audit
  inventory or explicitly `REVOKE` runtime access in the same migration.
- Use the pooled `DATABASE_URL` for runtime.
- Avoid rolling back to an app version that cannot read the current schema.
- For failed migrations, stop deploys, inspect the migration in Neon, and ship a forward migration whenever possible.

RLS staging context proof:

- Before enabling RLS on any additional table or wrapping hotter read paths,
  run the staging pooling/context-isolation acceptance spec in
  `docs/db-defense-in-depth-plan.md` against a production-like Neon branch that
  uses the pooled runtime-role `DATABASE_URL`. This gate proves read/context
  isolation on synthetic canary rows through the persistent SECURITY INVOKER
  RPC-shaped fixture. That result is transport-only, not `SavedSearch` policy
  proof; per-table write-policy behavior still needs migration-level tests before
  a real table policy is enabled.
- A laptop/workstation invocation must set
  `RLS_CONTEXT_GATE_LOCALITY_CONFIRM=diagnostic-only`. Its artifact status is
  `diagnostic_passed` or `diagnostic_failed` and is never acceptance-eligible,
  even if every correctness and performance check passes. Production evidence
  must be generated inside the provider-owned Vercel runtime with
  `RLS_CONTEXT_GATE_LOCALITY_CONFIRM=production-runtime`; do not manually
  synthesize `VERCEL`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA`, or
  `VERCEL_DEPLOYMENT_ID` outside Vercel.
- Set `RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION`,
  `RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION`,
  `RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID`, and
  `RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME` to the reviewed staging identities.
  The current reviewed staging target is endpoint
  `ep-bold-recipe-aavx4plv`, database `neondb`, region `westus3.azure`.
  Runtime and admin URLs are rejected unless they identify that exact endpoint,
  database, and region; the runtime URL must be pooled and the admin URL direct.
- The reviewed Grainline placement is Vercel `sfo1` against Neon
  `westus3.azure`. On 2026-07-16, otherwise-identical provider-runtime probes
  measured `sfo1` at 19.0 ms p50 / 19.7 ms p95 and `iad1` at 50.6 ms p50 /
  50.9 ms p95 over 25 warmed, checked-out sequential `SELECT 1` queries.
  `vercel.json` is the single region authority; application routes must not add
  `preferredRegion` overrides.
- On 2026-07-17, provider-runtime slot 1 passed correctness/isolation but failed 10
  performance/adoption checks: wrapped p95 approximately 96--100 ms versus
  39--40 ms autocommit, average hold approximately 93--96 ms versus 37--40 ms,
  and Prisma burst approximately 199 ms versus 78 ms. Slot 2 was correctly
  blocked. Do not rerun unchanged or lower thresholds after the result. The
  failed deployment used a Prisma probe pool of 8. Use the corrected harness:
  retain the uncapped raw control pool/burst at 16, run the Prisma path through
  the app's explicit pool of 10 under that 16-request burst, record both pool
  sizes, mark Prisma acquisition timing unavailable until it is truly measured,
  and add representative SavedSearch route/SLO evidence.
- On 2026-07-19, commit `c188ea4306ed15b1160a8525ad8c38baf934dfa4`
  (deployment `dpl_2U8ccnSKFcgiPUrF9SyYtDYz2woQ`) consumed slot 1 and failed
  with one issue; slot 2 was not called. The one-statement RPC candidate passed
  target and burst p95 comparisons (19.9 ms versus 19.8 ms and 35.5 ms versus
  35.6 ms) with no request/correctness/isolation errors. The sole issue was the
  legacy wrapper-versus-autocommit Prisma burst comparison (146.5 ms versus
  71.0 ms). For SavedSearch Bucket A/Phase A only, that generic legacy latency
  comparison was treated as diagnostic because list/read and delete shipped
  through the measured one-statement RPCs and the remaining wrapped units were
  already transactions. The Bucket B branch has removed that diagnostic escape
  hatch: generic raw and Prisma wrapper-versus-autocommit thresholds are hard
  blocking gates again. The historical run remains failed evidence and cannot be reused.
  Before Bucket B activation, rotate the run id and trigger, deploy a fresh
  attested commit, and retain two new passing slots starting at slot 1.
- Provider transport proof completed 2026-07-19 on Git-integrated Preview commit
  `ef8622b1822bf700d3bc97757a631bdaed503018`, deployment
  `dpl_3xnFJFFr2qt5gZjKDGXzm6Hzk7RD`: slots 1 and 2 both returned
  `runtime_candidate_passed` with `issueCount=0` on the same manifest and run
  id. RPC target/burst p95 was 20.3/36.1 ms and 20.6/37.2 ms, respectively;
  request/correctness/isolation errors were zero. Retained mode-`0600` evidence
  includes both responses plus independent Git SHA/ref/deployment/region
  attestation. Owner-only teardown proved the synthetic RPC absent, all 24
  branch-scoped Preview variables were removed, temporary secrets were deleted,
  and the staging runtime password was rotated after accidental output exposure.
  This clears the synthetic provider transport prerequisite for Release 0 only;
  it is not real-table policy proof and does not authorize Phase A, production
  RLS activation, or Bucket B.
- First run the owner-only setup locally with `diagnostic-only`, the exact
  reviewed endpoint/database values above, `RLS_CONTEXT_GATE_PREPARE=1`, the
  pooled runtime-role URL, and the direct owner URL. Setup prepares the canary,
  durable run-claim ledger, and exact persistent SECURITY INVOKER RPC-shaped
  fixture, proves disable/restore, emits `setup_passed` or `setup_failed`, and
  is never one of the two counted runs. It does not execute the performance
  workload. The same fixture must remain unchanged for both counted repeats.
  Every setup/repeat invocation keeps the explicit
  `RLS_CONTEXT_GATE_CONFIRM=staging-only` guard.
  Before setup, rollback, or teardown mutates anything, its first owner query
  must prove `current_user` and `session_user` both equal the exact username in
  the reviewed direct admin URL and `current_database()` equals the reviewed
  database path. The rollback cleanup must successfully restore both
  `ENABLE` and `FORCE ROW LEVEL SECURITY`, then positively read
  `pg_class.relrowsecurity=true` and `relforcerowsecurity=true`; any ALTER,
  catalog, or connection-close failure makes the setup fail.
- Pin both provider repeats to this exact environment manifest; changing any
  value means the runs are not comparable and both slots must be repeated:

  ```text
  RLS_CONTEXT_GATE_CONFIRM=staging-only
  RLS_CONTEXT_GATE_LOCALITY_CONFIRM=production-runtime
  RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION=sfo1
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION=westus3.azure
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID=ep-bold-recipe-aavx4plv
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME=neondb
  RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime
  RLS_CONTEXT_GATE_REQUESTS=500
  RLS_CONTEXT_GATE_WARMUP_REQUESTS=50
  RLS_CONTEXT_GATE_TURNOVER_REQUESTS=64
  RLS_CONTEXT_GATE_TARGET_CONCURRENCY=8
  RLS_CONTEXT_GATE_BURST_CONCURRENCY=16
  RLS_CONTEXT_GATE_POOL_SIZE=16
  RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS=10000
  RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS=30000
  RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS=35000
  RLS_CONTEXT_GATE_TX_TIMEOUT_MS=5000
  RLS_CONTEXT_GATE_SCHEMA=grainline_rls_canary
  RLS_CONTEXT_GATE_TABLE=context_canary
  ```

  The reviewed code additionally pins Prisma pool size `10`, run-claim table
  `context_gate_run_claim`, policy `context_canary_select`, and RPC
  `context_canary_rpc`. Do not override those code defaults for a counted run.
- Configure the branch-scoped Preview variables before pushing the
  Git-integrated Preview branch. `DATABASE_URL` and
  `RLS_CONTEXT_GATE_DATABASE_URL` must be
  the same byte-for-byte pooled staging runtime-role URL; neither is trimmed or
  normalized, and the Preview route verifies digest equality before claiming a
  run slot. Both URLs require an explicit password, explicit `:5432`, and one
  unencoded, bounded database path segment; disabled Node TLS verification and
  inherited `PGOPTIONS` fail closed. Set a fresh RLS_CONTEXT_GATE_TRIGGER_SECRET,
  a fresh RLS_CONTEXT_GATE_RUN_ID, and
  `RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA` to the exact Git-integrated Preview
  gate commit SHA. This is not the later cleaned production Release 0 SHA:
  removing the temporary runner artifacts necessarily produces a different
  commit.
  The branch-scoped Preview must not contain `DIRECT_URL`,
  `RLS_CONTEXT_GATE_ADMIN_DATABASE_URL`, `RLS_CONTEXT_GATE_EVIDENCE_PATH`, or
  owner-only prepare/rollback/teardown flags; owner credentials remain local to
  setup, rollback, and teardown. Before every new run, retain a fresh read-only
  Vercel environment/deployment inventory rather than relying on the dated
  2026-07-16 baseline.
- Generate both counted passes from one Git-integrated Vercel Preview by POSTing
  run slots `1` then `2` to `/api/internal/rls-context-gate`. The route accepts
  no owner URL and no prepare mode. Configure a temporary 32+ character trigger
  secret, a temporary opaque `RLS_CONTEXT_GATE_RUN_ID`, the exact allowed commit
  SHA, and only the pooled staging runtime URL. The staging ledger atomically
  permits each slot once and does not permit slot 2 until slot 1 is durably
  marked passed, so the two heavy workloads cannot overlap or be replayed. Each
  repeat must benchmark the same persistent one-statement RPC candidate against
  a true one-statement autocommit baseline; a transaction-wrapper baseline is
  retained separately and cannot substitute for that comparison.
- If an exception or failure occurs after a slot is claimed, do not replay,
  reuse, or retry that consumed slot, do not call slot 2, and never edit or
  repair the run-claim ledger. Generate a fresh RLS_CONTEXT_GATE_RUN_ID, create
  a fresh Git-integrated Preview deployment, and restart the two-run sequence
  at slot 1.
- For each slot, retain the sanitized Preview HTTP response outside the
  repository with mode `0600` and require all of: HTTP `200`,
  `run.status=runtime_candidate_passed`, `result.issueCount=0`,
  `locality.runtimeEvidenceCandidate=true`,
  `locality.acceptanceEligible=false`, the requested `runner.runSlot`, and
  `run.commitSha` and `run.deploymentId` matching independent deployment attestation.
  A provider response that misses any
  check is not a counted pass.
- Treat the previous gate trigger secret as exposed because it appeared in
  captured tool/session output. Rotate it before the next run, delete local
  temporary files containing it after preserving sanitized evidence, and verify
  the prior value is rejected. The temporary Preview artifact contains the
  runner route and an exemption for only the exact
  `/api/internal/rls-context-gate` middleware path. Run
  `node --test tests/rls-context-runner-route.test.mjs` against that artifact.
  Release 0 and every production artifact must exclude the route, exact
  exemption, and every exact, renamed, copied, or symlinked runner-only
  regression test. The production deploy guard recursively scans `tests` and
  treats every test-tree symlink as a blocking artifact, so renaming the test
  cannot evade the exclusion.
- Rotate the Vercel deployment-protection bypass before using the Preview if a
  prior value appeared in any tool or audit output. Treat that bypass separately
  from the gate trigger token and never retain either value in evidence.
- The two repeat calls must have identical gate, pool, concurrency, timeout,
  package, Vercel-region, and Neon identity configuration. Their artifacts only
  set `runtimeEvidenceCandidate=true`; they always set
  `acceptanceEligible=false`. Independently inspect the Vercel deployment and
  retain an attestation that its Git source/ref/SHA/id matches both artifacts.
  A CLI deployment or self-reported environment variables are not sufficient.
  Remove the trigger secret, run id, allowed SHA, and staging URL immediately
  after capture, then delete the temporary Preview after evidence is retained.
- Corrected provider responses must pass before production Release 0 begins, with independent
  deployment attestation retained. Release 0: RLS remains off throughout. Production activation is
  three releases, not one: (0) deploy the ordered
  pre-RLS owner-RPC migrations (`20260717024500_add_saved_search_owner_rpcs`,
  then `20260717025000_harden_saved_search_owner_rpc_projection`) while RLS is
  off, verify both, then deploy Git-attested
  `sfo1` app code using the pooled non-owner role; (A) exact policies plus
  `NO FORCE` and `ENABLE`; then (B) a separate validated `FORCE` migration.
  Phase B remains a separate reviewed migration.
  Because `vercel.json` runs every pending migration, the Release 0
  artifact/cherry-pick must exclude the later phase-A RLS policy migration. A
  12-hour wait is only a minimum observation window, not a
  drain proof: disable superseded callable deployments or rotate/revoke their
  owner runtime credentials, and retain `pg_stat_activity` evidence that no
  owner-backed application sessions remain. Before phase B, explicitly choose
  and test how owner-run migrations, maintenance, restore drills, and emergency
  repair access `SavedSearch` after `FORCE`. Roll back the DB (`DISABLE ROW LEVEL
  SECURITY`) before rolling back application code.
- SavedSearch Phase B uses `SAVED_SEARCH_RLS_DEPLOY_PHASE=phase-b-reviewed`
  only on the separately fingerprinted artifact containing
  `20260720060000_force_saved_search_rls`. For the 2026-07-19 Phase-A
  deployment `dpl_H5tnmGyL8fK3oriwawjHBhg2Yomz`, do not promote Phase B before
  `2026-07-20T06:25:00Z`: this is later than the full 12-hour skew window, adds
  a safety margin, and allows the 06:20 UTC scheduled canary to prove health
  after skew. Time is still not drain proof. Before setting the phase value,
  rotate the `neondb_owner` password, update the future Production
  `DIRECT_URL` without changing runtime `DATABASE_URL`, prove the prior owner
  credential is rejected, close rollout tooling connections, and retain a
  sanitized `pg_stat_activity` count of zero other `neondb_owner` client
  sessions. The migration repeats that zero-other-session check and fails
  before `FORCE` if it finds drift. Remove the phase value immediately after
  the exact deployment.
- The Phase-B owner strategy uses Neon `neondb_owner` as the explicit
  `NOSUPERUSER BYPASSRLS` migration/service role; FORCE constrains the normal
  non-owner runtime but does not constrain that reviewed owner credential.
  Controlled owner row maintenance and restore drills therefore use the direct
  owner connection in a bounded transaction without weakening policies.
  Emergency rollback separately takes a bounded table lock, `DISABLE ROW LEVEL
  SECURITY`, performs only the approved recovery, and restores `ENABLE` plus
  `FORCE` with exact catalog verification when the incident permits. `npm run
  audit:rls-saved-search-force` proves both reversible paths on the independently
  reviewed staging endpoint and retains a mode-`0600` artifact. The owner
  credential remains a tracked Vercel Function-environment residual and must be
  externalized before Bucket B. For an application rollback after Phase B,
  disable RLS at the database first; never roll app code back while FORCE remains active.
- After Release 0, the exact real-table SavedSearch gate, including policy/RPC,
  route-fixture, grant/canary, and rollback proof, must pass before Phase A.
  Those are pre-Phase-A gates, not pre-Release-0 transport gates. Bucket B is
  explicitly paused and requires a separate pass after Bucket A.
- Keep `RLS_CONTEXT_GATE_POOL_SIZE` at or above
  `RLS_CONTEXT_GATE_BURST_CONCURRENCY`. The gate enforces this so its reported
  2x burst workload cannot be silently reduced by a smaller client pool.
  This raw control pool is not application-topology proof: the separate Prisma
  probe must use and record the reviewed deploy pool, and unavailable acquisition
  timing must not be emitted or interpreted as zero wait.
- `RLS_CONTEXT_GATE_PREPARE=1` intentionally leaves the synthetic canary schema,
  table, policy, run-claim ledger, rows, and persistent SECURITY INVOKER
  RPC-shaped fixture in staging. Setup toggles and restores RLS; it does not
  clean up that canary or function. Only after both counted artifacts and the
  independent deployment attestation are retained and sanitized may the owner
  run `RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE=1` with the direct owner URL to remove
  the function. The runtime role must never perform teardown.
- Use `RLS_CONTEXT_GATE_EVIDENCE_PATH` only for local owner-only setup,
  rollback, and teardown invocations; its writer enforces mode `0600`. The two
  provider repeats do not write that local path: their sanitized HTTP response
  bodies must be captured separately outside the repository with mode `0600`.
  The provider HTTP response is not an `RLS_CONTEXT_GATE_EVIDENCE_PATH`
  artifact. Retained evidence must not contain database URLs or credentials.
- The artifact includes a warmed, checked-out, sequential 25-query `SELECT 1`
  RTT proxy to help explain locality. This metric is diagnostic only and must
  never be subtracted from, used to normalize, or used to discount the gate's
  unchanged latency and connection-hold thresholds.
- To rerun only the non-counted rollback/no-op setup proof with an already
  prepared canary, add
  `RLS_CONTEXT_GATE_ROLLBACK_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL"`.
  This temporarily disables RLS only on the synthetic canary table, verifies the
  transaction-local wrapper remains harmless, then restores `ENABLE`/`FORCE ROW
  LEVEL SECURITY`.
- Retain from the two sanitized provider responses plus independent attestation
  the provider-owned Vercel commit SHA and deployment id, staging branch,
  expected/observed execution and database regions, sanitized role names,
  Prisma transaction `timeout`/`maxWait`, app `pg` pool size, Neon pool
  settings, Prisma adapter/`pg` package versions, target and burst concurrency,
  sample size, connection turnover/recycling method, prototype table/policy
  names, autocommit baseline, transaction baseline, and wrapped p95/p99
  latency. The RPC-specific transport evidence must also retain the true
  one-statement autocommit baseline and one-statement RPC candidate metrics,
  measured connection acquisition wait or an explicit `unavailable`
  marker plus the substitute queue/timeout probe, connection-hold time,
  pool-saturation result, prepared-statement/cached-plan error scan result, and
  any failed request or Sentry event ids.
- The earlier workstation artifact
  `context-gate-failed-pre-pool-fix.json` is retained only as failed diagnostic,
  pre-pool-fix evidence. It cannot satisfy either required production-runtime
  pass.
- Treat a correctness failure, context leak, `Promise.all`/parallel query inside
  an interactive RLS transaction, Prisma transaction timeout/`maxWait`, pool
  saturation, prepared-statement/cached-plan/protocol error, connection-recycle
  mismatch, or flaky repeated result as a stop signal. Keep app-layer
  authorization plus the least-privilege runtime role as the active database
  defense until the root cause is fixed and the full staging gate passes again.
- Before promoting the first real-table `SavedSearch` policy, seed a
  non-customer staging user with a known saved-search row. Require the exact row
  id through API, account, dashboard, and export reads, then exercise deletion
  and account-cleanup entry points and verify the row is gone under the same
  trusted target-user context. A successful response with an empty collection
  is a missing-context failure when the fixture exists. Retain only bounded
  synthetic ids/counts.
- Before phase A, verify the static SavedSearch guard rejects Prisma
  `createManyAndReturn`/`updateManyAndReturn`, relation
  `include`/`select: { savedSearches: ... }`, raw `TRUNCATE`/`MERGE`/`COPY`, and
  dynamically constructed identifiers. Also retain the account-deletion test
  for the outer context transaction's `timeout: 30000` and `maxWait: 10000`.
- Also verify the AST owner-RPC callsite allowlist. The database functions do
  not authenticate `p_user_id`; they trust the application assertion. Reviewed
  user-facing calls must pass server-resolved `me.id` (or account-export
  `user.id`), while ops health may pass only the strictly validated paired
  synthetic-canary `userId`. Direct named-import aliases and direct namespace
  calls must remain visible; local rebinding, computed namespace access,
  re-export, dynamic import, and CommonJS `require` must fail the guard. New
  callsites and changed first-argument expressions also require review.
- Record this residual boundary in the promotion review: the source allowlist
  protects reviewed application paths, but a compromised runtime credential or
  arbitrary SQL execution can assert another syntactically valid id through the
  RPC/GUC. When reviewed code supplies the correct authenticated id, Phase A
  catches missing query scoping and absent context; it does not catch a wrong
  asserted id and is not database-authenticated isolation against that
  principal.
- Record a second deployment-credential residual: `vercel.json` currently runs
  owner migrations during the production build, and Vercel project environment
  variables are available to Function execution as well as the Build Step.
  Consequently `DIRECT_URL`/the migration-owner credential remains available to
  production application functions after the build. Release 0/Phase A still
  reduce accidental context omission and wrong-scoped queries issued through
  the non-owner `DATABASE_URL`; they do not isolate arbitrary application code
  execution from the owner credential. Track a separate release-engineering
  follow-up to move owner migration plus grant-audit execution into an isolated
  deployment pipeline and then remove `DIRECT_URL` and `MIGRATION_DB_ROLE` from
  the production Function environment. Complete that follow-up before expanding
  Bucket B or treating RLS as protection from arbitrary runtime code.
- The reviewed successor is
  `docs/runtime-db-credential-separation.md`. Its staged release removes
  migrations from `vercel.json`, disables automatic `main` deployment, fails
  every Vercel build containing an owner/admin database key, and moves
  migrations to a manually approved `Production` environment on exact `main`.
  Removing Vercel variables is not sufficient: rotate the owner again after
  removal so the credential embedded in the current and superseded deployments
  is rejected, and store the replacement only in the protected migration
  environment plus the mode-0600 local operator file. Do not treat this staged
  code as production-active before its separate post-Phase-B rollout passes.
- Verify the list function's explicit 16-column SQL projection and the helper's
  matching application projection. SQL columns must remain in PostgreSQL
  physical `attnum` order for the `SETOF public."SavedSearch"` return contract.
  The exact raw `pg_proc.prosrc` SHA-256 for
  both owner RPCs must match the reviewed source inventory; an unreadable body
  or any drift is a hard grant-audit failure.
- The staging real-table gate must seed one owner row with non-null,
  pairwise-distinct same-type sentinels and verify all 16 named fields through
  the filtered list RPC. Do not reduce this probe to `id`/`userId`/`query`;
  doing so would stop runtime detection of silent positional swaps among the
  integer, float, and text columns.
- Keep one separate, permanent non-customer `SavedSearch` canary pair for and
  after the rollout. Create or re-verify it only with
  `SAVED_SEARCH_RLS_CANARY_SEED_CONFIRM=reviewed-permanent-canary SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_ENDPOINT_ID='<independently reviewed ep-* id>' SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_NAME='<database>' SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_REGION='<region>' SAVED_SEARCH_RLS_CANARY_SEED_DATABASE_URL='<pooled runtime-role URL>' SAVED_SEARCH_RLS_CANARY_SEED_ADMIN_DATABASE_URL='<direct owner URL>' SAVED_SEARCH_RLS_CANARY_SEED_EVIDENCE_PATH='<outside-repository mode-0600 path>' SAVED_SEARCH_RLS_CANARY_USER_ID='<paired synthetic user id>' SAVED_SEARCH_RLS_CANARY_SEARCH_ID='<paired synthetic search id>' npm run seed:rls-saved-search-canary`.
  The idempotent seed refuses collisions, pins the user as banned so public
  member counts are unaffected, pins `notifyEmail=false`, and verifies the row
  plus post-commit context cleanup through the pooled runtime role. Set both
  `SAVED_SEARCH_RLS_CANARY_USER_ID` and
  `SAVED_SEARCH_RLS_CANARY_SEARCH_ID` to ids sharing the required lowercase-hex
  nonce in the app environment and retain that exact row. The seed artifact
  contains database identity plus status only, never the ids, email, row, URL,
  or credentials. `/api/cron/ops-health` performs one exact-id,
  owner-context lookup through the normal one-statement owner RPC. Missing,
  partial, malformed, mismatched, zero-row, duplicate, wrong-row, invalid, or
  failed-query results are unhealthy. The canary itself adds only the bounded
  status and issue count to Sentry, `CronRun.result`, and the HTTP response; it
  never attaches the ids, row payload, or caught database error. Global
  Prisma/platform logging remains governed by the general production logging
  policy.
- Sequence canary setup so monitoring cannot create a preactivation outage:
  seed and verify the retained row first; set both canary environment variables
  together in the target environment while the old release still ignores them;
  then deploy the canary-aware ops-health code with RLS still off and immediately
  require `savedSearchRlsCanaryStatus=healthy`. Deploying that code before both
  variables exist intentionally produces `configuration_missing` or
  `configuration_partial`, one actionable issue, and an ops-health 503. Keep the
  variables set through phase A and phase B. To retire the canary, first deploy
  code that no longer requires it, then remove the variables and synthetic row.
- After applying the Phase-A migration to staging, run the exact policy and
  cross-user behavior gate with the reviewed identities. The gate must execute
  the real `grainline_saved_search_list` owner list/read path and
  `grainline_saved_search_delete_one` owner/foreign delete-one behavior, not a
  synthetic proxy. The preceding live grant audit must also prove the exact raw
  function-body fingerprints, explicit `SavedSearch` projection, and the
  Phase-A `SELECT`/`INSERT`/`DELETE`-only runtime grant. Retain its
  credential-free mode-`0600` artifact outside the repository. Supply
  `REVIEWED_PRODUCTION_DATABASE_ENDPOINT_ID` from independently reviewed Neon
  production inventory; do not derive it from either staging gate URL:
  `SAVED_SEARCH_RLS_GATE_CONFIRM=staging-only SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID=ep-bold-recipe-aavx4plv SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID="$REVIEWED_PRODUCTION_DATABASE_ENDPOINT_ID" SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME=neondb SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION=westus3.azure SAVED_SEARCH_RLS_GATE_DATABASE_URL="$STAGING_RUNTIME_URL" SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL="$STAGING_DIRECT_URL" SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH="/private/tmp/saved-search-rls-staging.json" npm run audit:rls-saved-search`.
- Never point the mutating `audit:rls-saved-search` fixture gate at production.
  After production rollout or any Neon pooler, Prisma, `@prisma/adapter-pg`,
  `pg`, transaction-timeout, runtime-role, grant, or policy change, run the
  non-mutating catalog/grant audit from a clean checkout and verify retained
  non-customer canary ids through the live route reads. Repeat the mutating
  cross-user fixture gate on isolated staging before promoting a configuration
  change. Keep owner-invariant and live canary evidence bounded to internal ids
  or hashes.

## Cron and Email Outbox

1. Check the hourly `/api/cron/ops-health` Sentry warning first; it polls failed `CronRun` rows from the last 24 hours, completed cron rows with partial record failures, stale `RUNNING` cron rows, stale email outbox jobs, dead email outbox jobs, overdue support requests, failed or stale unprocessed `StripeWebhookEvent`, `ResendWebhookEvent`, and `ClerkWebhookEvent` rows, failed or stale `AccountDeletionSideEffect` rows, and the retained non-customer `SavedSearch` RLS canary. Completed cron partial failures include non-empty `failures`/`errors` arrays plus positive scalar `failed`, `manualReview`, or `partialIssueCount` counters. For a canary `configuration_*` status, correct both paired environment variables before retrying. For `not_found`, `wrong_row`, `duplicate`, `invalid_result`, or `query_failed`, verify the retained synthetic row and runtime-role/context wiring without copying raw ids or database errors into logs or tickets. If a new RLS activation plausibly caused silent denial, disable RLS at the database first according to the rollout rollback order, then diagnose the app release. Also check webhook failure spike alerts for repeated provider edge failures.
2. Check `/api/cron/*` logs in Vercel for route-level failures.
3. Check `CronRun` rows with `status = FAILED` in the last 24 hours.
4. Check Sentry for cron route exceptions and failed cron check-ins.
5. For abandoned direct uploads, inspect `DirectUpload` rows by `status`, `cleanupAfter`, `attempts`, `endpoint`, and `lastError`. `/api/cron/direct-upload-cleanup` deletes expired unclaimed direct-upload keys from R2 and reports per-row failures in `CronRun.result.failures`; investigate repeated `DELETE_FAILED` rows before manually deleting objects.
6. For email delays, inspect `EmailOutbox` rows by `status`, `nextAttemptAt`, `attempts`, `dedupKey`, and `lastError`. Retryable provider sends use `dedupKey` as the Resend idempotency key, so check the Resend dashboard before manually resending a stuck `PROCESSING` row. `SENT`, `SKIPPED`, and `DEAD` rows are pruned after 30 days by the daily notification-prune cron.
7. Keep outbox draining at bounded concurrency; do not manually send large batches outside the quota guard.

## Support and Legal Requests

Public requests are recorded in `SupportRequest`.

- General support form: `/support` -> `/api/support`.
- Privacy/account data request form: `/legal/data-request` -> `/api/legal/data-request`.
- Data requests are intentionally public and available to suspended or deleted-session users.
- Each request gets a 45-day `slaDueAt` timestamp.
- Admin queue: `/admin/support`.
- Legal requests route notification email to `legal@thegrainline.com`.
- Support requests route notification email to `support@thegrainline.com`.

If notification email fails, the request still remains in `SupportRequest` with `emailLastError`. Admins should process overdue or failed-notification requests from `/admin/support`.

### Processor-side privacy requests

Local account deletion, export, and outbox pruning cover Grainline-owned storage. They do not automatically erase provider-held copies. For privacy requests that ask for deletion, export, retention evidence, or vendor-side suppression across processors:

1. Keep the `SupportRequest` open or `IN_PROGRESS` until provider-side checks are complete or counsel documents that provider retention applies.
2. Record the requester by local user id and hashed email when possible. Avoid raw email in internal notes unless it is needed for provider lookup.
3. Resend: check sent-message, bounce, complaint, suppression, and webhook event records for the requester. If deletion, export, or suppression is required, use the Resend dashboard or support path and record the provider ticket id, date, owner, and outcome. Do not assume `EmailOutbox` or `ResendWebhookEvent` pruning deletes provider copies.
4. Stripe, Clerk, Shippo, Sentry, Cloudflare, UploadThing/UTFS legacy media, Neon, Upstash, and Vercel: determine whether the request is a deletion, export, suppression, or legal-retention exception, then use the provider dashboard or support path and record the evidence URL or ticket id.
5. Close the `SupportRequest` only after local action, provider action or exception, requester response, owner, and completion date are recorded.

Closed support and privacy data-request rows are pruned by the daily `notification-prune`
maintenance cron after the 2-year application retention window. Keep requests `OPEN`
or `IN_PROGRESS` while provider follow-up, requester response, or legal-hold review is
still active; do not close a data request until the closure evidence would be safe to
retain until that prune window expires.
