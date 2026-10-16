# Audit #648 historical refund inventory

Status: reviewed read-only source candidate. It has not run against Production.

The aggregate inventory is
`scripts/order-refund-648-production-inventory.sql`. Run it only after migration
`20261015020000_repair_immutable_order_refund_recording` is installed and its
postflight succeeds.

The script uses a repeatable-read, read-only transaction with bounded statement,
lock and idle timeouts. Its output contains counts and cents only. It never emits
Order, user, seller, claim, reconciliation or Stripe object ids, so the aggregate
result is suitable for sanitized workflow evidence.

The ledger classification requires the maximum signed provider-refund total to
be at least the Order's full claim amount. The existence of any refund row is not
enough. This corrects the weaker aggregate test in the preserved Claude draft,
which could have classified a partial refund as proof of a full refund.

The second result counts claims that disappeared after a signed refund arrived
without a matching local refund record. Any nonzero result stops automated work.
Detailed identifiers must then be retrieved through a private owner session and
must not be written to a public GitHub log or artifact.

This inventory does not call Stripe, record a refund, restore stock, send email,
or mutate the database. Any repair requires a separate reviewed procedure and a
new Production approval.
