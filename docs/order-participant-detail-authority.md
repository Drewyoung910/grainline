# Order participant detail authority

Status: sealed predecessor candidate. It has not been merged, applied, or
deployed. Its bytes remain immutable, and the isolated v2 successor in
`docs/order-participant-detail-projection.md` now owns application conversion.
`Order` RLS remains off.

Prepared: 2026-08-31

## Decision

Buyer and seller Order detail reads require separate fixed projections. A
participant may legitimately view shipping, fulfillment and retained purchase
facts, but must not receive the same base-row columns used by Stripe, Shippo,
refund reconciliation or staff operations.

Migration
`20260901010000_prepare_order_participant_detail_authority` adds only:

- `grainline_order_buyer_detail(text, text)`; and
- `grainline_order_seller_detail(text, text)`.

Each function binds the authenticated application actor and requested Order ID
inside PostgreSQL, returns zero rows for a foreign actor, executes in one
statement, pins `search_path=pg_catalog`, revokes `PUBLIC`, and grants only
`EXECUTE` to `grainline_app_runtime`. It does not enable RLS, alter policies,
change table grants or mutate data.

## Fixed exposure boundary

The buyer projection includes buyer-facing receipt, fulfillment, shipping,
gift, review-status, seller-contact and historical item facts. The seller
projection adds the buyer label/address required for fulfillment, seller notes,
label delivery fields, processing deadline and a derived deauthorized-account
hold. It deliberately excludes raw `reviewNote`, Stripe payment/session/charge,
transfer/application-fee/refund IDs, Shippo object/transaction IDs, refund
claim internals, label clawback internals, quoted-address comparison material
and staff reconciliation fields.

Refund state crosses the participant boundary only as `NONE`, `PROCESSING`,
`AMBIGUOUS` or `RECORDED`. A recorded amount may accompany `RECORDED`; raw
provider refund identifiers never do. The seller UI was corrected in the same
candidate to stop displaying Stripe refund IDs even before page conversion.

The historical item array is capped at 100 and contains exact fixed keys. The
database strips unrecognized snapshot and selected-variant keys rather than
passing arbitrary JSON through the function. Application parsing separately
checks item identity, quantity, cents, enum values, timestamps, variant bounds
and snapshot shape. Malformed legacy snapshots render the documented generic
retained fallback rather than consulting mutable Listing text or images.

The sole live-Listing fact is a derived `listingLinkAvailable` boolean used to
decide whether the historical title can link to a route the active actor may
actually view. It includes public active or sold-out listings, an actor-owned
listing, and an active private listing reserved for that buyer; it rejects
unavailable seller state and unrelated private listings. Current Listing title,
image, seller and processing fields are never projected.

## Product and privacy correction

The pre-RLS detail audit found that the seller page rendered
`Order.sellerRefundId` as a Stripe refund identifier. That identifier is useful
to staff and provider reconciliation, not to a marketplace participant. The
panel now accepts the derived four-state display enum and no longer renders the
identifier. This also makes the current UI contract match the eventual fixed
database projection.

Buyer PII and gift/address fields are suppressed if `buyerDataPurgedAt` is set;
seller-facing buyer labels are also suppressed for a deleted buyer. The seller
projection exposes only a boolean for the deauthorized-account review hold,
not the staff review body from which it is derived.

## Proofs

Disposable PostgreSQL proves:

- buyer and durable-seller isolation, including cross-actor zero rows;
- fixed function grants and no `PUBLIC` execution;
- provider IDs and unrecognized JSON keys do not escape;
- active/hidden Listing link derivation;
- deleted/purged buyer suppression;
- derived refund and review-hold state; and
- malformed input rejection.

Application-state tests reject duplicate rows, malformed enums/timestamps,
invalid items and inconsistent refund amounts. The exact migration bytes and
migration-tree prefix are sealed by the release verifier.

## Remaining gates

Application pages are not switched to these v1 functions. The v2 successor
adds active-actor, unavailable-counterparty, purge, stale-label, and narrower
snapshot boundaries, then converts both detail pages. Both migrations must be
reviewed, merged, applied through the guarded compatibility workflow, proven
through the pooled runtime role, and followed by a compatible app deployment
before direct detail reads can be retired. Staff reads use a separate
dormant credential boundary documented in `docs/order-staff-read-authority.md`;
export, aggregate, eligibility, write and maintenance operations remain
unfinished O2/O3 work.
This detail slice is not an `Order` RLS readiness claim and does not authorize
`OrderItem` or `OrderShippingRateQuote` activation.

The database function trusts the actor ID supplied by authenticated server
code; it does not cryptographically authenticate a Clerk session inside
PostgreSQL. The separate restricted runtime credential, application auth and
fixed actor-bound function predicate are all part of the boundary.
