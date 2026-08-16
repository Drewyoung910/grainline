# SellerPayoutEvent compatible application conversion

Status: isolated application candidate only. The database authority candidate
is merged into `main` but remains unapplied. These application changes are not
merged or deployed, and direct table CRUD remains the production predecessor.

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
migration, deploy code, or change Stripe/Vercel/provider state. It must not be
deployed before the compatible migration is successfully applied and proven.

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
  the current best-effort notification are separate commits;
- `stale_ignored` emits no notification; and
- `ignored_unknown_account` emits no notification and records only bounded,
  identifier-free warning telemetry.

The notification receives the payout row ID and seller user ID returned by the
database. Notification's own source function independently derives and checks
that recipient from `SellerPayoutEvent` and `SellerProfile`, so the return value
does not replace its authority proof. Notification source deduplication keeps
the retry path idempotent.

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

## Remaining gates

1. Confirm exact merged-main CI for the compatible database candidate.
2. Run and review the protected aggregate-only production inspection; stop on
   any legacy payout row requiring classification.
3. Apply and prove only the compatible migration in production.
4. Review, merge and deploy this application conversion while predecessor
   table grants remain available; prove old/new coexistence.
5. Run the linked-seller signed test-mode child/Preview proof and exact retry,
   including one payout row and one source-bound notification.
6. Drain predecessors and prove zero direct application table access.
7. Activate policyless RLS and revoke direct table/column authority, then apply
   posture-only FORCE as a separate release.

`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem` remain
separate domain-first releases.
