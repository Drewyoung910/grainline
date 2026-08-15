# Order/payment/shipping fixed-operation catalog

Status: mixed implementation ledger. StripeWebhookEvent operations 1-3 and
34-36 are live behind policyless FORCE RLS. CheckoutStockReservation operations
4-9 and its bounded export/scrub projections are live behind policyless FORCE
RLS. SellerPayoutEvent operation 11 plus its latest/export projections now have
an isolated compatible candidate, but are not merged, applied or deployed and
predecessor table CRUD remains. Remaining Order, OrderItem, shipping-quote and
payment families are design contracts only until their own audited releases.
This document does not authorize SQL, a migration, an EXECUTE grant,
application deployment or production mutation.

## Global contract

Every operation is a pinned-search-path, no-dynamic-SQL `SECURITY DEFINER`
function owned by the migration owner. `PUBLIC` has no EXECUTE. The ordinary
runtime role receives EXECUTE only after the matching application conversion
is deployed and proved. Base tables remain directly accessible until their
separate compatibility boundary; activation later revokes direct access and
uses policyless ENABLE/FORCE RLS.

Actor IDs, signed-provider fields and bounded error text still originate in the
application. Clerk, staff checks and Stripe signatures remain authentication
boundaries. Each function independently derives target relationships, current
database time, replay identity, seller/buyer authority, allowable transitions
and canonical retained values from locked database rows.

No function may be named or shaped as generic `get_order`, `update_order`,
`write_payment_event`, `set_status`, `delete_quote` or `cleanup_rows`.

## Service-ledger prerequisite catalog

### Stripe delivery lease

1. `grainline_stripe_webhook_begin(p_event_id text, p_event_type text)` returns
   `{action, claimGeneration}` where action is `process`, `processed` or
   `in_progress`. The database clock decides staleness. First insert sets
   generation 1; a stale reclaim increments it under a row lock. Existing type
   mismatch fails. Processed rows never reopen. Before a lease becomes
   cross-table authority, the three-argument overload takes the signed event
   object's bounded ID and atomically stores it under the exact active
   generation. The lower-level `grainline_stripe_webhook_bind_source(...)`
   helper is runtime-private, and the source binding is immutable.
2. `grainline_stripe_webhook_complete(p_event_id text,
   p_claim_generation bigint)` updates only an unprocessed row holding that
   generation and returns `completed`, `already_processed` or `superseded`.
3. `grainline_stripe_webhook_fail(p_event_id text,
   p_claim_generation bigint, p_sanitized_error text)` clears only the exact
   active generation, stores bounded sanitized text and returns `failed` or
   `superseded`.

The application must carry the returned generation through every early return,
thin-event retrieval path, duplicate checkout branch and outer error handler.
ID-only finalization is forbidden.

### Checkout stock reservation lifecycle

4. `grainline_checkout_reservation_create_cart_consistent(...)` and the
   distinct `grainline_checkout_reservation_create_single_consistent(...)`
   lock their actor-owned Cart/CartItems/Listings or one Listing; derive the
   complete reservable item set, seller, canonical checkout lock key and stored
   payload; validate the application witness only as a rejection condition;
   decrement stock atomically; and return reservation ID and database-derived
   expiry. The older `create_cart` and `create_single` wrappers remain only for
   predecessor deployment coexistence and must be drained before direct grants
   are revoked.
5. `grainline_checkout_reservation_bind_session(...)` binds once to the same
   buyer and application-derived replay fingerprint; a Stripe session cannot
   move between reservations.
6. `grainline_checkout_reservation_complete(...)` requires the active exact
   webhook lease generation, its matching stored source object and the
   seller-scoped Order/session. It locks that active event lease before the
   checkout-session/reservation/Order chain so the generation cannot change
   after validation.
7. `grainline_checkout_reservation_checkout_abort(...)` restores only an exact
   buyer/replay-bound reservation with no bound Stripe session or Order, while
   `grainline_checkout_reservation_webhook_restore(...)` requires the active
   exact signed-expiry webhook generation and matching stored source/session,
   holding the event row lock through restoration.
   Distinct buyer-expired and seller-expired functions cover authenticated
   rollback and seller/admin/ban/vacation provider-expiry paths; neither is a
   generic restore target.
8. `grainline_checkout_reservation_repair_claim_batch(...)`, the distinct
   account-deletion claim operation and
   `grainline_checkout_reservation_repair_finalize(...)` select only
   database-eligible bounded rows, issue and compare an exact repair generation,
   then recheck Order/session state before deriving completion, deferment or
   restored stock.
9. `grainline_checkout_reservation_prune_batch(p_limit integer)` deletes only
   terminal rows older than the fixed retention interval, with a hard cap.
   Buyer-resume and account-export remain actor-bound projections in operation
   32; account scrub derives its exact account rows and cannot prune arbitrary
   IDs.

Reservation item lists, lock keys, clocks, restore reasons and deletion targets
are not caller-selected. Clerk-resolved actor IDs and the replay fingerprint are
application-origin facts; the database validates their shape and derives all
row relationships without claiming to authenticate Clerk. Account deletion
gets distinct account-owned claim and scrub operations, not the prune function.
The adjacent Redis duplicate-session guard uses a unique acquisition owner token
for preparing-to-ready publication and preparing cleanup, then the exact Stripe
session ID for ready cleanup; a replay fingerprint is never treated as lock
ownership.

### Payment, dispute and payout evidence

10. `grainline_order_payment_event_append(...)` requires an active exact
    webhook generation, locks the Order, derives currency agreement and replay
    identity, permits only the reviewed event taxonomy and is append-only.
11. `grainline_seller_payout_event_apply(...)` requires the active webhook
    generation, derives SellerProfile from the Stripe account mapping and
    permits only a monotonic payout transition for one payout ID. The
    2026-08-15 compatible candidate adds an advisory lock for the no-row-yet
    first-write race, exact replay validation, stale-event rejection and
    equal-time ambiguity refusal. It is not live; see
    `docs/seller-payout-event-compatible-authority-release.md`.
12. `grainline_seller_deauthorization_flag_orders(...)` requires the webhook
    generation and uses the durable Order seller key in a bounded batch; it
    never reconstructs historical ownership through Listing.

Participants never execute these writers and never read raw provider rows.

## Order creation and participant transition catalog

13. `grainline_stripe_checkout_order_create(...)` requires the active webhook
    generation and exact reservation/session binding; locks buyer, seller,
    Listings and reservation in the global order; derives durable seller keys
    and canonical snapshots; validates totals/currency; creates exactly one
    Order and at least one same-seller OrderItem; and is idempotent.
14. `grainline_seller_fulfillment_transition(...)` derives seller authority,
    locks the Order and permits only reviewed shipping/pickup transitions and
    bounded tracking fields.
15. `grainline_buyer_delivery_confirm(p_actor_user_id, p_order_id)` derives
    buyer ownership, locks the Order and permits only shipped to delivered.
16. `grainline_seller_refund_claim(...)` derives seller authority and maximum
    refundable amount under the Order lock, returning a database-derived claim
    ID, generation and Stripe idempotency key.
17. `grainline_seller_refund_provider_record(...)` and
    `grainline_seller_refund_finalize(...)` require the exact claim generation;
    ambiguous results enter reconciliation and stale workers cannot finalize.
18. `grainline_refund_claim_release_batch(p_limit integer)` releases only stale
    no-provider-effect claims using a fixed clock and hard cap.

Stock restoration and Case resolution caused by a refund occur in the exact
finalizer transaction and preserve the existing Case authority functions.

## Quote, label and clawback catalog

19. `grainline_seller_label_preflight(...)` returns only seller-safe shipping
    facts and the current label/claim generation.
20. `grainline_seller_quote_replace(...)` locks the Order, validates seller and
    an exact claim generation, bounds every rate member and expiry, and replaces
    only that Order's quote set.
21. `grainline_seller_label_claim(...)` derives the selected rate from the
    stored unexpired quote or retained Order rate and returns a generation plus
    provider idempotency key.
22. `grainline_seller_label_provider_record(...)` and
    `grainline_seller_label_finalize(...)` compare the exact generation and
    cannot overwrite shipped/delivered/refunded/reconciled state.
23. `grainline_label_clawback_claim_batch(p_limit integer)` claims only eligible
    rows in stable order with `SKIP LOCKED`, a fixed cap and per-row generation.
24. `grainline_label_clawback_finalize(...)` records success, retry or manual
    review only for the exact generation and database-derived retry schedule.

## Fixed participant and staff projections

25. `grainline_buyer_order_page(...)` returns buyer-owned order/list item
    snapshots, totals, bounded refund outcome, fulfillment and tracking. It
    excludes raw Stripe, Shippo, internal review, seller-note and reconciliation
    fields.
26. `grainline_buyer_order_detail(...)` adds retained buyer shipping/gift facts
    and participant Case summary only for the buyer.
27. `grainline_seller_order_page(...)` derives SellerProfile and pages by the
    durable seller key, returning seller-safe buyer label, snapshots and totals.
28. `grainline_seller_order_detail(...)` adds retained fulfillment address,
    gift, label/refund outcome and active Case summary, but no raw payment-event
    rows.
29. `grainline_staff_order_page(...)` and
    `grainline_staff_order_detail(...)` require a live EMPLOYEE/ADMIN row and
    expose only reviewed queue/detail columns.
30. `grainline_checkout_success_order(p_actor_user_id, p_session_id)` returns a
    buyer-bound projection; knowing a Stripe session ID is insufficient.
31. `grainline_order_review_eligibility(...)` and
    `grainline_order_report_eligibility(...)` return booleans/minimal source IDs,
    never Order rows.
32. `grainline_buyer_order_export_page(...)`,
    `grainline_seller_order_export_page(...)`,
    `grainline_seller_payout_export_page(...)` and
    `grainline_buyer_reservation_export_page(...)` return only the matching
    actor's bounded retained facts with stable cursors.

The isolated SellerPayoutEvent candidate implements only its own latest-failure
and keyset-paged export projections. Their actor is mapped through
`SellerProfile.userId`, their limit is database-clamped and the latest banner
uses provider event time with a compatibility-only legacy timestamp fallback.
They are not application-connected or production-live.
33. `grainline_seller_order_analytics(...)` and
    `grainline_public_order_metrics(...)` return dedicated aggregate-only
    projections with fixed periods and caps; no arbitrary predicate or raw row
    set escapes.

## Stripe prerequisite maintenance catalog

34. `grainline_stripe_webhook_prune_batch(p_limit integer)` deletes only
    processed rows older than the fixed retention interval in stable order,
    with a hard cap. The caller cannot supply row IDs or a cutoff.
35. `grainline_stripe_webhook_health_summary()` returns only fixed-window
    aggregate counts for failed, released and stale leases; it cannot enumerate
    event IDs, types or retained errors.
36. `grainline_legacy_stock_restore_claim(p_session_id text)` derives the
    canonical `checkout-stock-restore:` identity and fixed event type inside
    the function, locks the checkout session mutation key and returns whether
    this exact legacy restoration was first. The caller cannot mint an
    arbitrary webhook identity or type.

All page limits are clamped in the database. Hot buyer/seller pages use
`(createdAt,id)` keyset cursors. Existing offset page numbers may remain only at
the application compatibility layer until converted.

## Release dependencies

1. Run and review the aggregate-only production inspection.
2. Prepare durable seller keys, webhook claim generation and compatible
   invariants without changing grants/RLS.
3. Deploy dual-write/dual-read app compatibility and prove old/new overlap.
4. Activate webhook and reservation ledgers through fixed operations.
5. Activate payment/payout and quote/label ledgers through fixed operations.
6. Convert every participant, staff, export and aggregate read/mutation.
7. Activate Order/OrderItem with policyless RLS and zero direct runtime access.
8. Run pooled-runtime actor/service proofs, then apply FORCE and repeat.

No release may claim a later dependency or leave an unconverted ordinary
runtime base-table access behind.
