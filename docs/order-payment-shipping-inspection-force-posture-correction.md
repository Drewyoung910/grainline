# Order/payment/shipping inspection FORCE-posture correction

Status: isolated operational correction only. It does not run an inspection,
query production, apply a migration, change grants/RLS, deploy application code,
or change provider state.

Prepared: 2026-08-15

## Failed run and root cause

Protected inspection run `31918034914` was dispatched from exact main
`e78c1ef28f88778f86947a8cb501af8dfb916b26`. The Production environment gate
was approved only for the aggregate-only inspection. PostgreSQL was opened
inside the script's repeatable-read/read-only transaction, and the first
catalog posture check failed closed before the aggregate count query.

The failure was expected drift in the inspection contract, not database drift:
the inspector still required `CheckoutStockReservation` to be RLS-off with
broad runtime CRUD even though its reviewed FORCE release and actual pooled
runtime postflight had completed earlier on 2026-08-15. The script emitted no
counts and wrote no evidence file; the always-run artifact upload therefore
also failed. No migration, row mutation, grant/RLS change, deployment or
provider mutation occurred.

## Exact corrected posture

The corrected inspector accepts only these two policyless FORCE tables:

- `CheckoutStockReservation`; and
- `StripeWebhookEvent`.

Both must be owned by `neondb_owner`, have `ENABLE` plus `FORCE` RLS, have zero
policies and deny all direct table CRUD to `grainline_app_runtime`.

The remaining exact predecessor set is:

- `Order`;
- `OrderItem`;
- `OrderPaymentEvent`;
- `OrderShippingRateQuote`; and
- `SellerPayoutEvent`.

Each predecessor must remain owned by `neondb_owner`, RLS-off/FORCE-off with
zero policies and all four direct runtime CRUD privileges. Missing or extra
tables, owner drift, any policy, partial FORCE posture or any privilege drift
fails before aggregate counts are accepted.

The explicit prerequisite marker now names completed
CheckoutStockReservation FORCE plus runtime-separation postflights. Failure
logs expose only a bounded classification code such as `POSTURE_MISMATCH`, not
raw database errors or secrets.

## Proof and next boundary

Unit coverage constructs the complete seven-table catalog and rejects a stale
CheckoutStockReservation predecessor, an early SellerPayoutEvent activation,
missing tables, policy drift and owner drift. Existing tests continue to prove
the exact 54-field aggregate shape, engine-enforced read-only transaction,
sanitized mode-0600 evidence and protected manual-main workflow.

After this correction passes exact-head CI, it may merge independently. A new
protected inspection must then run from the resulting exact main commit and
produce a reviewed sanitized artifact. Nothing here authorizes the
SellerPayoutEvent migration, application merge/deploy, RLS activation, cleanup
or another sensitive-data group.
