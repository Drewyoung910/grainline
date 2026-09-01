# Order participant summary authority

Status: isolated compatible preparation; not merged, deployed or applied to
production as of 2026-09-01.

## Product finding

The first participant list authority returned only scalar Order fields. That
shape was sufficient for counts and totals but not for the historical item
cards rendered by the account overview, buyer history and seller sales pages.
Converting those pages to the scalar function would either remove titles,
photos, quantities and prices or add one detail query per Order. Both outcomes
were rejected before RLS work continued.

The corrected contract is a bounded summary, not a general Order/OrderItem
reader:

- each page is actor-bound to the buyer or durable checkout-time seller;
- results use the existing `(createdAt, id)` keyset order and a maximum page
  size of 100;
- each Order returns its complete item count and at most the first five
  checkout-time item summaries;
- item identity, quantity, price, historical title, seller name and the first
  historical image are returned; descriptions, tag arrays and unused snapshot fields are
  deliberately omitted, and live Listing content is never consulted;
- another participant receives no row;
- the shared item helper is private to the function owner and has no runtime or
  PUBLIC execute grant.

Five summaries preserve the normal list experience while bounding response
size for pathological carts. A list shows `+N more items` when an Order has
more than five items; the full detail page remains the place to inspect every
item.

## Release candidate

Migration
`20260901080000_prepare_order_participant_summary_authority` adds:

- private `grainline_order_summary_items(text)`;
- runtime `grainline_order_buyer_summary_page(text, integer, bigint, text)`;
- runtime `grainline_order_seller_summary_page(text, integer, bigint, text)`.

The migration is additive compatible preparation. It does not enable RLS,
change table grants, mutate rows, deploy application code or touch production.
Runtime keeps no execute access to the helper and receives execute only on the
two fixed participant functions.

## Converted surfaces and remaining work

This checkpoint converts:

- `src/app/account/page.tsx` (five most recent buyer Orders); and
- `src/app/dashboard/orders/page.tsx` (first buyer dashboard page).

It reduces the exact direct Order source inventory from 28 to 26. The
following list surfaces intentionally remain for the next conversion:

- `src/app/account/orders/page.tsx`; and
- `src/app/dashboard/sales/page.tsx`.

Those routes currently expose numbered offset pages. Their conversion must
make an explicit product choice about cursor navigation and stable back/next
links; it must not silently emulate offset pagination with repeated database
reads or load unbounded rows.

## Verification

The release verifier byte-pins the migration and its full predecessor tree,
requires three pinned-search-path SECURITY DEFINER functions, proves only two
runtime grants, and rejects RLS, policy, table-grant and data mutations. The
disposable PostgreSQL proof establishes buyer/seller isolation, the five-of-six
summary bound, historical snapshot output and the private-helper grant
boundary. Application tests prohibit either converted surface from returning
to direct Prisma Order reads.
