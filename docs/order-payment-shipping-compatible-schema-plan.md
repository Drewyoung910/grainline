# Order/payment/shipping compatible seller-key plan

Status: design only on `agent/order-payment-shipping-rls-audit-20260804`.
This is not a Prisma migration, deployable SQL artifact or production approval.
It may change after the aggregate-only production inspection.

The design is mirrored by a draft-only, rollback-only PostgreSQL candidate in
`docs/rls-drafts/order-seller-key-compatibility.sql`. CI executes it only on
the disposable loopback `grainline_ci` database; it cannot target production.

## Problem being solved

An Order is created for one seller-scoped Stripe session, but historical seller
authority is currently reconstructed through `OrderItem -> Listing ->
SellerProfile`. A later Listing seller change could transfer access to the
historical Order, and seller history queries require joins through the live
catalog. Old and new Vercel functions can also overlap while compatibility
schema is rolling out, so merely teaching the new application to write a new
seller column is insufficient.

## Compatible data shape

Preparation adds nullable `sellerProfileId` to both `Order` and `OrderItem`.
The fields stay nullable during coexistence; null is not the final invariant.

Raw-managed keys and indexes:

1. `Order(sellerProfileId)` references `SellerProfile(id)` with `RESTRICT`.
2. `OrderItem(sellerProfileId)` references `SellerProfile(id)` with `RESTRICT`.
3. Unique key `Order(id, sellerProfileId)` supports the same-Order seller key.
4. Unique key `Listing(id, sellerId)` supports the purchased-Listing seller key.
5. `OrderItem(orderId, sellerProfileId)` references
   `Order(id, sellerProfileId)`.
6. `OrderItem(listingId, sellerProfileId)` references
   `Listing(id, sellerId)`.
7. Hot indexes begin with `(sellerProfileId, createdAt, id)` and
   `(sellerProfileId, fulfillmentStatus, createdAt, id)` for stable seller
   keyset paging and status queues.

The composite Listing foreign key intentionally prevents seller reassignment
after a Listing has been purchased. Grainline has no legitimate listing-sale
or seller-transfer feature; changing historical order authority is not an
acceptable side effect of editing catalog ownership.

## Old/new application coexistence

The preparation migration needs a pinned `BEFORE INSERT OR UPDATE` OrderItem
trigger. It derives `NEW.sellerProfileId` from the referenced Listing under the
database transaction, rejects a caller-supplied mismatch, fills a null
`Order.sellerProfileId` from the first item, and rejects every later item whose
seller differs from the locked Order seller.

This trigger is required even before the new app dual-writes:

- the old cart webhook creates the Order and then separate OrderItems;
- the old single-item webhook creates nested items with the Order; and
- webhook retries can be served by old and new deployments concurrently.

The trigger function must pin `search_path`, use no dynamic SQL, lock the target
Order before comparing/updating it, and fail on missing Listing/Order or more
than one source row. It is not a general service function and receives no
PUBLIC EXECUTE grant. The later fixed checkout creation function will execute
the same invariant as its owner; the trigger remains a defense against drift.

Deferred constraint triggers must also reject a committed Order with no items,
a null seller key, or mismatched item sellers. This preserves the old cart
sequence (Order first, then items in the same transaction) without allowing a
zero-item source row to survive commit. Deleting the final OrderItem is rejected
unless the parent Order is deleted in the same transaction.

## Backfill and validation gates

The aggregate inspector must run first. Automatic backfill is allowed only
after a separate result review proves:

- `order_without_item_count = 0`;
- `order_multi_seller_count = 0`;
- `order_buyer_is_seller_count` is understood (it is a policy/business issue,
  not a seller-key derivation ambiguity); and
- every OrderItem still resolves through one Listing and SellerProfile.

The preparation migration can then backfill `Order.sellerProfileId` from the
single distinct current Listing seller and `OrderItem.sellerProfileId` from its
Listing. It must assert exact before/after null counts and abort on any
ambiguous or missing derivation. Foreign keys should be installed `NOT VALID`,
then validated explicitly after backfill so failures are attributable.

No production cleanup is implied if the counts are nonzero. Zero-item,
multi-seller or missing-source rows require a separately reviewed resolution;
the migration must not pick an arbitrary seller.

## Application conversion

After preparation is live, the app conversion must:

- write the locked seller profile ID explicitly on Order and every OrderItem;
- page seller orders directly by durable seller ID and stable `(createdAt,id)`
  cursors;
- use `listingSnapshot` for historical title/photo/price/seller display data;
- treat the current Listing relation as optional catalog context only;
- replace buyer, seller, staff and export reads with fixed column projections;
  and
- keep the trigger and post-write assertions active while old deployments may
  still run.

Only after the compatible app is deployed, webhook/cron smoke passes, and old
deployment overlap is closed may a later invariant migration set both seller
columns `NOT NULL`. RLS/function activation remains a separate release after
all ordinary-runtime base-table access is converted.

## Failure and rollback boundaries

Preparation rollback may remove the nullable columns, raw-managed keys,
indexes and trigger only before application code depends on them. Once the app
dual-writes or reads the fields, rollback means restoring app compatibility
first; dropping schema underneath a mixed deployment is forbidden.

The later `NOT NULL` convergence, function preparation, RLS ENABLE, grant
revocation and FORCE steps each need their own byte-pinned artifacts and
rollback/postflight evidence. This plan deliberately does not collapse them
into one migration.
