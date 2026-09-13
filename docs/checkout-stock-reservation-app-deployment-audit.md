# CheckoutStockReservation application deployment audit

Status: compatible application live in production; exact deployment, alias,
health, unauthenticated route-boundary checks and the authenticated checkout
smoke matrix passed. The exact predecessor deployment drain also passed, with
the restart-safe operator and accepted evidence recorded in
`docs/checkout-stock-reservation-predecessor-drain.md`.
CheckoutStockReservation RLS remains off and direct table grants remain
temporarily compatible until the separate policyless activation release.

This record covers the application/coexistence boundary after the additive
CheckoutStockReservation source-consistency migration. The application-only
deployment described below is complete. This record does not authorize a
migration, RLS or grant change, cleanup, or any further provider-state change.

## Exact boundary

- Before the compatible application promotion, the canonical production alias
  was live-inspected on 2026-08-14 as READY on
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
- PR #209 merged exact reviewed head
  `a6556be1ae4afde93af46899f0a9e74e22d85644` as exact main
  `84a58f0fc818b502564ef6bcd974ff4af3cc4395`. Exact-main CI run
  `31822968848` passed all 109 steps, including the complete disposable
  PostgreSQL proof set, TypeScript, lint, the complete repository suite,
  dependency audits and production build.
- Manual Vercel Production deployment
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`
  (`grainline-l8zenc6ym-drew-youngs-projects.vercel.app`) built from a clean
  detached worktree at exact main `84a58f0f...`. The production build's
  runtime database guard proved the pooled `grainline_app_runtime` role and the
  deployment became READY before Vercel assigned `thegrainline.com`,
  `www.thegrainline.com` and the stable Vercel aliases. The provider's filtered
  inspection does not expose a Git SHA, so this record retains the exact local
  source, deploy command binding and same-commit CI instead of inferring a
  provider-owned Git attestation.

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

Completed before deployment:

- the main-refreshed exact application head passed TypeScript, lint, the
  complete suite, disposable PostgreSQL authority proof, dependency audits and
  production build; and
- the exact reviewed application head merged separately before the manual
  production deployment.

Post-deployment checks completed on 2026-08-14:

- independent Vercel inspection resolved the canonical domain to exact READY
  deployment `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw` and all four expected aliases;
- `GET https://thegrainline.com/api/health` returned HTTP 200 with
  `{ "ok": true }` and the reviewed private/no-store security headers; and
- unauthenticated POSTs to cart checkout, Buy Now checkout, resume and rollback
  each returned the expected HTTP 401 boundary without creating application or
  provider state.

Those immediate checks proved deployment, health and auth fencing only. The
separate authenticated production smoke subsequently passed from exact main
`e9d343b6f316ceb1c75553aec77e9f310a12d802`, bound to exact-main CI
`31829740992`. It proved the reviewed cart and Buy Now in-stock/made-to-order
matrix, exact retry reuse, resume, rollback, stock restoration, cross-origin
denial and three genuine signed Stripe test-mode expiry deliveries. Every
cleanup invariant passed; the sanitized mode-`0600` evidence SHA-256 is
`86b37f18cae8fadb8a126b548455201a7816c74f00731d13fa8a6bf2de8602db`.
Paid completion remains a separate provider side-effect decision and was not
claimed.

The 2026-08-25 blocked-checkout paid-path proof later found a narrower edge the
original smoke did not cover: an in-stock Buy Now exact retry where the first
request reserved the final unit before its response was durably consumed. The
route rejected that retry as out of stock before reaching its exact ready lock,
and reopening the modal could not request a new quote while the buyer's own
reservation held stock at zero. The isolated correction preserves all signed-
rate, variant, price, payload and database stock authority, moves only the exact
ready-lock recovery ahead of new-attempt availability rejection, and adds a
buyer/listing-scoped Stripe-attested resume route used by the Buy Now modal.
This application correction requires its own review, exact-main CI and
compatible production deployment before the retained unpaid proof attempt may
continue. If that Session expires during the release, the operator must
classify it as the third exact unpaid terminal attempt before creating one
bounded replacement; it must not create any replacement before the corrected
deployment is attested. The preserved journal keeps its original deployment
binding and records the corrective application binding separately. It does not
change CheckoutStockReservation RLS or grants.

The predecessor coexistence boundary is complete. Exact main
`4ff40f22c70072406168c378cdb13860f9de317b` and CI `31858295911` finalized
the restart-safe drain after exact deployment
`dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6` was removed. Sanitized mode-`0600`
evidence SHA-256 is
`5f3b63675bdc84749b5f8fef25086bc42a5dddba5e87f5a46fa7bf6015322141`.
Prepare policyless ENABLE plus direct-grant revocation as a separate database
release; FORCE remains a later posture-only release.

The provider audit had found exactly one superseded READY deployment that shared
the current pooled runtime credential: `dpl_C3N3Pud...`. All older deployments
are fenced by the accepted prior-password rejection proof. The drain operator
removed only that exact deployment after proving current aliases, source,
maximum request duration, inventory and health. Completion records zero
shared-credential predecessors and preserved every canonical alias.

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
