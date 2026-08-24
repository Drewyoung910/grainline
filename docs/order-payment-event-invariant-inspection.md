# OrderPaymentEvent invariant inspection extension

Status: the corrected 66-count inspector merged through exact main
`bc64516c6463118012c643806a3f398f2584092c`. Exact-main CI `32782625503`
passed and protected engine-read-only production inspection `32783261534`
completed with sanitized evidence. The additive 76-count label classifier is
an isolated successor and has not been merged or dispatched.

Audited: 2026-08-24 after the staff Case participant-delivery candidate.

## Why the inspection comes first

The historical Order/payment/shipping inspection retained 54 aggregate fields
and correctly classified the then-empty `OrderPaymentEvent` table. Signed
Stripe test-mode and refund-canary work occurred afterward. The invariant
release must therefore classify the current rows before it validates legacy
data or assumes every row has the source shape produced by the converted
writers.

The existing engine-enforced, repeatable-read, read-only inspection is extended
to exactly 66 aggregate fields. The 12 additions report only counts and retain
no row, Order, user, provider-object or event identity:

- blank event identities, incomplete object identity and blank optional text;
- unknown source-family prefixes;
- invalid signed and local source-family shape;
- invalid refund and dispute shape;
- provider objects associated with more than one Order;
- signed rows missing provider ordering time;
- local rows carrying provider ordering time; and
- same-provider-second dispute rows with conflicting canonical state.

The prior 54-count evidence remains historically accurate and is not rewritten.
The successor query is additive and remains one aggregate-only `SELECT` inside
the same owner-bound read-only transaction and protected-environment workflow.

The inspection deliberately compiles both before and after the separate signed
authority migration adds `stripeEventCreatedSeconds`. It reads provider time
through the row's JSON projection: an absent predecessor column and a prepared
null value both classify as missing, a populated bigint remains exact, and an
invalid non-bigint representation fails closed.

Exact-head CI run `32770581896` failed safely before later gates because the
first extension referenced the not-yet-restored compatible column directly.
No production data or state was touched. The dual-schema projection and its
regression guard are the correction; the failed run is not acceptance evidence.

Corrected exact head `dd790d40f1c7212c31a0953a8386213c686ded31` passed full
CI run `32770970002` on 2026-08-24. The run proved the 66-count inspection
against the intentionally isolated predecessor schema, then restored and
proved the later signed-authority migration stack. TypeScript, lint, the full
test suite, security audit and production build also passed. This is packaging
and disposable-PostgreSQL acceptance only: the production inspection was not
dispatched and no production or provider state changed.

After the stack merged at exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739`, protected production inspection
run `32773408735` failed closed with `POSTURE_MISMATCH` before the aggregate
query ran or an evidence file was created. Its posture fence still classified
`SellerPayoutEvent` as a broad-CRUD predecessor even though that service ledger
had since completed FORCE RLS. The successor fence requires
`CheckoutStockReservation`, `StripeWebhookEvent` and `SellerPayoutEvent` all to
be policyless FORCE tables with zero ordinary-runtime CRUD, while `Order`,
`OrderItem`, `OrderPaymentEvent` and `OrderShippingRateQuote` remain exact
RLS-off broad-CRUD predecessors. The failed run made no production mutation and
is not inspection evidence.

## Decision boundary

Nonzero counts are classification evidence, not permission to delete, rewrite
or weaken a constraint. Review the exact sanitized artifact before preparing
legacy repair or validation. The inspection itself does not:

- add or validate a constraint or trigger;
- change `OrderPaymentEvent` grants or RLS;
- enumerate provider IDs, Orders or users;
- run Stripe operations; or
- authorize the later compatible migration, application deployment, policyless
  `ENABLE`, predecessor drain or `FORCE` release.

The same inspection must be rerun immediately before activation if the table
can change after the first successor snapshot.

## Accepted 2026-08-24 production classification

PR #262 corrected only the posture fence and merged at exact main
`bc64516c6463118012c643806a3f398f2584092c`. Full exact-main CI
`32782625503` passed. Protected run `32783261534` then executed the exact
66-field query inside an engine-attested `REPEATABLE READ READ ONLY`
transaction and produced sanitized evidence with SHA-256
`2a4e2819efa40acae014521aff141408cef66d468d0f4935c093415416dbbe30`.
It retained no address, credential, object/provider/user identity, row or
snapshot.

The accepted snapshot contained 2 Orders, 3 OrderItems and 13 already-hardened
StripeWebhookEvents. It contained zero OrderPaymentEvents, SellerPayoutEvents,
CheckoutStockReservations and OrderShippingRateQuotes. Every payment,
reservation, quote, payout, refund, dispute, replay, amount, currency,
privacy, source-family and collision defect count was zero. The only nonzero
defect count was `label_state_coherence_count = 1`, an Order lifecycle finding
that does not authorize repair and does not block the separately empty
OrderPaymentEvent invariant design.

The next additive successor retains the accepted historical 66-field evidence
and extends the same single aggregate `SELECT` to exactly 76 fields. Ten
overlapping counts classify whether the one Order finding is a negative label
cost, a PURCHASED label missing its transaction, URL or timestamp, a
PURCHASED label with non-shipping method or invalid fulfillment status, or a
null-status label retaining transaction, URL, timestamp or cost state. The
successor retains no Order or provider identity and performs no mutation.
Nonzero subtype counts remain classification only; cleanup requires a separate
reviewed boundary.
