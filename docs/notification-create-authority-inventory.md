# Notification Creation Authority Inventory

Snapshot: 2026-07-19. Status: isolated Bucket B design evidence; no SQL or RLS
in this document is production-active.

## Count Contract

The source has 52 direct `createNotification` calls across 29 files. Fifty-one
pass object literals. The fulfillment route has the remaining direct call in a
typed `notifyBuyer(..., payload)` wrapper, and that wrapper has three distinct
payload construction paths. The authority inventory therefore covers 54
distinct emission paths:

- 8 source-tagged paths;
- 46 source-less paths;
- 21 paths currently carrying `relatedUserId`.

The earlier count of 51 calls and 46 source-less paths omitted the fulfillment
wrapper and its three payload constructions. The complete baseline was 54 total,
5 tagged and 49 source-less; the first social-family implementation then moved
three more paths into the tagged set, producing the current 8/46 split. Tests
pin direct calls, emission paths, and family state so those concepts are not
conflated again.

## Family Inventory

| Authority family | Emission paths | Current examples | Database-verifiable provenance or constraint |
|---|---:|---|---|
| Existing source-tagged fanout | 5 | Blog comment/reply, followed listing, followed blog, seller broadcast | Comment/post/listing/broadcast, actor, recipient, seller visibility and follow row |
| Verification and guild lifecycle | 10 | Staff approval/rejection/revocation/reinstatement; guild metric and eligibility jobs | `MakerVerification`, `SellerProfile`, guild state, recipient seller, staff or fixed cron transition |
| Staff and account warnings | 2 | Admin account message; buyer warning after maker ban | Fixed warning type, active recipient, staff context plus audit/message source; order and ban state where applicable |
| Listing moderation and reports | 3 | Listing approval/rejection; listing-reported warning | Listing owner and moderation state; staff decision or bounded report event |
| Case lifecycle | 12 | Open, message, mark-resolved, resolve/refund, timeout escalation and auto-close | `Case`, `CaseMessage`, order participants, actor/staff role, resulting case state and fixed cron transitions |
| Commission lifecycle | 4 | Seller interest, buyer close/fulfill, expiry notifications | `CommissionRequest`, `CommissionInterest`, conversation, buyer/seller participants and resulting status |
| Social and review events | 3 | Favorite, follow, review | Implemented draft validation: `Favorite`, `Follow`, `Review`, listing/seller ownership and event actor |
| Inventory events | 3 | Seller low stock, subscriber back in stock, webhook low stock | Listing owner, listing stock/status, `StockNotification` subscription and checkout/order transition |
| Messaging and custom orders | 3 | New message, custom-order request, custom-order-ready link | `Message`, `Conversation`, participant pair, custom listing reservation and seller/buyer roles |
| Order, payment and fulfillment | 9 | Order buyer/seller notices, refund, shipment/pickup, dispute and payout failure | `Order`, items/seller/buyer, payment/payout event ledgers, fulfillment transition and provider event id |
| **Total** | **54** |  |  |

## Chosen Hybrid

Owner-scoped `SELECT` and column-limited mark-read `UPDATE` remain the highest
confidentiality value, but write authority is not discarded. The runtime role
must not receive direct Notification `INSERT` or a callable arbitrary-type,
arbitrary-recipient insert function merely because HTTP users do not insert
notifications directly. That shortcut would restore broad cross-user authority
to any runtime query that could invoke it.

Do not instrument the remaining 46 paths with one undifferentiated provenance
shape. Group them by the ten authority families above:

1. Keep an internal fixed-column insert primitive ungranted to `PUBLIC` and the
   runtime role.
2. Grant runtime only reviewed family functions. Each accepts stable domain ids
   and a small event discriminator, derives or validates recipients and allowed
   types, and either derives payload text or bounds the few fields that truly
   must remain caller-supplied.
3. Store `sourceType`/`sourceId` where lifecycle cleanup or account-deletion
   residue needs it. A validation id does not automatically need to become
   durable lifecycle metadata.
4. For provider and cron families, require a persisted order/payment/payout or
   workflow transition, not merely an application-supplied claim that a webhook
   or timer ran.
5. For staff-only families, combine a fixed operation with active staff context
   and an audit or domain source. Application-asserted context is still
   forgeable by a fully compromised runtime, so keep the operation narrow even
   after the role check.

Application authorization remains primary. These functions are database
defense in depth against overly broad queries and partial compromise; they do
not claim to defeat arbitrary code execution holding the runtime credential.

This is not yet a complete runtime-compromise boundary. The two granted create
wrappers still accept caller-supplied title, body, and relative link after
validating their bounds, and the favorite/follow checks prove that no block row
exists only at statement time. They do not serialize against a concurrent
block creation because the block-writing paths do not yet share a lock
protocol. Family wrappers should derive or strictly template payload content
where practical, and the social family needs an explicit concurrency decision
before activation. Application authorization and block checks remain required;
the draft must not be described as making forged content or block races
impossible.

## Next Implementation Order

1. Retain the implemented runtime-ungranted core plus separate source-fanout and
   social/review wrappers; do not restore a generic runtime grant.
2. Add the messaging/custom-order family because its source
   rows and participant relationships are direct and inexpensive to validate.
3. Add case and commission families, deriving recipients from their workflow
   rows and pinning allowed state transitions.
4. Add order/payment/fulfillment and verification/guild families only after
   their provider, staff and cron transition matrices are complete.
5. Leave staff free-form account communication last; require a durable audited
   message source rather than granting a generic warning creator.

Every family still needs PostgreSQL parse/apply proof, own/foreign and direct
denial tests, concurrency tests, grants/catalog fingerprints, rollback, and
provider performance evidence before production activation.
