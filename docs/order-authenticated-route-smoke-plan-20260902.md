# Order authenticated route smoke plan

Status: **corrected application deployed and source-attested; restart-safe route operator locally validated; exact-main CI/review and production execution pending**
Reviewed: 2026-09-02

## Corrected application release accepted

Exact main `b22fa138d84bad792ba206ee00dacb48d475d4a4` passed CI run
`33595797533`, including the full migration/RLS proof stack, TypeScript, lint,
3,905 passing tests, dependency audit and production build. The same clean
detached source was built as Production-target Vercel deployment
`dpl_6vA4bWrP4KhADtGAXKsisXdmvJBX`, whose provider metadata reports the exact
Git SHA, reviewed Grainline project/team, `READY` state and Production target.

After staged health passed, the deployment was promoted. `thegrainline.com`,
`www.thegrainline.com`, `grainline.vercel.app` and
`grainline-drew-youngs-projects.vercel.app` all resolve to that deployment;
the first three passed public health (including canonical redirect handling)
and the Vercel-protected project alias passed authenticated Vercel health.
READY predecessor `dpl_3GTnqQGHGjGPSkCnEMq65yFAU91u` remains retained.
This release changed application source only: no migration, RLS, grant,
credential or provider-variable state changed.

The operator now keeps two independent exact identities: the application
release above, and the eventual operator `main` commit/CI run. Conflating those
would make it impossible for the finished operator to run from its own reviewed
main commit, so tests fail closed if either identity drifts.

## Purpose

The compatible Order database prefix and application deployment prove catalog,
grant and pooled-runtime behavior, but they do not prove that the buyer and
seller HTTP routes still compose correctly through Clerk, Redis, Stripe test
mode and Shippo test mode. Before retiring compatibility-only predecessor
grants or claiming the current Order application ready for the final
zero-direct-access conversion, run a bounded authenticated smoke against the
exact corrected application source.

This is a product-correctness and integration proof, not an RLS activation.
It must not enable RLS, change grants, run migrations, use Stripe live mode or
reuse marketplace rows that are not marker-bound fixtures.

## Corrected source prerequisite

The smoke must bind to an exact deployment containing the Buy Now quantity
correction recorded in
`docs/verified-cross-domain-pre-rls-findings-20260901.md`. The correction is
necessary because the old UI asked for a quantity-one quote even when checkout
submitted a larger in-stock quantity. A provider-only Shippo request cannot
prove that browser-to-route bridge.

The final operator must refuse:

- a dirty or different Git commit;
- a non-green exact-main CI run;
- a deployment whose source, project, environment, aliases or READY state do
  not match the reviewed release;
- Stripe or Shippo live-mode credentials;
- a missing or non-private restart journal/evidence path; and
- a retained operational canary with pre-existing sessions or fixture state.

## Actor and fixture model

Use the retained operational Clerk canary sequentially, never concurrently:

1. **Buyer phase:** the canary remains an ordinary buyer. Select one existing
   eligible seller whose retained `stripeAccountId` is independently verified
   through the configured Stripe **test-mode** client, without updating that
   seller or account. Create only one private active in-stock Listing reserved
   for the canary plus the exact bounded checkout fixtures. A database-only
   synthetic seller is not sufficient here: the real checkout route requires a
   provider-valid connected destination. Reusing a validated eligible test
   seller is narrower than creating and onboarding another provider account.
2. **Seller phase:** after the noncharging buyer checkout has been restored,
   attach one temporary hidden, vacation-mode SellerProfile to the canary and
   create database-only buyer, Listing, Order and OrderItem rows for seller
   label/fulfillment operations.
3. **Buyer-receipt phase:** retain that hidden temporary profile until final
   cleanup, but create a distinct database-only synthetic seller and one
   already-shipped Order whose buyer is the canary. Buyer authority is proven
   from that Order's `buyerId`; the canary's unrelated seller identity conveys
   no authority over it. The separate seller-owned fulfillment Order is also
   used to prove the canary receives a buyer-only 404 when it is not the buyer.

This keeps seller and buyer authority distinct in every operation without
creating a second persistent Clerk account. Every identifier must be derived
from one private restart journal and every fixture title/body must contain the
same high-entropy marker. The fixtures must remain private or vacation-hidden
and email preferences must suppress real delivery.

## Required proof phases

### 1. Buyer quote and quantity-two checkout

- authenticate the canary through a short-lived Clerk ticket;
- prove explicit cross-origin rejection;
- call `POST /api/shipping/quote` for one private in-stock Listing at quantity
  two and a reviewed US address;
- require at least one signed, non-pickup, quote-only Shippo test rate;
- require the returned package subject to equal the server-derived quantity-two
  subject and differ from quantity one;
- submit that exact rate to `POST /api/cart/checkout/single` at quantity two;
- require one Stripe test Checkout Session and exact idempotent retry;
- expire/rollback only that Session and prove the two reserved units restore;
- retain the exact quote/check-out identities in the private journal, then
  delete their Redis keys and fixture rows during the final bounded cleanup.

This proves the repaired UI contract statically and the quantity-two
route/signature/checkout composition dynamically. No payment is completed.

### 2. Seller label re-quote and download

- create one paid-looking but provider-noncharging shipping Order with a full
  retained address, immutable package snapshot, no Stripe transfer to claw
  back and no active Case/dispute/refund;
- authenticate the canary as its temporary seller;
- require label preflight to return a full-address Shippo test-mode re-quote
  and at most the reviewed bounded rate count;
- purchase exactly one selected test label, require a verified SUCCESS
  transaction and fixed amount/currency/rate identity;
- require the Order to become `PURCHASED`/`SHIPPED`, with the database-owned,
  source-derived buyer Notification. The label operation intentionally does
  not enqueue email; email-outbox behavior is proven by the separate manual
  fulfillment phase;
- require authenticated label download to freshly verify the transaction and
  return a private no-store 302 without retaining the label URL in evidence;
- retain the immutable Shippo test transaction but delete only the exact
  application fixtures and transient keys.

### 3. Seller notes and manual fulfillment

- use a separate marker-bound paid Order with no purchased label;
- prove bounded seller-note sanitization and persistence;
- prove `shipped` rejects missing/invalid carrier or tracking input;
- submit one reviewed test carrier/tracking pair and require the exact locked
  fulfillment transition, audit, buyer Notification and email-outbox state;
- exact-retry the final state and prove it cannot duplicate side effects;
- delete only the bounded fixture family.

### 4. Buyer receipt

- authenticate the canary as buyer of a separate marker-bound Order already in
  the required seller-completed fulfillment state;
- prove a nonparticipant receives no Order disclosure;
- confirm receipt once, require the exact `DELIVERED`/`PICKED_UP` transition and
  source-derived side effects, then prove replay is idempotent or fails with the
  reviewed stable conflict;
- delete only the bounded fixture family.

## Cleanup and evidence contract

Cleanup is part of success, not a best-effort epilogue. On failure, retain the
mode-0600 restart journal and stop. A cleanup-only/resume mode must:

- revoke every canary session created by the operator;
- restore the canary to its exact original User/SellerProfile/terms/preferences
  state;
- expire only marker-bound Stripe test Checkout Sessions;
- delete only exact Redis keys recorded in the journal;
- leave the selected buyer-phase seller and its provider account unchanged;
- delete dependent Notification/outbox/audit/OrderItem rows before their exact
  parent fixtures;
- prove zero mutable marker-bound fixture residue across database, Redis and
  Clerk, while retaining and counting the one immutable processed Stripe
  webhook lease when a test Checkout Session was created;
- never delete immutable provider test objects that are not safely deletable;
  and
- write sanitized aggregate evidence with no connection strings, tokens,
  provider IDs, URLs, personal data or row payloads.

The sanitized evidence may retain exact source/CI/deployment bindings, stage
booleans, aggregate counts, test/live mode booleans, cleanup booleans and its
own SHA-256. It must state honestly that the proof temporarily changed
production application rows and created immutable test-mode provider objects;
successful cleanup proves zero persistent **mutable** application-fixture
residue, not a read-only operation. Sanitized evidence separately records the
retained processed webhook-lease count.

The initial isolated scaffold intentionally had no database client, provider
client or route mutation surface. After the corrected application passed exact
main CI and was source-attested in Production, the route phases were installed.
The operator now independently resolves all four aliases to the exact deployed
source; validates pooled-runtime/owner database identity and current pre-RLS
posture; enforces Stripe and Shippo test mode; uses a mode-0600 restart journal;
and supports explicit cleanup-only recovery. A failure preserves the exact
restart state. Only successful bounded cleanup writes sanitized aggregate
success evidence and removes the restart journal.

The completed operator review added four fail-closed restart properties that
the scaffold did not provide:

- a resumed journal remains mutable but every nested canary, seller, session,
  reservation, provider and Redis-key shape is revalidated before use;
- `ON CONFLICT` seeding adopts rows only after validating their complete
  marker-bound immutable identity and allowed route-progress state, rather
  than accepting matching row counts;
- a cleanup-stage restart resumes cleanup directly and retains whether all
  route phases had already passed; and
- a crash after database cleanup or evidence creation can revalidate the exact
  terminal state/evidence and finalize without recreating fixtures.

The raw fixture inserts and their same-Order/same-seller foreign-key shape run
twice in a disposable PGlite PostgreSQL proof, which also proves that a drifted
pre-existing row is rejected rather than silently adopted.

## Local validation and exact invocation

The reviewed implementation passed 27 focused operator, plan, historical
access-inventory and disposable PostgreSQL checks; the repository-wide suite
passed all 3,933 tests with nine intentional skips. TypeScript and ESLint also
passed. The isolated worktree's symlinked dependency directory is outside
Turbopack's filesystem root, so the ordinary local build cannot represent the
normal checkout. A bounded webpack fallback compiled the application and
finished TypeScript before page-data collection correctly failed because this
isolated worktree does not contain the Production Upstash environment. The
post-merge exact-main CI production build remains the authoritative build gate.

After merge and exact-main CI acceptance, invoke only from that exact clean
main commit through the stable package entrypoint:

```sh
ORDER_AUTH_ROUTE_SMOKE_CONFIRM=reviewed-order-authenticated-route-smoke \
ORDER_AUTH_ROUTE_SMOKE_OPERATOR_COMMIT=<exact-main-commit> \
ORDER_AUTH_ROUTE_SMOKE_OPERATOR_CI_RUN_ID=<exact-green-main-ci-run-id> \
ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/order-authenticated-route-smoke-<exact-main-commit>.json \
npm run ops:order-authenticated-route-smoke
```

If a failed run has preserved the exact private restart journal, set
`ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY=1` with the same commit, CI and evidence
binding to perform bounded cleanup. Never delete or edit the journal by hand,
substitute a different operator commit, or treat a failed/partial run as route
acceptance. The operator itself revalidates release, provider, database,
canary, fixture and restart identity before continuing.

## Release sequence after acceptance

1. deploy the corrected quote application;
2. run and accept these authenticated route proofs;
3. drain the retained compatibility predecessor and retire overlap-only
   function grants;
4. convert the remaining pinned direct-Order checkout, refund, staff and
   maintenance sources to fixed authority;
5. deploy and smoke the zero-direct-access application;
6. drain every deployment that can require direct Order CRUD;
7. prove zero direct runtime access; and
8. enable policyless Order RLS, then FORCE it in a separate release.

`OrderItem` and `OrderShippingRateQuote` remain separate later activation
groups. This plan must not be used to fold them into the Order activation.
