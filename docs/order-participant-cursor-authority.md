# Order participant cursor authority

Status: isolated compatible preparation; not merged, deployed or applied to
production as of 2026-09-01.

## Product and scaling decision

The complete buyer history and seller sales pages used numbered OFFSET pages.
The offset was capped, but database work still grew with page depth and rows
could move between pages when a new Order arrived. A forward-only keyset would
avoid that cost but would regress the explicit Previous control.

The selected contract is bidirectional keyset navigation:

- existing summary functions provide the latest and older pages with a
  `(createdAt,id) < boundary` predicate;
- two additive functions provide newer pages with a `(createdAt,id) >
  boundary` predicate, read the nearest rows ascending, and return them newest
  first for the UI;
- opaque base64url tokens contain only version, direction, bounded page label,
  epoch-millisecond boundary and Order ID;
- parsing rejects extra keys, duplicate query values, invalid directions,
  unsafe timestamps, invalid IDs and pages above 1000;
- malformed or obsolete tokens fall back to the latest page, while a valid
  cursor that no longer returns rows redirects to the canonical first page;
- no route performs OFFSET, reads and discards prior pages, or issues per-Order
  detail queries.

Page labels remain navigation hints rather than durable row ordinals under
concurrent inserts. The cursor boundary—not the label—is the database
authority.

## Product correctness found during conversion

Each list card renders at most five item summaries. The previous seller page
computed its displayed subtotal by summing every loaded item. Reusing that
logic after bounding the summaries would understate an Order with more than
five items. The converted page instead uses `Order.itemsSubtotalCents`, which
is the complete checkout-time subtotal for the durable single-seller Order,
while still showing `+N more items` on the card.

Seller buyer labels continue to suppress both Order PII purges and deleted
buyer accounts. The projection carries the deletion timestamp as a scalar so
the application does not need a broad User relation read.

## Release candidate

Migration `20260901090000_prepare_order_participant_cursor_authority` adds:

- `grainline_order_buyer_summary_after_page(text, integer, bigint, text)`; and
- `grainline_order_seller_summary_after_page(text, integer, bigint, text)`.

Both functions are actor-bound, limited to 1–100 rows, SECURITY DEFINER with a
pinned `pg_catalog` search path, revoked from PUBLIC, and executable only by
the ordinary runtime role. The migration is additive: it does not enable RLS,
change base-table grants, mutate rows or alter predecessor behavior.

## Verification and remaining boundary

Disposable PostgreSQL proves exact older/newer round trips for buyer and
seller, newest-first return order, cross-participant isolation and the complete
function ACL. Application tests prohibit direct Prisma Order reads, OFFSET and
raw snapshot parsing on both converted routes. Cursor tests pin strict parsing
and bounds; the release verifier byte-pins the migration and predecessor tree.

This checkpoint reduces direct Order source access from 26 to 24. Detail,
checkout success, staff, mutation, retention and maintenance families remain
separate conversion work before any Order RLS activation.
