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
- `npx dotenv-cli -e .env -- npx prisma migrate deploy`
- `npx dotenv-cli -e .env -- npx prisma migrate status`
- `psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=grainline_migration_owner -f scripts/provision-runtime-db-role.sql` (staging first; production only after role/password setup is approved and recorded)
- `GRANT_AUDIT_DATABASE_URL="$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=grainline_migration_owner npm run audit:db-grants`
- `RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_PREPARE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL="$DIRECT_URL" RLS_CONTEXT_GATE_DATABASE_URL="<pooled runtime-role URL>" RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime RLS_CONTEXT_GATE_EVIDENCE_PATH="rls-context-gate-evidence.json" npm run audit:rls-context` (staging only; includes the synthetic canary rollback/no-op probe and writes sanitized JSON evidence; keep production RLS disabled until this gate plus route-level prototype tests pass)
- `STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM=live-read STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH="stripe-webhook-subscriptions-evidence.json" npm run audit:stripe-webhooks` (live Stripe read-only; verifies the classic snapshot webhook endpoint and Connect v2 thin event destination URLs/event families; does not prove deployed signing-secret values)
- `STRIPE_MONEY_PROOF_CONFIRM=test-mode STRIPE_MONEY_PROOF_DB_CONFIRM=staging-or-local STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID="<acct_test...>" STRIPE_MONEY_PROOF_EVIDENCE_PATH="stripe-money-proof-evidence.json" npm run audit:stripe-money` (Stripe test mode plus staging/local DB only; writes sanitized money-movement evidence for refunds and label clawbacks)
- `R2_UPLOAD_SMOKE_CONFIRM=write-delete R2_UPLOAD_SMOKE_EVIDENCE_PATH="r2-upload-smoke-evidence.json" npm run audit:r2-upload` (production-like R2 credentials; writes and deletes synthetic objects, verifies R2 metadata, public availability, public root listing behavior, and writes sanitized evidence)
- `DEPLOYED_HEADERS_PROOF_CONFIRM=production-read DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH="deployed-security-headers-evidence.json" npm run audit:deployed-headers` (production domain only; writes sanitized evidence for enforced root security headers and `/api/health` private cache/vary headers; does not replace securityheaders.com, SSL Labs, or hstspreload.org records)
- `SENTRY_CRON_PROOF_CONFIRM=live-read SENTRY_ORG_SLUG="<org>" SENTRY_PROJECT_SLUG="<project>" SENTRY_CRON_PROOF_EVIDENCE_PATH="sentry-cron-alert-evidence.json" npm run audit:sentry-crons` (live Sentry read-only; verifies every `vercel.json` cron has a matching monitor and configured alert routing includes the launch-critical warning terms; does not replace dashboard evidence for delivered notifications)
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
- Clerk and Resend webhook delivery.
- Cloudflare R2 public bucket-listing/ListBucket posture, bucket-level max object-size setting, CORS/public-domain settings, and upload smoke-test artifact from `npm run audit:r2-upload`.
- Neon backup/PITR setting and most recent restore drill.
- Sentry alert rules for CSP/script/frame violations, production error spikes, Sentry cron monitors, `source=cron_ops_health` warnings including completed-cron partial record failures, `AccountDeletionSideEffect` cleanup issues, direct-upload cleanup failures, and webhook failure spike messages, including the read-only artifact from `npm run audit:sentry-crons` plus dashboard screenshots or exported notification-delivery evidence.
- Google Search Console ownership verification and sitemap index submission.

## Business And Legal

- Attorney sign-off on Terms and Privacy.
- DRAFT banners removed only after attorney sign-off.
- Clickwrap and age-attestation decision finalized.
- Money transmitter analysis documented.
- INFORM Consumers Act scope documented.
- Business insurance decision documented.
- Texas marketplace facilitator filing calendar set.
- DMCA agent details verified.
