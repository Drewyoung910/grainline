# CheckoutStockReservation production checkout smoke

Status: operator implemented on an isolated branch; not merged or executed.
Production still serves compatible application commit
`84a58f0fc818b502564ef6bcd974ff4af3cc4395` as Vercel deployment
`dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`. CheckoutStockReservation RLS remains off
and predecessor direct grants remain compatible.

## Why this operator exists

The immediate production checks proved the canonical alias, health and four
unauthenticated route boundaries. They did not prove authenticated checkout.
The new operator closes that gap without using customer data or turning a real
listing into a test fixture.

It reuses the retained non-customer Clerk operational canary and an existing
eligible test-mode Stripe Connect seller. It creates two temporary private,
buyer-reserved listings under that seller and an empty canary cart fixture. It
does not edit seller configuration or inventory on a real listing.

## Covered production paths

- canonical deployment marker and `/api/health`;
- exact owner and pooled-runtime database identities, with reservation RLS
  still disabled at this compatibility stage;
- explicit cross-origin checkout denial;
- signed pickup quotes from the real production route;
- Buy Now for one in-stock listing and one made-to-order listing;
- cart checkout for one in-stock listing;
- exact same-payload retry reuse for all three Checkout Sessions;
- cart resume while its session is open, then absence after rollback;
- exact Stripe test-mode session expiry, reservation restoration, stock return,
  Redis lock release and zero Order creation; and
- receipt and processing of the three real signed
  `checkout.session.expired` deliveries in the production webhook ledger.

This is intentionally not a paid-completion test. A genuine paid completion
would create a charge, Order, notifications, emails and other durable business
state. Fabricating a `checkout.session.completed` payload would not prove the
provider path. The already-completed disposable provider proof covers the
success transition at the exact database/function boundary; a later end-to-end
paid canary, if desired, needs its own accounting and side-effect retention
decision. This production smoke must not claim that narrower test happened.

## Safety and residue contract

- The operator refuses Stripe live-mode credentials.
- It requires an exact clean reviewed `main` commit and independently reads the
  bound successful GitHub CI run.
- The Clerk canary must have no active session, Orders, cart items or active
  reservations before the run.
- Fixture discovery and cleanup are bounded by the exact canary, seller,
  private listing IDs and operator start time.
- A mode-`0600` restart state is written before mutation. `cleanup` can recover
  a session/reservation even if the route committed but its HTTP response was
  lost.
- Cleanup expires test Checkout Sessions, runs only the reviewed reservation
  restore/abort functions, verifies stock, deletes exact database fixtures,
  removes exact Redis locks and the account-state cache key, restores the
  canary terms fields and revokes all canary sessions.
- Stripe Checkout Sessions and their processed StripeWebhookEvent rows remain
  as expected immutable provider/audit evidence. The final mode-`0600`
  evidence contains counts and booleans only—no credentials, Clerk/database
  identifiers, session IDs, listing IDs or Redis keys.

## Reviewed invocation shape

After the operator commit is merged to `main` and its exact CI run succeeds:

```sh
CHECKOUT_STOCK_SMOKE_CONFIRM=reviewed-checkout-stock-production-smoke \
CHECKOUT_STOCK_SMOKE_OPERATOR_COMMIT='<exact-main-commit>' \
CHECKOUT_STOCK_SMOKE_MAIN_CI_RUN_ID='<successful-exact-main-CI-run>' \
CHECKOUT_STOCK_SMOKE_EVIDENCE_PATH="/Users/drewyoung/grainline-rollout-evidence/checkout-stock-reservation-production-smoke-<exact-main-commit>.json" \
npm run ops:checkout-stock-reservation-production-smoke -- run
```

If a process interruption retains the private state file, do not start a new
run. From the same reviewed source and credential files, run:

```sh
npm run ops:checkout-stock-reservation-production-smoke -- cleanup
```

Only a passed artifact with every cleanup boolean true can satisfy this gate.
Afterward, prove predecessor deployment drain before preparing policyless
`ENABLE ROW LEVEL SECURITY` plus predecessor direct-grant revocation. FORCE is
a later posture-only release.
