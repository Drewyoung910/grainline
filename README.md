# Grainline

Grainline is a US-only woodworking marketplace built with Next.js, Prisma, Clerk, Stripe Connect, Shippo, Cloudflare R2, Resend, Upstash Redis, OpenAI, and Sentry.

The product supports seller shops, listings with variants, cart and embedded Stripe checkout, stock reservation, custom orders, messaging, reviews, cases/refunds, shipping labels, AI listing review, blog content, SEO city pages, admin moderation, notifications, and production monitoring.

## Local Setup

1. Install dependencies:

```bash
npm ci
```

2. Create environment files:

```bash
cp .env.example .env
```

Fill the required values in `.env`. Do not commit real secrets.

3. Generate Prisma Client:

```bash
npx prisma generate
```

4. Run database migrations against the configured database:

```bash
npx dotenv-cli -e .env -- npx prisma migrate deploy
```

5. Start the dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Verification

Run these before committing production changes:

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

`npm run lint` is expected to pass with warnings until the remaining warning backlog is cleaned up.

## Deployment

Production is deployed on Vercel and aliased to `https://thegrainline.com`.

Typical production flow:

```bash
git status --short
npx dotenv-cli -e .env -- npx prisma migrate deploy
git push origin main
npx vercel --prod
```

If a Prisma migration has already been applied in production, do not rename its migration directory. Prisma stores migration names in `_prisma_migrations`; renaming an applied directory can make Prisma try to replay schema changes.

## Operational Docs

- `CLAUDE.md` is the canonical project knowledge base for agents and implementation history.
- `docs/architecture.md` is the short human onboarding map for future engineers.
- `docs/security-hardening-plan.md` defines the adversarial security audit process and RLS stance.
- `docs/security-audit-log.md` tracks the current hardening pass and verified/non-finding spot checks.
- `docs/maintainability-plan.md` defines the stabilization, review, and bug-resistance plan.
- `docs/legal-risk-register.md` tracks product/legal risks for attorney review.
- `docs/launch-checklist.md` covers launch-critical vendor/env/smoke-test steps.
- `docs/runbook.md` covers production incident response, rollback, webhook recovery, restore drills, and secret rotation.
- `.env.example` lists required and optional environment variables.

## Current Launch Notes

- Keep admin PIN enabled as an extra staff gate, and complete the Clerk/admin MFA evidence items in `docs/launch-checklist.md` before live operations. Do not treat the PIN as a substitute for provider/account MFA.
- Clerk and Stripe production webhooks must be configured in their dashboards before live payments.
- Rotate any database credentials that were exposed in terminal output.
- Attorney/business decisions remain for final Terms/Privacy wording, money-transmitter analysis, and INFORM Consumers Act scope. Clickwrap and age-attestation are implemented technically, but counsel should still review wording.
