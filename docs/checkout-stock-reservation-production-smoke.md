# CheckoutStockReservation production checkout smoke

Status: accepted production execution passed on 2026-08-14 from exact main
`e9d343b6f316ceb1c75553aec77e9f310a12d802`, bound to exact-main CI
`31829740992` (all 109 gates passed).
Production still serves compatible application commit
`84a58f0fc818b502564ef6bcd974ff4af3cc4395` as Vercel deployment
`dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`. CheckoutStockReservation RLS remains off
and predecessor direct grants remain compatible.

## Accepted production execution

The exact reviewed operator passed against the canonical production
application and the pooled `grainline_app_runtime` database role. It proved:

- three authenticated checkout creations and three exact retry reuses across
  Buy Now in-stock, Buy Now made-to-order and cart in-stock paths;
- authenticated cart resume, rollback and stock restoration;
- explicit cross-origin denial and zero Order creation;
- three genuine Stripe test-mode Checkout Session expirations followed by
  three processed signed `checkout.session.expired` deliveries;
- exactly one processed made-to-order
  `checkout.session.stock_restored` idempotency claim; and
- complete cleanup of database fixtures, Redis locks, account-state cache,
  canary sessions and temporary terms state.

The sanitized mode-`0600` evidence is stored outside the repository at
`checkout-stock-reservation-production-smoke-e9d343b6f316ceb1c75553aec77e9f310a12d802.json`.
Its SHA-256 is
`86b37f18cae8fadb8a126b548455201a7816c74f00731d13fa8a6bf2de8602db`.
It retains counts and booleans only, reports `secretsRetained=false`, and
records every cleanup invariant as true. Expected immutable provider/audit
residue is limited to three expired test Checkout Sessions, three processed
expiry ledger rows and one processed made-to-order restore claim.

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
  `checkout.session.expired` deliveries in the production webhook ledger;
- exactly one processed `checkout.session.stock_restored` synthetic claim for
  the made-to-order session, which has no fixed stock reservation. This durable
  idempotency row prevents the later signed expiry delivery from falling back
  through the predecessor restore path a second time.

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
  restore/abort functions, verifies stock, waits for the real signed expiry
  ledger rows, deletes exact database fixtures, removes exact Redis locks and
  the account-state cache key, restores the canary terms fields and revokes all
  canary sessions. It never deletes a terminal reservation before signed
  expiry processing, preventing a late event from falling through to the
  predecessor restore path.
- Stripe Checkout Sessions, three signed expiry ledger rows and the one
  synthetic made-to-order restore claim remain as expected immutable
  provider/audit and idempotency evidence. The final mode-`0600`
  evidence contains counts and booleans only—no credentials, Clerk/database
  identifiers, session IDs, listing IDs or Redis keys.

## Reviewed invocation shape

The accepted invocation was:

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
