# OrderPaymentEvent signed-refund identity compatibility

Status: compatible migration production-applied; final scope acceptance and
pooled-runtime postflight pending. Audited 2026-08-27 before the fresh automatic
blocked-checkout paid proof and before `OrderPaymentEvent` RLS design resumes.

## Finding

The pinned Stripe API's real `charge.refunded` payload can contain the signed
charge ID, currency and cumulative `amount_refunded` while omitting the nested
`charge.refunds.data` collection. The webhook correctly treats that collection
as optional and passes null for the latest refund's ID and fields. The existing
fixed database function then uses `external:<event-id>` as its refund identity.

That fallback is correct when Grainline has no exact local refund evidence. It
is incorrect when a seller, staff Case or blocked-checkout function has already
co-committed the provider refund ID, amount and audit evidence. In that exact
state the old signed function classifies the genuine confirmation as an
`additional_external_refund`, stores a null `latestRefundId`, and overwrites the
Order's already-correct review note. The reconciled failed proof observed this
historical representation. A new automatic proof would reproduce it even
though the destination-transfer race is fixed.

Classification: `FIX_BEFORE_ACTIVATION` and `BLOCKS_PROVIDER_PROOF`. This is an
accounting/domain defect discovered by the required pre-RLS audit, not an RLS
policy defect. Do not spend another test payment until the compatible
correction is live and its runtime postflight passes.

## Correct invariant

A missing provider refund ID may be derived only inside PostgreSQL and only
from one exact durable local refund tuple. The signed function requires all of:

- the active, generation-matched `charge.refunded` lease and charge-derived
  locked Order already required by the predecessor;
- a non-sentinel `Order.sellerRefundId` with Stripe `re_` shape;
- `Order.sellerRefundAmountCents` equal to the signed cumulative refunded
  amount;
- exactly one matching append-only `OrderPaymentEvent` for that Order, refund
  ID, amount and currency;
- one of the three fixed local actions: `SELLER_REFUND_RECORDED`,
  `CASE_REFUND_RECORDED`, or `BLOCKED_CHECKOUT_REFUND_RECORDED`;
- the action's exact reason, canonical local event identity and `refundIds`
  membership; and
- a co-committed `SystemAuditLog` row binding the same action, Order, payment
  event, refund ID, amount and currency.

When every predicate holds exactly once, the function derives refund ID,
amount and normalized status from the database evidence, records
`local_refund_confirmed`, identifies the evidence row/action in metadata, and
does not update the Order. Missing, duplicate, malformed or mismatched evidence
retains the existing external/additional-external behavior. No target, amount
or identity becomes caller-controlled.

## Compatibility and replay

Migration `20260828010000_prepare_order_payment_signed_refund_identity`
replaces only the existing same-signature
`grainline_order_payment_signed_refund_apply` function. It does not change the
schema, table grants, RLS posture, dispute authority or application call shape.
Old and new deployments remain compatible.

New derived rows replay only when their database-derived identity and evidence
binding remain exact. Rows produced by the old missing-collection behavior also
retain exact replay support; the migration does not rewrite or reinterpret
historical financial evidence. A legacy row is evidence of the old
classification, not proof that the automatic provider path passed.

## Proof package

The candidate is generated from and checksum-binds the byte-sealed signed
authority predecessor. Local disposable PostgreSQL proves all three fixed local
families, exact replay, the historical replay representation, missing-audit,
duplicate-evidence and amount-mismatch fail-closed behavior, plus generation
forgery denial. A separate PostgreSQL 16 proof uses distinct owner and ordinary
runtime logins, compares the stored function body exactly, verifies ACLs and
tests exact derivation plus missing-audit fallback through the runtime role.

CI isolates the successor until the complete sealed predecessor chain is
applied. The dedicated guarded production workflow accepts only exact-main
successful CI, one exact absent/applied migration ledger state, the exact
predecessor or successor function body and the reviewed owner/runtime ACL. It
is restart-safe and changes no RLS or table privilege.

After application,
`scripts/order-payment-signed-refund-identity-production-postflight.mjs` runs
only through the pooled `grainline_app_runtime` credential in an
engine-attested repeatable-read/read-only transaction. It verifies the actual
restricted role, exact candidate function body and ACL, retained compatible
`OrderPaymentEvent` grants/RLS-off posture, a direct empty read and the fixed
function's read-only lock fence. It writes only fresh sanitized mode-0600
evidence and cannot mutate production.

Exact-head PR CI run `33144446602` failed closed in the real PostgreSQL
runtime-login proof before exercising the candidate function. The disposable
fixture had created an Order without its required Listing/OrderItem seller
graph, so the existing deferred durable-seller-key invariant rejected the
transaction with `Order durable seller key is incomplete or inconsistent`.
The candidate SQL did not fail and production was not contacted. The proof now
creates the complete private Listing -> Order -> OrderItem graph with matching
seller keys and totals, deletes that graph during teardown, and has a focused
regression assertion for the real-schema fixture shape. A fresh exact-head CI
run is required; the failed run is not release evidence.

PR #302 merged exact head
`f5b5b7f394b44b68145bb856458ae16be2baf936` as main
`f7491bf109a79ac7f34c29c604763c38396a7340`; exact-main CI
`33149665189` passed. Guarded production run `33176428000` applied only
`20260828010000_prepare_order_payment_signed_refund_identity`; Prisma migration
status and the global grant/RLS audit passed. Its final engine-read-only scope
step failed after application because the successor verifier first compared
the replaced signed-refund function to the sealed predecessor body. The
candidate-specific comparison had not yet run. This is a proof-composition
defect: the migration is applied, but the release is not accepted.

The isolated correction validates the actual successor function and ACL first,
requires the nested predecessor and candidate catalog reads to contain the same
one function body, and substitutes only the locally byte-sealed predecessor
body while recursively checking the older release chain. Missing, duplicate or
different catalog views fail closed. Rerun only from the exact restart state;
do not replay the migration, run the pooled-runtime postflight, spend another
Stripe test payment or claim compatibility acceptance until corrected CI and
the guarded final scope pass.

## Remaining release sequence

1. Complete local/full CI and Extra-High review of the successor-aware scope
   correction; merge only the exact reviewed candidate.
2. Rerun the restart-safe guarded workflow. It must classify the migration as
   already applied, skip deployment and pass the corrected final read-only
   scope plus migration/global audits.
3. Run a distinct pooled-runtime read-only postflight against the applied
   function.
4. Bind and deploy the exact compatible source if a deployment is needed for a
   new proof namespace.
5. Run one completely fresh automatic blocked-checkout paid proof. Never reuse
   the reconciled `a6593516be9f` fixture or evidence namespace.
6. Drain the predecessor only after the new proof passes, then resume the
   remaining `OrderPaymentEvent` authority/invariant and ENABLE/FORCE gates.

This candidate does not authorize a migration, deployment, Stripe operation,
predecessor drain or RLS activation.
