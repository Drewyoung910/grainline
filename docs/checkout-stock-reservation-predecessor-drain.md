# CheckoutStockReservation predecessor deployment drain

Status: reviewed restart-safe operator prepared on an isolated branch;
production predecessor retirement has not yet executed. RLS remains off and
the predecessor direct table grants remain intact until this record is updated
with accepted execution evidence.

## Why elapsed time alone is insufficient

Vercel's canonical aliases moved to the compatible application, but a READY
superseded deployment remains callable through its unique URL. Revoking
`CheckoutStockReservation` table grants while that deployment can still run
would turn an otherwise safe rollback or direct invocation into a database
authorization failure. The compatibility boundary therefore closes only when
every deployment that can authenticate with the current runtime password is
either the compatible deployment or is no longer callable.

## Exact live inventory

The 2026-08-14 provider inventory found:

- current compatible deployment
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`, URL
  `grainline-l8zenc6ym-drew-youngs-projects.vercel.app`, source
  `84a58f0fc818b502564ef6bcd974ff4af3cc4395`, created at provider timestamp
  `1786729932642`;
- one superseded deployment carrying the same replacement runtime credential:
  `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6`, URL
  `grainline-os3mvmmdd-drew-youngs-projects.vercel.app`, source
  `69c14c0618ea7ab9c74756422273d17d66db7efa`, created at provider timestamp
  `1786644755419`; and
- only older deployments after those two. The accepted 2026-08-13 credential
  recovery proves the prior `grainline_app_runtime` password rejects, so those
  older artifacts cannot reach PostgreSQL with their embedded credential.

The provider metadata on the superseded deployment includes the exact sealed
credential-recovery marker
`729a29a85b1505712465cd92accde582ab2fe2b8d299405b5e2044f254724489`.
No other deployment exists between the replacement-credential deployment and
the current compatible deployment.

## Operator contract

`scripts/checkout-stock-reservation-predecessor-drain.mjs` is intentionally
narrow. It:

1. requires an exact clean `main` commit and successful same-commit `CI` run;
2. byte-verifies the accepted mode-`0600` database credential recovery
   evidence at SHA-256
   `ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943`;
3. requires the exact two newest READY Production deployment rows, exact
   sources, creation timestamps and recovery marker;
4. proves both deployments' maximum function timeout is no more than 300
   seconds and requires the current deployment to have been live longer than
   that bound;
5. proves all four canonical aliases resolve to the current deployment and
   canonical `/api/health` returns exactly `{ "ok": true }`;
6. writes a mode-`0600` restart state before mutation;
7. removes only exact deployment
   `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6`—never a project name or deployment
   collection; and
8. proves the predecessor is absent, the current deployment and aliases remain
   intact, health is green, then writes sanitized mode-`0600` evidence and
   removes restart state.

The operator contains no migration, SQL, database connection, RLS, grant,
secret rotation, deployment creation, alias promotion or environment-variable
operation. Removing this exact Vercel deployment is destructive provider state;
the artifact can be recreated only by redeploying its exact historical source.

## Execution

After this operator branch merges and its exact-main CI succeeds, run from that
exact clean main checkout:

```sh
CHECKOUT_STOCK_DRAIN_CONFIRM=reviewed-checkout-stock-predecessor-drain \
CHECKOUT_STOCK_DRAIN_OPERATOR_COMMIT=<exact-main-commit> \
CHECKOUT_STOCK_DRAIN_MAIN_CI_RUN_ID=<same-commit-green-CI-run> \
CHECKOUT_STOCK_DRAIN_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/checkout-stock-reservation-predecessor-drain-<exact-main-commit>.json \
npm run ops:checkout-stock-reservation-predecessor-drain -- preflight
```

Repeat with `run` only after preflight passes. A failed run must retain the
private restart state. Rerun the same exact commit and CI binding; do not delete
or edit that state by hand.

## Following boundary

Accepted drain evidence permits preparation of a separate policyless ENABLE
plus predecessor direct-grant revocation release. It does not itself authorize
that database change. FORCE remains a later posture-only release.
