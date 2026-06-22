# Grainline Launch Checklist

This checklist is for the final pre-launch pass before accepting live marketplace transactions.

## Environment Variables

Confirm production and preview values in Vercel:

- `NEXT_PUBLIC_APP_URL`
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
- Stripe: `thegrainline.com` registered for Apple Pay/payment method domains.
- Stripe: PCI SAQ A completed and evidence retained with launch records.
- Stripe/payment pages: checkout-page script inventory completed in `docs/checkout-script-inventory.md`; CSP reports from checkout pages verified in Sentry.
- Resend: sending domain verified.
- Resend/DNS: SPF, DKIM, and DMARC policy verified. Move DMARC to `p=reject` only after monitoring shows legitimate mail is aligned.
- Resend: webhook endpoint registered at `https://thegrainline.com/api/resend/webhook` with bounce, complaint, failed, and suppressed events enabled; `RESEND_WEBHOOK_SECRET` configured in production. Delivery-delayed provider events may be monitored in the Resend dashboard, but the app intentionally ignores them for durable suppression.
- Shippo: live API key configured.
- Cloudflare R2: bucket CORS and public URL verified.
- Cloudflare R2: processed image upload and direct upload/verify smoke tests pass with production credentials after any R2 credential, CORS, public-domain, or bucket-policy change. `/api/health` only proves `HeadBucket` reachability.
- Cloudflare R2: public bucket listing/ListBucket exposure is disabled or otherwise non-public, with dashboard or CLI evidence retained.
- Cloudflare R2: bucket-level max object-size defense verified where available; app-level upload validation remains required.
- Cloudflare: TLS 1.0/1.1 disabled, TLS 1.2+ enabled, TLS 1.3 enabled, HSTS preload accepted or submitted, SSL Labs grade recorded.
- Cloudflare: WAF managed rules and bot protection mode enabled only after provider/webhook/API smoke tests confirm Stripe, Clerk, Resend, Shippo, Vercel health checks, and uptime checks are not challenged.
- Upstash: production Redis database configured.
- Sentry: production project receiving errors and source maps.
- Sentry: cron monitors configured for every `vercel.json` cron; alert routing verified for `source=cron_ops_health` warnings, including completed-cron partial record failures, `AccountDeletionSideEffect` cleanup issues, direct-upload cleanup failures, and webhook failure spike messages.
- UptimeRobot: monitoring `https://thegrainline.com/api/health`.
- GitHub: branch protection on `main`, required CI, Dependabot alerts/updates, secret scanning/push protection where available, and CodeQL/code scanning where available.
- Security disclosure: `/security` and `/.well-known/security.txt` are live; `security@thegrainline.com` mailbox routing verified.

## Database And Deploy

- `npx prisma validate`
- `npx prisma generate`
- `npx dotenv-cli -e .env -- npx prisma migrate deploy`
- `npx dotenv-cli -e .env -- npx prisma migrate status`
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
- Stripe PCI SAQ A completion.
- GitHub code-security settings.
- Cloudflare WAF/Bot/TLS settings.
- Clerk production security settings evidence: bot protection, disposable email blocking, email subaddress blocking, enumeration protection, account lockout, staff/admin MFA or enforcement plan, breached-password protection, and multi-account/spam controls where available.
- Stripe snapshot webhook and Connect v2 thin webhook delivery, including screenshots of the exact event subscriptions listed above.
- Clerk and Resend webhook delivery.
- Cloudflare R2 public bucket-listing/ListBucket posture, bucket-level max object-size setting, CORS/public-domain settings, and upload smoke-test result.
- Neon backup/PITR setting and most recent restore drill.
- Sentry alert rules for CSP/script/frame violations, production error spikes, Sentry cron monitors, `source=cron_ops_health` warnings including completed-cron partial record failures, `AccountDeletionSideEffect` cleanup issues, direct-upload cleanup failures, and webhook failure spike messages.

## Business And Legal

- Attorney sign-off on Terms and Privacy.
- DRAFT banners removed only after attorney sign-off.
- Clickwrap and age-attestation decision finalized.
- Money transmitter analysis documented.
- INFORM Consumers Act scope documented.
- Business insurance decision documented.
- Texas marketplace facilitator filing calendar set.
- DMCA agent details verified.
