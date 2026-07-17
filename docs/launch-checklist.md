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
- First query `public."SavedSearch"` ownership through `DIRECT_URL` and retain the
  result. For this rollout, both `current_user`/`session_user` and the table owner
  must be `neondb_owner`; do not substitute a planned role name.
- `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=neondb_owner -f scripts/provision-runtime-db-role.sql` to converge the reviewed runtime role, current grants, and migration-owner default privileges before migration.
- `npx dotenv-cli -e .env -- npx prisma migrate deploy`
- `npx dotenv-cli -e .env -- npx prisma migrate status`
- `GRANT_AUDIT_DATABASE_URL="$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=neondb_owner npm run audit:db-grants` only after migration/status, so the exact audit covers the final catalog and proves runtime DML was revoked from `_prisma_migrations` and every other untracked public table. Run from a clean checkout of the exact release commit so untracked migration files cannot change the source-derived audit inventory.
- A future branch may substitute `MIGRATION_DB_ROLE=grainline_migration_owner` only after catalog evidence proves that dedicated role actually owns every tracked app object; it is not the owner for this rollout.
- Non-counted owner setup passed via `npm run audit:rls-context` against exact reviewed staging endpoint `ep-bold-recipe-aavx4plv`, database `neondb`, and region `westus3.azure`, using the pooled runtime URL plus direct admin URL; write its sanitized `setup_passed` artifact to a distinct `RLS_CONTEXT_GATE_EVIDENCE_PATH` (mode `0600`) and retain it separately.
- Two identical repeat-mode POSTs (run slots `1`, then `2`) must pass through one Git-integrated Vercel Preview in `sfo1`. The latest slot 1 is not a pass: correctness/isolation succeeded, but 10 performance/adoption checks failed (wrapped p95 approximately 96--100 ms versus 39--40 ms autocommit, average hold approximately 93--96 ms versus 37--40 ms, and Prisma burst approximately 199 ms versus 78 ms), and the ledger correctly blocked slot 2. That deployment used a Prisma probe pool of 8. Before retrying, use the corrected harness with an uncapped raw control pool/burst of 16 and the application Prisma pool of 10 under the 16-request burst, record both pool sizes, represent unavailable Prisma acquisition timing honestly instead of as zero, and add SavedSearch route/SLO evidence. Do not lower thresholds after seeing the result. Promotion still requires both sanitized `runtimeEvidenceCandidate` artifacts plus independent Vercel deployment source/ref/SHA/id attestation. Neither artifact may self-assert `acceptanceEligible=true`.
- Vercel Preview deployment-protection bypass rotated after any audit-log exposure and kept separate from the gate trigger token.
- The previous Preview runner trigger secret is treated as exposed because it appeared in captured tool/session output. Rotate it before another run, delete local temporary files containing it after sanitized evidence is retained, prove the old value fails, then remove the new trigger secret, opaque run id, allowed commit SHA, and staging runtime URL after capture and delete the temporary Preview. The internal runner must never be merged or enabled in production.
- RLS locality evidence records a warmed, checked-out, sequential 25-query `SELECT 1` RTT proxy for diagnosis only. Do not normalize, subtract, or discount the unchanged acceptance thresholds with it. The prior `context-gate-failed-pre-pool-fix.json` laptop artifact is failed diagnostic-only evidence and satisfies neither required pass.
- First real-table `SavedSearch` proof must be retained: a known non-customer fixture is returned by exact id through API/account/dashboard/export reads, deletion and account-cleanup paths remove it under trusted target-user context, and direct DB denial/rollback tests pass. Empty 200 responses do not count when the fixture exists. Before phase A, the static guard also rejects every direct or aliased Prisma `savedSearch` delegate access outside the owner helper, Prisma `createManyAndReturn`/`updateManyAndReturn`, literal relation `include`/`select: { savedSearches: ... }`, raw `TRUNCATE`/`MERGE`/`COPY`, all `Prisma.raw`, and every new unreviewed `$queryRawUnsafe`/`$executeRawUnsafe` escape hatch. The guard does not claim whole-program data-flow proof for indirectly assembled relation objects, so clean-checkout review of changed raw/query-construction code remains mandatory. The account-deletion test pins `timeout: 30000`/`maxWait: 10000` on its outer context transaction.
- A separate permanent non-customer `SavedSearch` canary row must be seeded and retained with `npm run seed:rls-saved-search-canary` using independently reviewed database identity, pooled runtime and direct owner URLs, and a mode-`0600` artifact path. The idempotent seed proves the synthetic user is banned, `notifyEmail=false`, exact runtime-role visibility, and post-commit context cleanup without retaining ids or credentials. Sequence this before the canary-aware release: seed/verify the row, set both matching nonce environment variables together while the old release ignores them, deploy ops-health code with RLS still off, and immediately require `savedSearchRlsCanaryStatus=healthy`. If the code is deployed first, missing/partial configuration intentionally produces an actionable ops-health 503; that is a failure signal, not an alternate approved sequence. Keep both variables through phase A/B; remove them only after a later code release stops requiring the canary. Require healthy status before Phase A, immediately after Phase A, and after the release-skew window. Canary-owned retained monitoring evidence contains only status/counts and never attaches canary ids, row data, or caught database errors.
- The staging exact-policy gate must pass and its mode-`0600` artifact must be retained outside the repository. `REVIEWED_PRODUCTION_DATABASE_ENDPOINT_ID` comes from independently reviewed Neon production inventory, not either staging URL: `SAVED_SEARCH_RLS_GATE_CONFIRM=staging-only SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID=ep-bold-recipe-aavx4plv SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID="$REVIEWED_PRODUCTION_DATABASE_ENDPOINT_ID" SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME=neondb SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION=westus3.azure SAVED_SEARCH_RLS_GATE_DATABASE_URL="$STAGING_RUNTIME_URL" SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL="$STAGING_DIRECT_URL" SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH="/private/tmp/saved-search-rls-staging.json" npm run audit:rls-saved-search`. Never run this mutating fixture gate against production; use the clean-checkout catalog/grant audit plus bounded live route reads of retained non-customer canary ids for production verification.
- Execute `SavedSearch` production activation as three releases: runtime/context on pooled `grainline_app_runtime` with RLS off; exact policies + `NO FORCE` + `ENABLE`; and a separate `FORCE` release. A 12-hour wait is not drain proof: disable superseded callable deployments or rotate/revoke their owner runtime credentials, then retain `pg_stat_activity` evidence that owner-backed application sessions are gone. Before `FORCE`, choose and test the owner/maintenance path for migrations, restore drills, controlled maintenance, and emergency repair. Production provisioning uses the actual migration owner (`neondb_owner` for this rollout), and emergency rollback disables RLS before any app rollback. This pass stops after Bucket A (`SavedSearch`); Bucket B/`Notification` design is separate.
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
