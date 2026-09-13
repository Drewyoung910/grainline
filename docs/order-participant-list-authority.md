# Order participant list authority

Status: isolated additive preparation. This package has not been merged or
applied. `Order` RLS remains off and predecessor table grants remain unchanged.

Prepared: 2026-08-31

## Decision

Buyer and seller order lists use four fixed database operations:

- `grainline_order_buyer_count(text)`;
- `grainline_order_buyer_page(text, integer, bigint, text)`;
- `grainline_order_seller_count(text)`; and
- `grainline_order_seller_page(text, integer, bigint, text)`.

Each function is `SECURITY DEFINER`, owned through the migration path, pins
`search_path` to `pg_catalog`, grants non-grantable EXECUTE only to
`grainline_app_runtime`, and exposes no arbitrary predicate, column selector,
sort expression or dynamic SQL. Caller actor IDs remain untrusted inputs: the
buyer functions bind them to `Order.buyerId`, while seller functions resolve
the durable `SellerProfile.userId -> Order.sellerProfileId` relationship in
the same statement.

This shared-runtime architecture prevents accidental or forged order IDs from
crossing participant rows, but it does not cryptographically authenticate a
Clerk session inside PostgreSQL. A process that fully controls the application
and can call arbitrary approved functions can still supply another valid actor
ID. That is an explicit boundary of a shared database role, not a claim that
RLS replaces Clerk or application ingress authorization.

## Projection and scale properties

- Pages are capped at 100 rows.
- Cursors are the stable `(createdAt, id)` tuple already backed by buyer and
  seller indexes; no caller-provided offset or sort is accepted.
- PostgreSQL timestamps cross the driver as explicit UTC epoch milliseconds,
  avoiding the timestamp-without-time-zone parsing defect previously found in
  rollout evidence.
- Buyer pages expose totals, fulfillment state and refund amount, but no
  Stripe, Shippo, refund-claim, staff-review, label or address columns.
- Seller pages add only a buyer label source, a seller-notes presence bit and
  buyer lifecycle timestamps. They do not expose the seller note body or any
  provider identifiers.
- Deleted or PII-purged buyers return null name/email values to the seller.
- Order items remain outside this first projection. They continue through the
  bounded checkout snapshot while the separate `OrderItem` RLS release is
  prepared.

## Proof status

The disposable PostgreSQL proof covers:

- buyer and seller cross-actor isolation;
- durable seller routing without a Listing join;
- keyset continuation ordering;
- exact returned column names;
- deleted-buyer redaction;
- malformed limits and cursor-pair rejection; and
- runtime EXECUTE plus PUBLIC denial for all four functions.

The TypeScript result validators independently reject unknown fulfillment
states, unsafe monetary/timestamp values, oversized result sets and invalid
row counts. Application pages are not switched to these functions in this
preparation package. The safe release sequence is migration preparation,
production application, post-application catalog proof, compatible app
conversion, predecessor drain, then policyless RLS activation.

The implementation review caught and corrected one projection/parser mismatch
before the package was checkpointed: the seller row type requires
`items_subtotal_cents`, while the first SQL draft omitted it. The fixed
migration now returns the field and the PostgreSQL proof pins the complete
seller column set so the mismatch cannot recur silently.

Current validation: focused disposable PostgreSQL and release-chain proofs,
TypeScript, focused lint, grant-inventory tests, and the full repository test
suite all pass on the isolated branch.

## Remaining Order read work

- buyer and seller detail projections;
- staff queue/detail projections;
- participant export projections;
- review, verification, analytics and public aggregate operations; and
- conversion of every ordinary-runtime direct `Order` read before activation.

No work above is deferred beyond the active Order program. This four-function
slice is an independently provable starting point, not a readiness claim.
