# Order participant export authority

Status: isolated compatible candidate. It has not been merged, applied or
deployed. `Order` RLS remains off.

Prepared: 2026-08-31

## Decision

Account export is a rare, reverified and rate-limited operation, but it still
must not regain direct `Order` table access after policyless RLS activation.
Migration `20260901030000_prepare_order_participant_export_authority` adds
separate buyer and seller export pages. Both are actor-bound, use deterministic
keyset cursors, cap each page at 25 Orders and cap each Order item payload at
101 so the strict application parser rejects Orders above the supported
100-item contract.

The buyer projection contains retained buyer contact/address and gift facts;
the seller projection preserves the narrower existing seller export and does
not add buyer PII. Both expose transaction totals, fulfillment/tracking facts,
derived refund state and amount, and fixed historical item snapshots. Raw
shipping-quote rows and provider identifiers are excluded. In particular,
Shippo shipment/rate JSON and `Order.sellerRefundId` no longer escape through
the account export. User-facing refund history continues to come from the
separately protected `OrderPaymentEvent` export projection.

## Security and compatibility

The functions are `SECURITY DEFINER` with `search_path = pg_catalog`; PUBLIC
execution is revoked and only `grainline_app_runtime` receives execution.
Buyer ownership is bound to `Order.buyerId`. Seller ownership is bound through
the immutable `Order.sellerProfileId -> SellerProfile.userId` relationship,
never current Listing ownership. Unknown JSON keys are stripped in PostgreSQL
and rejected by strict TypeScript parsers.

This is compatible preparation: predecessor direct reads and the functions may
coexist until the application commit is deployed. It changes no rows, grants
no table privileges and changes no RLS posture. Production activation remains
blocked on the rest of O2/O3 and the complete ordinary-runtime source
inventory.
