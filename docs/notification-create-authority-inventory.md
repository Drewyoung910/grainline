# Notification Creation Authority Inventory

Snapshot: 2026-07-19. Status: isolated Bucket B design evidence; no SQL or RLS
in this document is production-active.

## Count Contract

The source has 51 direct `createNotification` calls across 29 files. Fifty pass
object literals. The fulfillment route has the remaining direct call in a typed
`notifyBuyer(..., payload)` wrapper, and that wrapper has three distinct payload
construction paths. One dedicated back-in-stock claim call derives its
Notification write inside owner authority. The inventory therefore covers 54
distinct emission paths:

- 45 authority-bound paths;
- 9 source-less paths;
- 24 generic paths currently carrying `relatedUserId`, plus back-in-stock's
  database-derived seller relationship.

The earlier count of 51 calls and 46 source-less paths omitted the fulfillment
wrapper and its three payload constructions. The complete baseline was 54 total,
5 tagged and 49 source-less. The social-family implementation moved three paths
into the tagged set, and the messaging/custom-order implementation moved three
more. The commission implementation then moved four paths, the case
implementation moved all twelve case paths. Checkout low-stock, manual low-stock,
and the dedicated back-in-stock claim then completed all three inventory paths.
The seven staff and three cron verification/Guild transitions complete that
family. Three listing-moderation/report paths and two staff/account-warning
paths now bind exact audit, report, ban, and order evidence, producing the
current 45/9 split.
Tests pin direct calls, emission paths, and family state so those concepts are
not conflated again.

## Family Inventory

| Authority family | Emission paths | Current examples | Database-verifiable provenance or constraint |
|---|---:|---|---|
| Existing source-tagged fanout | 5 | Blog comment/reply, followed listing, followed blog, seller broadcast | Comment/post/listing/broadcast, actor, recipient, seller visibility and follow row |
| Verification and guild lifecycle | 10 | Staff approval/rejection/revocation/reinstatement; guild metric and eligibility jobs | Implemented draft validation: durable exact admin/system audit evidence, non-undone staff action or fixed cron actor, recipient seller, `MakerVerification` and `SellerProfile` transition state; first metrics warning now co-commits its audit with the warning state |
| Staff and account warnings | 2 | Admin account message; buyer warning after maker ban | Implemented draft validation: successful-send admin audit with stored bounded payload, or compound ban-audit/order evidence with exact affected buyer and banned seller |
| Listing moderation and reports | 3 | Listing approval/rejection; listing-reported warning | Implemented draft validation: atomic staff-review audit or exact `UserReport`, listing owner, reporter, decision type, and canonical listing/dashboard route |
| Case lifecycle | 12 | Open, message, mark-resolved, resolve/refund, timeout escalation and auto-close | Implemented draft validation: durable `Case`, `CaseMessage`, atomic user-audit, or system-audit source; exact parties/staff/cron actor, order route, event type and recorded transition |
| Commission lifecycle | 4 | Seller interest, buyer close/fulfill, expiry notifications | Implemented draft validation: durable `CommissionInterest` or final-state `CommissionRequest`, conversation, interested seller, buyer/recipient, CLOSED/FULFILLED/EXPIRED state and route |
| Social and review events | 3 | Favorite, follow, review | Implemented draft validation: `Favorite`, `Follow`, `Review`, listing/seller ownership and event actor |
| Inventory events | 3 | Seller low stock, subscriber back in stock, webhook low stock | Implemented draft validation: checkout low-stock binds `OrderItem`, paid `Order`, and completed reservation; manual low-stock binds an atomic audit; back-in-stock binds an atomic SOLD_OUT→ACTIVE audit plus the locked subscription and performs claim/create/consume as one owner operation |
| Messaging and custom orders | 3 | New message, custom-order request, custom-order-ready link | Implemented draft validation: `Message`, `Conversation`, participant pair and kind; ready links additionally bind the reserved `Listing`, seller, buyer, conversation and canonical route |
| Order, payment and fulfillment | 9 | Order buyer/seller notices, refund, shipment/pickup, dispute and payout failure | `Order`, items/seller/buyer, payment/payout event ledgers, fulfillment transition and provider event id |
| **Total** | **54** |  |  |

## Chosen Hybrid

Owner-scoped `SELECT` and column-limited mark-read `UPDATE` remain the highest
confidentiality value, but write authority is not discarded. The runtime role
must not receive direct Notification `INSERT` or a callable arbitrary-type,
arbitrary-recipient insert function merely because HTTP users do not insert
notifications directly. That shortcut would restore broad cross-user authority
to any runtime query that could invoke it.

Do not instrument the remaining 9 paths with one undifferentiated provenance
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

This is not yet a complete runtime-compromise boundary. The nine granted creation
wrappers share bounded title/body parameters, although the verification,
moderation, account-warning, inventory, and portions of other families replace
them with source-derived templates. The dedicated back-in-stock claim accepts
neither. Canonical links
and dedup identity are now derived inside owner authority
from the validated recipient, type, source kind, source row, related actor, and
source-specific route columns. Runtime-supplied `link` and `dedupScope` remain
application telemetry only and never reach the granted SQL signatures. The
favorite/follow checks prove that no block row
exists only at statement time. They do not serialize against a concurrent
block creation because the block-writing paths do not yet share a lock
protocol. The message family proves the source message, its kind, participants,
and conversation route; custom-order-ready extracts the listing id from the
durable structured message inside the core, validates the reserved listing,
seller, buyer, conversation and status, and derives the canonical listing route.
Family wrappers should still derive or strictly template payload content where
practical, and the
social/message/commission families need an explicit concurrency
decision before activation. Application authorization and block checks remain
required; the draft must not be described as making forged content or block
races impossible.

## Next Implementation Order

1. Retain the implemented runtime-ungranted core plus separate source-fanout,
   social/review, message/custom-order, commission, case, and inventory wrappers;
   do not restore a generic runtime grant.
2. Retain the completed inventory-event family. Checkout low-stock binds one
   `OrderItem` to its paid order, completed stock reservation, listing owner and
   current 1-2 quantity, and derives its payload/link. Manual low-stock now writes
   a `MANUAL_LISTING_STOCK_LOW` audit row in the same transaction as the locked
   listing update and derives authority from that committed event. Back-in-stock
   writes `MANUAL_LISTING_RESTOCKED` in the same transaction as SOLD_OUT→ACTIVE,
   then a dedicated owner function locks and validates that audit and the exact
   subscription, optionally inserts the preference-gated Notification, consumes
   the subscription, and returns the sole winning claim for email fanout.
3. Retain the completed verification/Guild family: seven staff transitions bind
   atomic `AdminAuditLog` evidence and three cron transitions bind atomic
   `SystemAuditLog` evidence.
4. Retain the completed moderation/account-warning families. Listing decisions
   bind transaction-returned audit ids, reports bind exact `UserReport` rows,
   successful admin messages bind post-send audit evidence, and ban warnings bind
   a compound ban-audit/order event. Continue with order/payment/fulfillment only
   after its provider transition matrix is complete.

Every family still needs PostgreSQL parse/apply proof, own/foreign and direct
denial tests, concurrency tests, grants/catalog fingerprints, rollback, and
provider performance evidence before production activation.
The permanent completeness gate is
`npm run audit:rls-notification-readiness`: it inventories the real TypeScript
call graph, requires exactly 54 emission paths, and blocks activation until all
54 carry a source pair dispatched through a reviewed family. Its current
45/54 failure is expected and must never be bypassed or weakened to make an
incomplete rollout pass.
