# Grainline Checkout Script Inventory

Last updated: 2026-05-13

This document is the launch evidence record for scripts and third-party browser code that can execute on Grainline checkout/payment surfaces. It supports the PCI SAQ A / PCI DSS v4 payment-page control process documented in `docs/security-hardening-plan.md`.

## Covered Surfaces

- `/cart` — cart checkout flow; mounts `src/components/EmbeddedCheckoutPanel.tsx` after server-side checkout session creation.
- `/listing/[id]` — Buy Now modal; mounts `src/components/BuyNowCheckoutModal.tsx`, which mounts `EmbeddedCheckoutPanel` after server-side checkout session creation.
- `/checkout/success` — receipt/read-only page; retrieves paid Stripe Checkout Sessions and reads buyer-scoped orders. It does not mount payment fields or create orders.

## Browser Script Inventory

| Source | Loaded by | Surfaces | Business purpose | Security notes |
|---|---|---|---|---|
| First-party Next.js app chunks | Next.js app runtime | All covered surfaces | Render Grainline UI, cart state, checkout client state | Covered by Grainline build/deploy controls, CSP, and code review. |
| `https://js.stripe.com` | `@stripe/stripe-js` via `loadStripe()` in `src/components/EmbeddedCheckoutPanel.tsx` | `/cart`, Buy Now modal | Stripe Embedded Checkout; card data is collected by Stripe-hosted payment UI | Must be loaded directly from Stripe. Do not self-host or bundle. Do not add stale SRI hashes unless Stripe explicitly supports the exact URL/update behavior. |
| Stripe checkout frames/connect calls | `@stripe/react-stripe-js` `EmbeddedCheckoutProvider` / `EmbeddedCheckout` | `/cart`, Buy Now modal | Hosted payment iframe and payment-status communication | CSP allowlist is explicit in `next.config.ts`: `js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`, `api.stripe.com`, and `q.stripe.com` as applicable. |
| Clerk client runtime | `@clerk/nextjs` provider and auth components | Sitewide, including covered surfaces when signed in | Session state and authenticated checkout eligibility | CSP allowlist is explicit for Clerk domains and the custom Clerk domain. Clerk does not receive raw card data. |
| Sentry browser runtime | `@sentry/nextjs` | Sitewide, including covered surfaces | Error telemetry and CSP/security monitoring | Browser events are tunneled through `/monitoring`; CSP reports are sent to `/api/csp-report`. Do not add PII to Sentry user context. |

## Current Findings

- No direct `next/script` usage was found in `src/app` or `src/components` during the 2026-05-13 audit.
- No Grainline form collects raw card numbers, CVCs, or bank-card track data.
- `EmbeddedCheckoutPanel` is the only local component that calls `loadStripe()`.
- Checkout success remains read-only; the Stripe webhook is the only order writer.
- `/api/csp-report` sanitizes document/referrer query strings and tags cart/checkout document violations with `checkout_surface=true` for payment-page monitoring evidence.

## Change-Control Rule

Any new third-party script, iframe, analytics tool, tag manager, A/B testing tool, fraud widget, or chat widget on `/cart`, `/listing/[id]` Buy Now, or `/checkout/success` must update this inventory, justify the business purpose, update CSP with the narrowest possible host allowlist, and add/adjust tests before merge.

Do not add wildcard script/frame/connect hosts to support payment-page features. Do not add a tag manager to checkout surfaces without a separate security review.
