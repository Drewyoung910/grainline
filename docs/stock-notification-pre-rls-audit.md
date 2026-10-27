# StockNotification pre-RLS domain audit

Date: 2026-10-26

Decision: **GO for isolated compatible preparation under Option A2, with
activation blocked until the findings and proofs below are closed.**

Source baseline:
`ab927b134dc3e77af4477a59972331423a0118b7`.

Preparation status: the compatible application and additive preparation
migration merged in PR #657 as
`968315f775c86d84a547d0a6eb3abaeec4662f49`. They are not yet live. Production
application of `20261026010000_prepare_stock_notification_authorities` remains
subject to the exact-main protected preparation workflow; application deploy
and RLS activation remain later, separately gated steps.

This document is a product, authority, concurrency, privacy, scalability,
recovery, and rollback audit. It is not a Production authorization. See
`docs/stock-notification-rls-options.md` for the design comparison.

## Product contract

Back-in-stock subscriptions are one-shot alerts for public `IN_STOCK` listings.
The subscription exists while the item is unavailable. A genuine manual
`SOLD_OUT -> ACTIVE` restock can consume it and create an in-app alert; email is
separately subject to the recipient's email preference and delivery state.

The row is private to the subscriber. A maker may see only counts for listings
they own. Neither a maker, staff member, public visitor, nor another account has
a product need to enumerate subscriber identities.

Unsubscribing is allowed even if the listing later becomes hidden, private, or
deleted. Creating or delivering an alert is prohibited across a reciprocal
block. Hard deletion of the user or listing removes the row by cascade.

## Complete source inventory

| Consumer | Operation | Principal | Required target |
| --- | --- | --- | --- |
| `src/app/listing/[id]/page.tsx` | read one subscription | current viewer | owner policy/helper |
| `src/app/api/listings/[id]/notify/route.ts` POST | create if eligible | current viewer | fixed subscribe operation |
| same route DELETE | remove one subscription | current viewer | owner delete policy/helper |
| `src/app/api/listings/[id]/stock/route.ts` | page candidates after a manual restock | seller service flow | audit-bound opaque candidate function |
| `grainline_notification_claim_back_in_stock` | lock, validate, create notification, consume | notification service | retained fixed claim, strengthened for block/self rules |
| dashboard listing query | count per listing | listing owner | bounded aggregate function |
| inventory listing query | count per listing | listing owner | bounded aggregate function |
| seller analytics route | count current subscriptions created in a range | seller owner | bounded range aggregate function |
| `grainline_order_seller_analytics_top_listings` | count per top listing | seller owner | retained reviewed fixed function |
| seller listing archive | delete all listing subscriptions | listing owner | actor-bound seller cleanup function |
| admin listing removal | delete all listing subscriptions | active admin after PIN | actor-bound admin cleanup function |
| hard Listing deletion | FK cascade | database referential action | executed cascade proof under FORCE |
| account export | list actor subscriptions and target summary | reverified owner | owner-bound export projection/helper |
| account deletion | delete actor subscriptions | deletion actor | owner delete policy/helper inside existing transaction |
| hard User deletion | FK cascade | database referential action | executed cascade proof under FORCE |
| Block creation | delete both directions' affected subscriptions | blocking actor | co-committed pair cleanup operation |

No additional Prisma delegate, nested write, raw SQL, or relation-count path was
found on the reviewed baseline. A source inventory guard must keep this list
closed before activation.

## Authority matrix

| Operation | Subscriber | Listing owner | Admin | Background/service | Anonymous/other user |
| --- | --- | --- | --- | --- | --- |
| Read exact row | own only | no | no ordinary need | claim only | deny |
| Subscribe | self, eligible target only | deny self | no | no | deny |
| Unsubscribe | own only | no | no | no | deny |
| Listing watcher counts | no | aggregates for owned listing only | no current need | no | deny |
| Restock candidates | no | only through exact restock flow | no | opaque ids only | deny |
| Claim and consume | no | no | no | exact restock audit + row | deny |
| Listing-wide cleanup | own rows only directly | owned listing via fixed function | exact admin removal via fixed function | FK cascade | deny |
| Account cleanup/export | own account only | n/a | no | exact deletion flow | deny |

## Findings

### `FIX_BEFORE_ACTIVATION`

1. **C-759 [prepared and behavior-tested in isolated source]: the notify control disappears in the normal sold-out state.** The
   detail page correctly treats public `SOLD_OUT` as visible and eligible, but
   `ListingPurchasePanel` additionally requires `isActive`. The button therefore
   disappears exactly when an ordinary in-stock listing sells out. Fix the
   component contract and execute behavior tests for `ACTIVE` zero stock and
   `SOLD_OUT` zero stock, while continuing to reject private, archived,
   made-to-order, and positive-stock listings.
2. **C-708 [prepared and full-chain race-tested in isolated source]: reciprocal blocks do not cover stock subscriptions.** The POST route
   can create a subscription across a block, Block creation does not remove
   existing subscriptions, and the final restock claim does not check Block.
   Fix all three surfaces. Subscribe and Block creation must serialize on the
   existing sorted user-pair lock. The claim must take a conflicting sorted pair
   lock before its final Block check so the transaction that obtains the pair
   first determines whether the notification is admitted.
3. **Self-subscription [prepared and full-chain tested in isolated source] is accepted by the API.** The UI hides the button from
   the maker, but a direct POST creates the row and the current claim later
   consumes it. The database subscribe authority and final claim must reject
   or consume-without-notifying self targets.
4. **Direct relation counts [converted and full-chain tested in isolated source] will become false zeros under owner SELECT RLS.**
   Dashboard, inventory, and range analytics count rows owned by customers, not
   the seller. Convert them to seller-bound aggregate functions before RLS.
5. **Cross-owner cleanup [converted and authorization-tested in isolated source] will be denied by owner DELETE RLS.** Seller archive
   and admin removal currently call `deleteMany` directly. Convert both to
   fixed actor-checked operations before RLS.
6. **Restock discovery [converted and projection-tested in isolated source] directly enumerates subscriber user ids.** Candidate
   discovery needs only opaque subscription ids; the claim returns the user id
   only after it wins and validates the row. Move discovery to a bounded,
   restock-audit-bound function that exposes no user identity.

### `DEFERRED_PRODUCT_WORK`

1. The restock fanout runs in a framework `after()` callback rather than a
   durable job ledger. The in-app claim is atomic and idempotent, but a process
   termination can leave later subscriptions for a future restock. Preserve
   existing behavior for this RLS release; design a durable restock-fanout job
   separately.
2. A successful in-app claim consumes the subscription before the optional
   email is enqueued. If enqueueing fails, the in-app alert survives but the
   email has no dedicated recovery record. This is an email-delivery durability
   issue, not an RLS authority reason to retain direct table access.
3. Seller analytics counts surviving subscriptions created in the selected
   range, not immutable subscription events. Existing copy already describes
   current watchers; a historical engagement ledger would be a separate
   product feature.

There are no `BLOCKS_RLS_DESIGN` findings after selecting Option A2. Production
activation remains blocked until every `FIX_BEFORE_ACTIVATION` item is closed
and the acceptance proof passes.

## Isolated preparation evidence

The candidate additive migration and compatible application conversion were
tested on 2026-10-26 against the complete 435-migration history on disposable
PostgreSQL 16. The proof first reproduces the predecessor C-708 failure (a
reciprocal block still receives an alert), then applies the preparation and
executes owner subscription/idempotency, self/block/ineligible denial, seller
aggregate isolation, opaque restock discovery, final claim, owner export,
seller/admin listing cleanup, two-direction block cleanup, and both winner
orders of subscribe-versus-block and claim-versus-block races. A final security
diff review also added and proved a post-lock activity recheck so an account ban
committing while subscribe waits cannot admit a new row. These runs caught and
corrected a real `varchar(150)` versus declared `text` return mismatch in the
owner export function.

The source inventory guard reports no direct StockNotification delegate calls
outside `src/lib/stockNotificationAccess.ts`. Route behavior tests execute the
POST/DELETE handlers and verify pre-authority origin/auth/rate-limit gates plus
the fixed authority status mapping.

This evidence closes the compatible-preparation portion of items 1-6. It does
not prove or authorize activation. The later activation candidate must still
execute owner-policy cross-user/no-context denial, no-INSERT/no-UPDATE grants,
User/Listing cascade behavior under FORCE, provisioning replay, and predecessor
rollback on the complete schema.

## Concurrency and lock order

The required order is:

1. sorted subscriber/seller `User` pair;
2. target Listing/SellerProfile rows;
3. reciprocal Block absence;
4. StockNotification row;
5. Notification/cleanup writes.

Block creation already takes the same user pair `FOR UPDATE`. Subscribe uses
that operation before revalidating the listing and inserting. The restock claim
takes the pair in sorted order before locking and re-reading the subscription.
This prevents subscribe-after-block and notify-after-block races without lock
inversion. Tests must run two real PostgreSQL sessions in both winner orders.

Concurrent duplicate subscribes converge through the unique
`(listingId,userId)` index. Concurrent unsubscribe and claim may produce either
an unsubscribe or one validated alert, never two alerts. Concurrent restock
workers serialize on the subscription row and the notification dedup key.

## Scale and privacy

- Owner lookup uses the unique `(listingId,userId)` index.
- Seller count requests accept at most the page's bounded listing-id set and
  return only `(listingId,count)` for currently owned listings.
- Range analytics aggregates in PostgreSQL and returns one count.
- Restock candidate pages are capped and return only opaque subscription ids.
- Claim execution remains concurrency-limited in the app and deletes each
  one-shot row atomically.
- Listing cleanup is indexed by `listingId`; account cleanup is indexed by
  `userId`.
- No function returns the subscriber identity to a seller. The service claim
  receives it only after a valid notification has been committed.

## Failure and recovery

- A denied or failed subscribe leaves no row.
- A repeated subscribe returns subscribed state without adding a duplicate.
- Unsubscribe is idempotent and does not require current listing visibility.
- If a listing becomes unavailable after candidate discovery, the claim does
  not consume the row, so a future genuine restock may use it.
- Invalid/deleted/banned recipients and disabled in-app preference retain the
  established one-shot behavior: consume without creating an alert.
- Listing cleanup and archive/removal remain in the caller's database
  transaction, so cleanup cannot commit separately from the listing state.
- Account deletion uses the existing transaction-local actor and deletes only
  matching owner rows.

## Acceptance evidence required

Behavior tests must first fail on the baseline and then pass against the full
migration chain on PostgreSQL 16 for:

- owner subscribe/read/unsubscribe and duplicate convergence;
- inactive, self, blocked, private, archived, hidden, draft, made-to-order, and
  positive-stock rejection;
- both subscribe-versus-block race winner orders;
- both claim-versus-block race winner orders;
- no seller access to subscriber identity and correct bounded aggregate counts;
- exact-restock candidate binding and forged/stale audit rejection;
- seller and admin listing cleanup authorization and cross-owner denial;
- account export/deletion isolation;
- Listing and User cascade behavior with FORCE enabled;
- direct runtime cross-user and no-context denial;
- no direct INSERT/UPDATE authority after activation; and
- predecessor rollback statements succeeding after the tested rollback.

Source-text checks may guard the caller manifest and catalog bindings, but they
do not count as proof of behavior.

## Rollback

The compatible application must deploy before activation. The activation
rollback restores the exact reviewed predecessor table grants and disables
FORCE/RLS before any predecessor application is restored. Preparation functions
are additive and can remain during rollback. No rollback deletes subscription
data or drops a column.
