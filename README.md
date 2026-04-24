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
- `docs/launch-checklist.md` covers launch-critical vendor/env/smoke-test steps.
- `.env.example` lists required and optional environment variables.

## Current Launch Notes

- Keep admin PIN enabled until Clerk MFA is worth the added monthly cost.
- Clerk and Stripe production webhooks must be configured in their dashboards before live payments.
- Rotate any database credentials that were exposed in terminal output.
- Attorney/business decisions remain for Terms/Privacy sign-off, clickwrap, age gate, money-transmitter analysis, and INFORM Consumers Act scope.
