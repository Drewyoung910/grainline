# Grainline Operations Runbook

Last updated: 2026-07-10

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
5. In Stripe Dashboard, filter failed events and replay after the app is healthy.
6. Verify `StripeWebhookEvent` rows show processed state for replayed events.
7. For checkout or refund incidents, compare Stripe charge/payment/refund IDs against `OrderPaymentEvent`.
8. If a seller refund, staff case refund, or blocked-checkout refund was accepted by Stripe, confirm the refund ID is durably recorded on the `Order`, in `OrderPaymentEvent`, and in the related `SystemAuditLog` entry. For reverse-transfer refunds, also inspect `metadata.refundAccounting.transferReversalId` and `transferReversalAmountCents` when Stripe returned them so buyer refund amount and seller recovery are not conflated. If the Stripe webhook delivery is still failed, replay it rather than issuing another manual refund first; the blocked-checkout refund idempotency key is session-scoped.
9. For first-party refund recovery incidents, check Sentry tags `seller_refund_orphaned_after_stripe`, `seller_refund_orphan_record_failed`, `case_refund_orphaned_after_stripe`, `case_refund_orphaned_review_update_failed`, `stripe_webhook_blocked_checkout_orphaned_after_stripe`, `stripe_webhook_blocked_checkout_orphan_record_failed`, `stripe_webhook_blocked_checkout_refund`, and `stripe_webhook_blocked_checkout_refund_notification`. Notification failures are warning telemetry. Refund errors without a Stripe refund ID mean the local sentinel was released and the route/webhook should remain failed/retryable so Stripe can retry the refund attempt; orphan-record failures mean local refund evidence may be incomplete and the failed request/webhook should stay retryable until the refund ID is recorded in all three local evidence surfaces.
10. For label purchases with Sentry tag `shippo_label_purchase_ambiguous`, check Shippo for a transaction tied to the order/rate before clearing `labelStatus` or retrying. If Shippo created a label, write the transaction, label URL, tracking, and label-cost fields to the order and reconcile the Stripe label clawback; if Shippo did not create a label, staff may clear the review hold and label status before retry.
11. For Stripe Connect orderability drift, check recent `SystemAuditLog` rows for `STRIPE_ACCOUNT_CHARGES_UPDATED` or `STRIPE_ACCOUNT_DEAUTHORIZED`, then check the latest `CronRun` for `stripe-connect-reconcile`. The six-hour reconciliation cron is a backstop for missed account-state events, not a substitute for replaying failed Stripe webhook deliveries.

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
- Current staging role/grant template:
  `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=grainline_migration_owner -f scripts/provision-runtime-db-role.sql`.
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
- After migrations that add tables, sequences, `grainline_*` functions, enum
  types, or role/default-privilege changes, run `npm run audit:db-grants` from
  the same environment/secret set that will run migrations and retain the run
  output with deploy evidence.
- If a migration adds RLS policies to a tracked public app table, the grant
  audit must also show both `ENABLE ROW LEVEL SECURITY` and
  `FORCE ROW LEVEL SECURITY`; a policy without table-level RLS enabled is inert.
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
  isolation on synthetic canary rows; per-table write-policy behavior still
  needs migration-level tests before a real table policy is enabled.
- If the staging canary table/policy has not been prepared or needs refresh,
  run the gate with the direct migration-owner URL and pooled runtime-role URL:
  `RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_PREPARE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL" RLS_CONTEXT_GATE_DATABASE_URL="<pooled runtime-role URL>" RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime RLS_CONTEXT_GATE_EVIDENCE_PATH="rls-context-gate-evidence.json" npm run audit:rls-context`.
- For repeat runs after the canary is already prepared:
  `RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_DATABASE_URL="<pooled runtime-role URL>" RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime RLS_CONTEXT_GATE_EVIDENCE_PATH="rls-context-gate-evidence-rerun.json" npm run audit:rls-context`.
  Keep `RLS_CONTEXT_GATE_DATABASE_URL` on the pooled runtime-role URL, not
  `DIRECT_URL`; `DIRECT_URL` is only for the optional `RLS_CONTEXT_GATE_PREPARE=1`
  setup path.
- Retain the sanitized evidence JSON from `RLS_CONTEXT_GATE_EVIDENCE_PATH` with
  launch/RLS records. It must not contain database URLs or credentials.
- To rerun only the rollback/no-op portion with an already prepared canary, add
  `RLS_CONTEXT_GATE_ROLLBACK_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL"`.
  This temporarily disables RLS only on the synthetic canary table, verifies the
  transaction-local wrapper remains harmless, then restores `ENABLE`/`FORCE ROW
  LEVEL SECURITY`.
- Retain the commit SHA, CI run id, staging branch, sanitized role names,
  Prisma transaction `timeout`/`maxWait`, app `pg` pool size, Neon pool
  settings, Prisma adapter/`pg` package versions, target and burst concurrency,
  sample size, connection turnover/recycling method, prototype table/policy
  names, autocommit baseline, transaction baseline, and wrapped p95/p99
  latency, connection acquisition wait, connection-hold time, pool-saturation
  result, prepared-statement/cached-plan error scan result, and any failed
  request or Sentry event ids.
- Treat a correctness failure, context leak, `Promise.all`/parallel query inside
  an interactive RLS transaction, Prisma transaction timeout/`maxWait`, pool
  saturation, prepared-statement/cached-plan/protocol error, connection-recycle
  mismatch, or flaky repeated result as a stop signal. Keep app-layer
  authorization plus the least-privilege runtime role as the active database
  defense until the root cause is fixed and the full staging gate passes again.
- After production RLS rollout, rerun the gate after Neon pooler, Prisma,
  `@prisma/adapter-pg`, `pg`, transaction timeout, runtime role, grant, or policy
  changes. Keep any sampled owner-invariant checks or synthetic canary probes on
  non-customer rows and log only bounded internal ids or hashes.

## Cron and Email Outbox

1. Check the hourly `/api/cron/ops-health` Sentry warning first; it polls failed `CronRun` rows from the last 24 hours, completed cron rows with partial record failures, stale `RUNNING` cron rows, stale email outbox jobs, dead email outbox jobs, overdue support requests, failed or stale unprocessed `StripeWebhookEvent`, `ResendWebhookEvent`, and `ClerkWebhookEvent` rows, and failed or stale `AccountDeletionSideEffect` rows. Completed cron partial failures include non-empty `failures`/`errors` arrays plus positive scalar `failed`, `manualReview`, or `partialIssueCount` counters. Also check webhook failure spike alerts for repeated provider edge failures.
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
