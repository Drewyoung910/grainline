# Order participant detail projection and product audit

Status: isolated compatible candidate. It has not been merged, applied,
deployed, or used in production. `Order` RLS remains off.

Prepared: 2026-09-01

## Why this successor exists

The sealed `20260901010000_prepare_order_participant_detail_authority`
migration established the first fixed buyer and seller detail projections. A
fresh product, privacy, and failure-state review found that the projection
still preserved several undesirable application behaviors. The predecessor
bytes remain immutable; migration
`20260901100000_prepare_order_participant_detail_projection` adds the corrected
v2 boundary instead.

This checkpoint converts the buyer and seller detail pages from direct
`Order` reads. The initially sealed v2 projection established the actor,
contact, purge, label and link boundaries. The subsequent checkout-success
product audit found that v2 had narrowed a valid historical snapshot below the
application snapshot contract, which would render a complete purchase as
generic “Purchased item.” The immutable v2 bytes remain preserved and
`20260901105000_correct_order_participant_snapshot_projection` adds:

- `grainline_order_buyer_detail_v3(text, text)`; and
- `grainline_order_seller_detail_v3(text, text)`.

Both functions validate inputs, require an active authenticated actor, bind
the participant predicate and Order ID in PostgreSQL, return zero rows for a
foreign actor, pin `search_path=pg_catalog`, revoke `PUBLIC`, and grant only
the ordinary runtime role. The v1 functions remain owner-private building
blocks; ordinary runtime execution is explicitly revoked from them.

## Product and privacy corrections

The pre-RLS review found and corrected these concrete behaviors:

- buyer and seller detail pages offered a messaging action even when the
  counterparty account was deleted, purged, banned, or otherwise unavailable;
  contact targets are now nullable and the UI fails closed with support copy;
- legacy buyer-data purge state could retain seller notes, so v2 suppresses
  seller notes whenever buyer data has been purged;
- a stale non-`PURCHASED` label state could still carry a label URL, carrier,
  tracking number, or purchase timestamp; v2 keeps the status but strips the
  download material;
- v2 stripped snapshot description, checkout-time price, category, tags and
  capture time even though the strict historical reader requires the complete
  bounded snapshot contract; v3 restores the exact allowlisted snapshot keys
  without returning unknown JSON keys;
- the predecessor treated only `ACTIVE` listings as linkable even though
  Grainline deliberately allows public `SOLD_OUT`, actor-owned, and
  buyer-reserved private listing details; v2 derives actor-specific link
  availability from the same status, privacy, seller, and account facts; and
- the database boundary now rejects banned or deleted actors independently of
  application middleware.

The audit did not find a reason to redesign receipt totals, gift presentation,
fulfillment timeline, Case entry points, label workflow, or refund-state
display in this slice. They remain backed by the historical Order projection,
while provider identifiers and staff-only bodies remain excluded.

## Proof and release boundary

Disposable PostgreSQL proves participant isolation, active-actor enforcement,
unavailable-counterparty suppression, buyer-data purge behavior, label-state
redaction, exact complete snapshot keys, v1 runtime revocation, and fixed v2/v3
compatibility execution. Application tests prove both pages use the named v3 functions and
cannot render a false messaging action. Strict state parsing rejects duplicate
rows and inconsistent purge, contact, label, refund, item, enum, and timestamp
states.

This is compatible preparation only. It changes no table RLS flag, policy,
table privilege, row, deployment, credential, or provider state. The v2
functions remain available only for the old/new deployment overlap and must be
retired after the v3 application is deployed and its predecessor is drained.
Merge, guarded migration application, pooled-runtime proof, compatible
application deployment, and predecessor drain remain separate gates. The
remaining direct Order inventory reaches 21 source files after the separately
documented checkout-success conversion; staff, maintenance and write-state-
machine conversions must still reach zero before Order activation.
