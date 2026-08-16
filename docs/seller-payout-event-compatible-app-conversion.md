# SellerPayoutEvent compatible application conversion

Status: isolated application candidate only. Compatible database preparation
is accepted in production from exact main
`6bc89c58d7d83509f73206a2f9b4854e3bed476b`: exact-main CI `31923317475`, the
engine-read-only inspection `31923608819`, and guarded migration run
`31923767337` all passed. Only
`20260815210000_prepare_seller_payout_event_authority` was applied. RLS remains
off, predecessor runtime table CRUD remains available, and these application
changes are not merged or deployed.

Prepared: 2026-08-15

## Purpose and boundary

This candidate converts the three audited `SellerPayoutEvent` application
consumers to the fixed functions introduced by
`20260815210000_prepare_seller_payout_event_authority`:

| Consumer | Predecessor | Candidate |
|---|---|---|
| signed `payout.failed` handler | seller lookup plus direct upsert | generation/source-bound payout writer |
| seller payout banner | direct latest-row query | actor-owned 30-day latest projection |
| account export | unbounded direct table query | actor-owned 500-row keyset pages |

The candidate does not enable or FORCE RLS, revoke table authority, run a
migration, deploy code, or change Stripe/Vercel/provider state. Its database
prerequisite is proven live, so the next boundary is exact-head review and
deployment while predecessor CRUD remains available for coexistence.

## Write and notification contract

Both accepted webhook routes pass the database-issued `claimGeneration` and
the signed Stripe `event.created` value to the fixed writer. The database
derives the seller and payout row from the active lease, connected account and
payout source; the application does not supply a seller, row ID, status or
notification recipient.

The result handling is deliberately asymmetric:

- `inserted`, `updated`, `legacy_converged` and `already_applied` attempt the
  source-bound notification;
- `already_applied` retries notification because the payout projection and
  the strict notification call are separate commits;
- `stale_ignored` emits no notification; and
- `ignored_unknown_account` emits no notification and records only bounded,
  identifier-free warning telemetry.

The notification receives the payout row ID and seller user ID returned by the
database. Notification's own source function independently derives and checks
that recipient from `SellerPayoutEvent` and `SellerProfile`, so the return value
does not replace its authority proof. Notification source deduplication keeps
the retry path idempotent. This path uses the strict notification helper rather
than the site's usual best-effort helper: a transient notification failure is
reported and rethrown, the current webhook lease is failed, and an exact Stripe
retry reaches the writer's `already_applied` result before retrying the deduped
notification. Existing best-effort notification callers remain unchanged.

## Projection and parser contract

`src/lib/sellerPayoutEventState.ts` validates every raw function result before
application use: exact action vocabulary, action-dependent nullability,
nonnegative integer amounts, lowercase three-letter currency, bounded provider
event time, exact `failed` status and complete timestamps/identities.

The dashboard asks only for the current authenticated user's latest recent
failure. Account export iterates the database-clamped 500-row keyset projection
with event-time/id cursors and rejects an oversized page or a cursor that does
not advance. No source file under `src/` retains direct
`prisma.sellerPayoutEvent` access in this candidate.

## Refresh review

The review re-read the complete writer, projection parsers, both signed webhook
call sites, seller banner and account export, and repeated the exhaustive
`src/` access search. It found one real cross-commit defect: the shared
best-effort notification helper swallowed a payout-notification failure after
the payout row committed, allowing the webhook lease to finish and permanently
lose that notification. The payout path now uses a strict helper which reports
and rethrows; existing best-effort callers remain unchanged. An exact retry
reaches `already_applied` and retries the source-deduped notification.

The pre-merge implementation checkpoint `14473b0f2ef6494b27c5b9f3e2ad8d957a668124`
passed focused notification/authority coverage, TypeScript, lint and the full
local suite before current-main reconciliation. Exact reconciled-head CI is
still required before merge.

## Remaining gates

1. Re-verify the current PR head, then review, merge and deploy this
   application conversion while predecessor
   table grants remain available; prove old/new coexistence.
2. Run the linked-seller signed test-mode child/Preview proof and exact retry,
   including one payout row and one source-bound notification.
3. Drain predecessors and prove zero direct application table access.
4. Activate policyless RLS and revoke direct table/column authority, then apply
   posture-only FORCE as a separate release.

`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem` remain
separate domain-first releases.
