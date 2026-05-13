# Grainline Launch Checklist

This checklist is for the final pre-launch pass before accepting live marketplace transactions.

## Environment Variables

Confirm production and preview values in Vercel:

- `NEXT_PUBLIC_APP_URL`
- `DATABASE_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_PIN`
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
- `UNSUBSCRIBE_SECRET`
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`

Use distinct production secrets. Rotate any credential that appeared in terminal output.

## Vendor Setup

- Clerk: production domain configured.
- Clerk: bot protection, disposable email blocking, enumeration protection, and account lockout enabled.
- Clerk/GitHub/Stripe/Vercel/Neon/Cloudflare/Resend/Sentry/Shippo/OpenAI/domain registrar: owner/admin credentials protected by hardware MFA, with one offline backup key stored separately.
- Clerk: seller MFA requirement or documented enforcement plan at the Stripe-Connect-completed boundary.
- Clerk: webhook endpoint registered at `https://thegrainline.com/api/clerk/webhook` for `user.created`, `user.updated`, and `user.deleted`.
- Stripe: Connect live mode enabled and identity verification complete.
- Stripe: live webhook endpoint registered at `https://thegrainline.com/api/stripe/webhook` with at least `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `account.updated`, `account.application.deauthorized`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, and `payout.failed`.
- Stripe: `thegrainline.com` registered for Apple Pay/payment method domains.
- Stripe: PCI SAQ A completed and evidence retained with launch records.
- Stripe/payment pages: checkout-page script inventory completed; CSP reports from checkout pages verified in Sentry.
- Resend: sending domain verified.
- Resend/DNS: SPF, DKIM, and DMARC policy verified. Move DMARC to `p=reject` only after monitoring shows legitimate mail is aligned.
- Resend: webhook endpoint registered at `https://thegrainline.com/api/resend/webhook` with bounce, complaint, delivery delayed, failed, and suppressed events enabled; `RESEND_WEBHOOK_SECRET` configured in production.
- Shippo: live API key configured.
- Cloudflare R2: bucket CORS and public URL verified.
- Cloudflare R2: bucket-level max object-size defense verified where available; app-level upload validation remains required.
- Cloudflare: TLS 1.0/1.1 disabled, TLS 1.2+ enabled, TLS 1.3 enabled, HSTS preload accepted or submitted, SSL Labs grade recorded.
- Cloudflare: WAF managed rules and bot protection mode enabled only after provider/webhook/API smoke tests confirm Stripe, Clerk, Resend, Shippo, Vercel health checks, and uptime checks are not challenged.
- Upstash: production Redis database configured.
- Sentry: production project receiving errors and source maps.
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
- Admin PIN gate: page access and `/api/admin/*` access.
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
- `/api/health` returns 200 when DB/Redis are healthy and 503 on dependency failure.

## Security Evidence

Record links/screenshots/dates for:

- SSL Labs result for `thegrainline.com`.
- securityheaders.com result for `thegrainline.com`.
- HSTS preload result.
- Stripe PCI SAQ A completion.
- GitHub code-security settings.
- Cloudflare WAF/Bot/TLS settings.
- Clerk production security settings.
- Stripe snapshot webhook and Connect v2 thin webhook delivery.
- Clerk and Resend webhook delivery.
- Neon backup/PITR setting and most recent restore drill.
- Sentry alert rules for CSP/script/frame violations and production error spikes.

## Business And Legal

- Attorney sign-off on Terms and Privacy.
- DRAFT banners removed only after attorney sign-off.
- Clickwrap and age-attestation decision finalized.
- Money transmitter analysis documented.
- INFORM Consumers Act scope documented.
- Business insurance decision documented.
- Texas marketplace facilitator filing calendar set.
- DMCA agent details verified.
