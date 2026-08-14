# CheckoutStockReservation application deployment audit

Status: isolated implementation with its database-postflight prerequisite
complete; not merged, deployed or active in production.

This record covers the application/coexistence boundary after the additive
CheckoutStockReservation source-consistency migration. It does not authorize a
merge, deployment, migration, RLS or grant change, cleanup, or provider-state
change.

## Exact boundary

- The canonical production alias was live-inspected on 2026-08-14 as READY on
  Vercel deployment `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6`. The filtered provider
  metadata did not expose a Git SHA, so this record does not infer one from that
  response.
- The latest retained compatible-production record pins the deployed
  application lineage to source
  `69c14c0618ea7ab9c74756422273d17d66db7efa`.
- The audited runtime candidate was originally based on exact main
  `16239fce2956c6dc726c24ccd7a91d1ea35463bd`, after guarded production run
  `31814032227` applied only
  `20260814053000_prepare_checkout_stock_reservation_source_consistency`.
- The candidate now integrates accepted postflight-record main
  `21e18ced17e876160e728b4c6f1a691ec6624b94`. The actual database proof ran
  from exact clean main `ac4c9d2139f5294c5e91edd24acb3dbe71b4976c`, bound to
  exact-main CI `31819848330`, migration-main CI `31813433933` and migration
  run `31814032227`; its sanitized evidence SHA-256 is
  `bec37f40d995e311bee5d80fc63c3485f7d325cdcd846b88656684fe2f592afe`.
- The source delta contains 19 runtime files and five non-merge runtime
  commits: reservation authority audit, fixed-operation conversion, two
  terminal Case-replay corrections, and reservation source consistency.

The affected runtime families are checkout creation/resume/rollback, signed
Stripe platform/Connect/v2 delivery, account export/deletion, Cart ownership,
Case participant completion, reservation source-state, session expiry/locking,
reservation authority/repair, and Stripe event leasing. This is a meaningful
payment and inventory release; it requires its own deployment and smoke gate
before any CheckoutStockReservation table authority is revoked.

## Finding CSR-A25: an ambiguous Stripe create response could reopen stock

Both checkout routes set `createdCheckoutSessionId` only after
`stripe.checkout.sessions.create()` returns. A provider may create the Session
but the application may lose the response. The predecessor outer catch treated
a missing local Session ID as proof that no Session existed, aborted the
database reservation, and released the checkout lock. A still-payable external
Session could then complete after the same stock had been offered again.

This is the same safety class as a failed post-create step, but it occurs inside
the provider call rather than after a returned Session. The earlier static
guard covered returned Session IDs and did not cover this response-loss
interval.

## Accepted correction contract

The isolated correction establishes these invariants:

1. Each acquired Redis checkout lock derives one bounded Stripe idempotency key
   from its UUIDv4 owner token. Stripe SDK retries for that acquisition cannot
   create a second Session.
2. The route records `checkoutSessionCreateAttempted = true` immediately before
   the provider call. Once creation was attempted, absence of a returned ID is
   unknown provider state, not evidence that creation failed.
3. Unknown provider state retains the database reservation and Redis lock. It
   never aborts stock or reopens availability. The lock expires after 32
   minutes; database stale repair is ineligible until the reservation expiry is
   more than two hours old, after the reviewed 31-minute Stripe Session expiry.
4. New Sessions carry the already-derived reservation payload hash in signed
   Stripe metadata. A signed completion webhook can use the existing fixed
   `grainline_checkout_reservation_bind_session` operation to late-bind an
   unbound reservation, then complete it in the same Order transaction.
5. The bind operation derives and validates the exact reservation, buyer,
   payload hash and Session relationship in PostgreSQL. The webhook cannot use
   metadata to select an unrelated reservation.
6. Older Sessions without `checkoutPayloadHash` remain compatible and use the
   already-bound completion path. A made-to-order single checkout legitimately
   has no stock reservation; payload metadata without a reservation ID does not
   invoke late binding or block Order creation.
7. Deterministic provider failures may conservatively retain inventory until
   stale repair. That temporary availability cost is accepted over the
   oversell risk of guessing whether a failed request created a payable Session.

## Verification and release sequence

Completed prerequisites:

- focused state and guardrail tests pin idempotency-key derivation,
  pre-call attempt fencing, unknown-state retention, in-transaction late bind,
  predecessor compatibility, and the made-to-order no-reservation case;
- the actual pooled-runtime source-consistency postflight passed from exact
  main and its durable record merged through PR #210; and
- the payment/inventory authority review accepted the conservative retention,
  source-bound late bind, predecessor compatibility and smoke requirements.

Remaining before deployment:

- the main-refreshed exact application head must pass TypeScript, lint, the
  complete suite, disposable PostgreSQL authority proof, dependency audits and
  production build; and
- the exact reviewed application head must merge separately before a manual
  production deployment is considered.

Then deploy the compatible application without changing database posture.
Smoke both cart and Buy Now checkout, including in-stock and made-to-order
listings, duplicate/retry behavior, signed completion, rollback/expiry, and
health. Retain the predecessor deployment until smoke passes. After the
predecessor drain, prepare policyless ENABLE plus direct-grant revocation as a
separate database release; FORCE remains a later posture-only release.

Order, OrderItem, payment, payout and shipping activation remain separate.

## Isolated candidate evidence

Exact checkpoint `912eb9fdefa05b7cf7af26d8cd21c5768cfd23b6` is retained in
draft PR #209. GitHub CI run `31819103219` passed all 109 steps, including the
complete migration tree, disposable PostgreSQL authority and rollback proofs,
TypeScript, lint, the complete repository test suite, dependency security
audit, and production build. Focused checkout/audit contracts passed 41/41
locally before that clean run.

Vercel Preview `dpl_QbB9kvUsjEU99dtFNzECV8bihPLS` compiled the exact commit
and passed TypeScript, then failed closed at page-data collection because the
isolated branch intentionally has no Preview `DATABASE_URL`. It did not deploy
or contact production. That expected guard failure is not a production-build
failure and does not weaken the separate deployment gate.
