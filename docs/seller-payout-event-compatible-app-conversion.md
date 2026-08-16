# SellerPayoutEvent compatible application conversion

Status: compatible application deployed and verified with predecessor authority
retained. Compatible database preparation is accepted in production from exact main
`6bc89c58d7d83509f73206a2f9b4854e3bed476b`: exact-main CI `31923317475`, the
engine-read-only inspection `31923608819`, and guarded migration run
`31923767337` all passed. Only
`20260815210000_prepare_seller_payout_event_authority` was applied. RLS remains
off and predecessor runtime table CRUD remains available. PR #226 merged the
application conversion as exact main
`99591a8f93c45f9324fb834fcbc1ea525867ace8`; exact-main CI `31925636570`
passed. Exact reviewed source
`e9239463a71860451191344b26dd20b45298f239`, bound to exact-main CI
`31927548800`, is live as production deployment
`dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`. This is not a predecessor-drain, linked
seller proof or RLS-activation claim.

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

The release did not enable or FORCE RLS, revoke table authority, run a
migration or change Stripe/provider configuration. Its database prerequisite,
exact-main CI, production deployment and predecessor coexistence are proven.

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
local suite before current-main reconciliation. The final reconciliation also
taught the Notification inventory about the strict helper without increasing
the exact 55-path emission count. Exact-main CI `31925636570` passed after PR
#226 merged at `99591a8f93c45f9324fb834fcbc1ea525867ace8`.

## Accepted compatible production deployment

The manual production deployment was created from a clean detached worktree at
exact source `e9239463a71860451191344b26dd20b45298f239`, after exact-main CI
`31927548800` passed. Vercel reports deployment
`dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h` as `READY` with all four canonical aliases.
`https://thegrainline.com/` returned HTTP 200 with that exact deployment marker,
`/api/health` returned HTTP 200 and `{"ok":true}`, and `www.thegrainline.com`
returned the expected 308 redirect to the canonical host.

The immediate predecessor deployment
`dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw` remains `READY`. A post-deploy owner catalog
proof and separate pooled-runtime proof both ran inside engine-attested
repeatable-read/read-only transactions. They proved the exact 198-migration
prepared catalog, the three fixed functions, RLS and FORCE both off, all four
predecessor runtime CRUD privileges retained, and actual pooled identity
`grainline_app_runtime` on the reviewed production endpoint. Both proofs report
that they changed no production state.

No migration, linked-seller fixture/proof, RLS change, grant change, cleanup,
provider variable change or Stripe mutation accompanied the deployment.

## Remaining gates

1. Run the separately reviewed linked-seller signed test-mode production proof
   and exact retry, including one payout row and one source-bound notification,
   then remove only those exact application fixture rows. See
   `docs/seller-payout-event-linked-production-proof.md`.
2. Drain predecessors and prove zero direct application table access.
3. Activate policyless RLS and revoke direct table/column authority, then apply
   posture-only FORCE as a separate release.

`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem` remain
separate domain-first releases.
