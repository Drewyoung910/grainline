# Grainline Operations Runbook

Last updated: 2026-04-30

This runbook covers the minimum operational steps for production incidents, deploy rollback, secret rotation, webhook recovery, database restore drills, and public support/legal request handling.

## Incident Triage

1. Check `/api/health` for anonymous uptime status.
2. Check verbose health with `HEALTH_CHECK_TOKEN` when backend dependency details are needed.
3. Check Sentry for the current deploy SHA, request IDs, and recent error spikes.
4. Check Vercel deployment logs for failed middleware, route-handler, or build errors.
5. Check Stripe Dashboard for payment, webhook, dispute, and Connect-account alerts.
6. Check Clerk Dashboard for auth/session incidents and webhook delivery failures.
7. Check Resend Dashboard for failed, bounced, or delayed transactional email.

Every incident note should include: start time, affected surface, current deploy SHA, primary request IDs, customer-visible impact, mitigation, owner, and follow-up issue.

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

High-risk secrets:

- `DATABASE_URL`: runtime Neon pooled URL. Must use the `-pooler` host.
- `DIRECT_URL`: Neon direct URL for migrations and restore operations.
- `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SECRET`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and Connect-related Stripe settings.
- `RESEND_API_KEY`, `EMAIL_FROM`, and `RESEND_WEBHOOK_SECRET`.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- `ADMIN_PIN_COOKIE_SECRET`, `UPLOAD_VERIFICATION_SECRET`, `UNSUBSCRIBE_SECRET`, and `HEALTH_CHECK_TOKEN`.
- `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, and `NEXT_PUBLIC_SENTRY_DSN`.

## Webhook Recovery

Stripe:

1. Confirm the production endpoint is `/api/stripe/webhook`.
2. Confirm the deployed `STRIPE_WEBHOOK_SECRET` matches the Stripe endpoint secret.
3. In Stripe Dashboard, filter failed events and replay after the app is healthy.
4. Verify `StripeWebhookEvent` rows show processed state for replayed events.
5. For checkout or refund incidents, compare Stripe charge/payment/refund IDs against `OrderPaymentEvent`.

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
- Use the pooled `DATABASE_URL` for runtime.
- Avoid rolling back to an app version that cannot read the current schema.
- For failed migrations, stop deploys, inspect the migration in Neon, and ship a forward migration whenever possible.

## Cron and Email Outbox

1. Check `/api/cron/*` logs in Vercel for failures.
2. Check `CronRun` rows with `status = FAILED` in the last 24 hours.
3. Check Sentry for cron route exceptions.
4. For email delays, inspect `EmailOutbox` rows by `status`, `nextAttemptAt`, `attempts`, and `lastError`.
5. Keep outbox draining at bounded concurrency; do not manually send large batches outside the quota guard.

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
