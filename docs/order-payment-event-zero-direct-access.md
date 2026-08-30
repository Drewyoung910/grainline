# OrderPaymentEvent zero-direct-access gate

Status: prepared and locally proved. Production acceptance remains pending an
exact-main CI-bound, read-only proof. No database or provider state changes in
this package.

## Purpose

`OrderPaymentEvent` still has RLS disabled and the pooled runtime still retains
predecessor table CRUD. Before those grants can be revoked, the application
must prove that neither the currently deployed source nor the activation-source
tree reaches the base table directly. This is an application-authority claim,
not an RLS or database-posture claim.

The credential-epoch drain is already accepted separately. Its retained
mode-`0600` evidence has SHA-256
`1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d` and
proves zero shared-credential predecessor deployments remain while current
deployment `dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc`, all four canonical aliases and
canonical health remain accepted. That drain deliberately made no
zero-direct-access claim.

## Closed application inventory

`scripts/verify-order-payment-event-zero-direct-access.mjs` scans every tracked
JavaScript and TypeScript source file, not a hand-selected directory. The local
proof currently scans 738 files. It pins exactly 12 files that mention
`OrderPaymentEvent`, `orderPaymentEvent` or `paymentEvents`; any additional or
missing reference fails closed.

Exactly seven application consumers import the fixed read-authority module:

- `src/app/account/orders/page.tsx`;
- `src/app/admin/orders/[id]/page.tsx`;
- `src/app/api/account/export/route.ts`;
- `src/app/dashboard/orders/[id]/page.tsx`;
- `src/app/dashboard/orders/page.tsx`;
- `src/app/dashboard/sales/[orderId]/page.tsx`; and
- `src/app/dashboard/sales/page.tsx`.

Those consumers use only five pinned database operations:

- `grainline_order_payment_buyer_refund_outcomes`;
- `grainline_order_payment_seller_refund_outcomes`;
- `grainline_order_payment_buyer_export_page`;
- `grainline_order_payment_seller_export_page`; and
- `grainline_order_payment_staff_timeline`.

The remaining five reference files contain only the fixed authority module,
display/state helpers, one Prisma input type and an invariant comment. They do
not query the base table.

The verifier rejects direct Prisma delegate properties, computed delegate
properties, destructured delegates, quoted or unquoted raw-table SQL, and
Prisma `Order.paymentEvents` relation selections. It also proves the exact
authority consumer set, reference-file set and five operation names. Both
currently deployed source `ce7550dae6c417440230f4d596f2239393075f31`
and the local operator tree return zero direct-access matches with the same
closed inventory.

## Exact production proof contract

`scripts/order-payment-event-zero-direct-access-production-proof.mjs` is
read-only with respect to GitHub, Vercel and production. It may write only one
sanitized mode-`0600` local evidence file. It:

1. requires an exact clean `main` commit and successful same-commit CI;
2. byte-verifies the accepted credential-epoch drain evidence;
3. inventories the complete current runtime-credential epoch and refuses any
   active deployment other than the exact current deployment;
4. inspects the current deployment, its maximum 300-second function boundary,
   all four aliases and canonical health;
5. independently scans deployed source
   `ce7550dae6c417440230f4d596f2239393075f31` and the exact operator commit;
6. requires both trees to contain the same seven consumers, 12 reference files
   and five operations with zero direct-access matches; and
7. writes sanitized acceptance evidence that explicitly records no migration,
   RLS, grant or provider-configuration change and retains no secret.

An existing evidence file is accepted only if it remains a mode-`0600` regular
file and every exact commit, CI, deployment, drain, inventory and no-mutation
field still matches. The operator has no database connection, migration,
deployment-removal or provider-mutation surface.

## Following gates

Production acceptance of this exact-tree proof is required before preparing
the policyless `ENABLE RLS` migration and direct runtime/PUBLIC table-grant
revocation. That activation remains a separate production mutation with its
own PostgreSQL, grant, rollback and pooled-runtime proofs. `FORCE RLS` follows
only after Phase A is accepted. `Order`, `OrderItem` and
`OrderShippingRateQuote` remain separate groups and must not be bundled.
