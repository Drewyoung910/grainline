# OrderItem RLS audit start — 2026-09-30

## Boundary

`OrderItem` is the next Order-domain RLS release after completed Core `Order`
FORCE. `OrderShippingRateQuote` remains a separate successor release. This
record starts the table-specific audit; it does not claim readiness and does
not authorize or perform a migration, ENABLE, FORCE, deployment, or Production
mutation.

The source baseline inspected here is public main
`6ed0476659327961170fc186389a0d055da7f2be`. PR `#487` is a separate
dispute-recovery source change and was still unmerged when this record began.

## Verified inherited posture

- `tests/order-direct-access-inventory.test.mjs` pins direct application access
  to `Order`, `OrderItem`, and `OrderShippingRateQuote` at zero. Its scan covers
  Prisma delegates and raw SQL relation access in `src/**/*.ts` and
  `src/**/*.tsx`.
- Production migration
  `20260929130000_revoke_order_item_shipping_quote_runtime_access` has an
  accepted release record and revokes every table privilege on `OrderItem` and
  `OrderShippingRateQuote` from PUBLIC and `grainline_app_runtime`.
- The accepted Core Order FORCE preflight confirmed both child tables shared
  the reviewed owner, had RLS and FORCE off, had zero policies, and retained no
  ordinary-runtime or non-owner table/column grants at that boundary.
- Core `Order` FORCE is complete. It must not be repeated as part of this
  child-table release.

These inherited facts reduce the release surface, but they do not substitute
for a fresh `OrderItem` catalog read or disposable PostgreSQL proof.

## Table contract

`OrderItem` retains the immutable purchase-line snapshot:

- parent `orderId`, with cascade deletion from `Order`;
- source `listingId`, with deletion restricted;
- durable `sellerProfileId`, with update and deletion restricted;
- positive checkout quantity and integer unit price;
- bounded `listingSnapshot` and `selectedVariants` JSON;
- creation timestamp and indexes for order, listing, and seller projections.

Existing database authority also binds and checks the same-Order seller key.
The audit must retain that invariant and the JSON shape/size guardrails while
changing only the table's RLS posture.

## Current access shape

Application code has no direct `OrderItem` relation access. Reads and writes
are mediated by owner-executed fixed functions and table triggers. The
currently identified families include:

- paid checkout creation and post-payment completion;
- participant detail, summary, export, and receipt projections;
- bounded staff order reads;
- review, report, and seller-verification eligibility;
- public listing/seller aggregates and seller analytics;
- label preflight and label/refund/case operations;
- seller deauthorization and blocked-checkout recovery;
- seller-key bind/assert/complete trigger helpers.

The family inventory is intentionally broader than only functions named
`grainline_order_*`: Case and Notification authority can also read retained
order items. Activation review must resolve the latest installed definition of
every function touching `OrderItem`, rather than reviewing only its first
migration definition.

## Audit required before an ENABLE candidate

1. Produce an exact latest-definition catalog for every function and trigger
   that reads or writes `OrderItem`, including identity arguments, owner,
   `SECURITY DEFINER`/invoker mode, fixed `search_path`, volatility, PUBLIC
   EXECUTE, runtime EXECUTE, and staff-role EXECUTE.
2. Verify every application-reachable operation derives buyer, seller,
   listing, price, quantity, and snapshot authority inside the database and
   cannot accept caller-selected ownership or retained purchase history.
3. Verify trigger ownership and execution paths preserve seller-key and JSON
   invariants once RLS is enabled and later forced.
4. Re-read live Production catalog state for owner, grants, policies, RLS,
   FORCE, constraints, triggers, and dependent views/functions. Compare it to
   the source-derived inventory without storing credentials or row data.
5. Build a policyless ENABLE candidate only if the inventory remains zero
   direct. The candidate must fail closed on owner/grant/policy/function drift
   and leave `OrderShippingRateQuote` unchanged.
6. Prove the candidate in disposable PostgreSQL under the ordinary runtime and
   reviewed owner roles, including checkout write, participant/staff read,
   analytics, label/refund/case, trigger, cascade, and denied-direct-access
   paths.
7. Treat FORCE as a later posture-only decision after ENABLE application
   overlap and Production postflight are accepted. Preserve rollback and owner
   session-drain evidence separately.

## Release decision

Preparation may continue immediately after PR `#487` reaches a stable source
boundary. `OrderItem` is not yet activation-ready. The next implementation is
the latest-definition authority catalog and disposable proof, followed by a
separate reviewed ENABLE candidate. `OrderShippingRateQuote` starts after the
`OrderItem` release is accepted, though its read-only inventory can be prepared
in parallel.

The working estimate remains two to four focused working days for both child
tables if this audit finds no new authority or concurrency defect. After both,
the recommended next domain is `User` plus its `UserEmailAddress` boundary; it
requires a broader identity and PII design audit rather than a direct table
flip.
