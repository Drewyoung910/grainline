# Order authenticated route smoke plan

Status: **corrected application deployed and source-attested; exact release binding installed; route phases and production execution pending**
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

1. **Buyer phase:** the canary remains an ordinary buyer. Create one database-
   only synthetic seller User/SellerProfile, one private active in-stock
   Listing reserved for the canary and the exact bounded checkout fixtures.
2. **Seller phase:** after buyer-fixture cleanup, attach one temporary hidden,
   vacation-mode SellerProfile to the canary and create database-only buyer,
   Listing, Order and OrderItem rows for seller label/fulfillment operations.
3. **Buyer-receipt phase:** remove the temporary canary SellerProfile, create a
   fresh database-only synthetic seller and one already-shipped or
   ready-for-pickup Order whose buyer is the canary.

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
- delete the exact quote/check-out Redis keys and fixture rows.

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
- require the Order to become `PURCHASED`/`SHIPPED`, with the source-derived
  buyer Notification and email-outbox reservation;
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
- delete dependent Notification/outbox/audit/OrderItem rows before their exact
  parent fixtures;
- prove zero marker-bound residue across database, Redis and Clerk;
- never delete immutable provider test objects that are not safely deletable;
  and
- write sanitized aggregate evidence with no connection strings, tokens,
  provider IDs, URLs, personal data or row payloads.

The sanitized evidence may retain exact source/CI/deployment bindings, stage
booleans, aggregate counts, test/live mode booleans, cleanup booleans and its
own SHA-256.

The initial isolated scaffold intentionally sets `RELEASE_BINDING = null` and
contains no database client, provider client or route mutation surface. It
implements only exact-main/CI/deployment validation, pooled-runtime and owner
identity checks, Stripe/Shippo test-mode enforcement, marker-derived fixture
identities, restart-stage validation and sanitized evidence shape. The final
route phases must be added only after the corrected shipping source has an
exact successful main CI run and source-attested Production deployment.

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
