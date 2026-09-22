# Stripe test API and primary webhook incident: current read-only boundary

On 2026-09-22 a native read-only Stripe API call authenticated the test key held
in the ignored root `.env.local` and found exactly two test-mode classic webhook
endpoints. The reviewed primary platform endpoint remains enabled at
`https://thegrainline.com/api/stripe/webhook`, with the exact ten-event set from
the accepted August topology record. The sanitized observation is in
`archive/stripe-incident-readonly-20260922.json`; the provider response and
credential value were not saved.

This is a current-state preflight, not rotation acceptance. The key used here is
the pre-existing local credential from the exposure incident. Stripe does not
return a webhook endpoint's signing secret through this read. The observation
does not establish equality with Vercel's `STRIPE_WEBHOOK_SECRET`, a replacement
key, signed replacement delivery, or predecessor revocation.

The next reviewable release action is a separate Stripe **test-mode** credential
cutover. Create a replacement test API key for the same Stripe account and a
primary platform webhook signing-secret replacement with a delivery/drain plan.
The existing provider endpoint ID, canonical URL, event set and test-mode scope
are the exact source boundary. The application reads `STRIPE_SECRET_KEY` in
`src/lib/stripe.ts` and `STRIPE_WEBHOOK_SECRET` in the primary webhook route;
GitHub CI consumes both names. The incident runbook additionally identifies
team-shared Vercel rows and the local environment as consumer stores. Review
their current metadata and update all active consumers before revoking the old
key. A webhook secret change requires real signed delivery, replay/drain and
predecessor disposition. Older callable deployments that embed old values are
covered by the separate artifact-disposition gate.

The read-only operator is `scripts/stripe-incident-readonly.mjs`. It accepts only
`sk_test_` keys, uses a bounded GET to Stripe, rejects changed endpoint identity,
mode, URL and events, and emits only an allowlisted result. From this worktree,
an operator with the same ignored local file can run:

```sh
node --env-file=/Users/drewyoung/grainline/.env.local scripts/stripe-incident-readonly.mjs
```

Five focused tests, syntax validation and `git diff --check` passed. An initial
sandboxed provider call failed at the network boundary; the authorized native
read-only call succeeded. No Stripe endpoint, API key, Vercel/GitHub consumer,
deployment, database object or Order RLS setting was changed. The accepted
August webhook topology and signed-delivery proofs were not rerun.
