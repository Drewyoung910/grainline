# CheckoutStockReservation predecessor deployment drain

Status: complete. The exact predecessor is removed, final restart-safe evidence
is accepted, all current aliases and health are preserved, and the private
restart marker is absent. RLS remains off and direct table grants remain intact
until the separate policyless ENABLE/grant-revocation release.

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

## Fail-closed execution interruption (2026-08-14)

- Exact main `05e652501485e2701720e1883906ec0a36bb75a0` and same-commit CI
  `31845083086` passed. The read-only preflight reported exactly one
  shared-credential predecessor.
- The authorized exact-ID removal made
  `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6` non-inspectable. The current deployment
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw` remained READY with all four aliases.
- Finalization failed closed because Vercel CLI 59.0.0 emits `Can't find the
  deployment` for the successful absence proof, while the reviewed parser
  recognized only `could not find`, `not found`, or `does not exist`.
- The mode-`0600` restart file remains at stage `removal-authorized`; no final
  evidence has been accepted. The correction recognizes only the additional
  real provider phrase and permits restart only from the exact old
  commit/CI/stage tuple above. Every other stale state still fails closed.
- No migration, deployment, database/RLS/grant, secret, alias, environment
  variable or provider-configuration change accompanied the interruption.

## Following boundary

Accepted drain evidence permits preparation of a separate policyless ENABLE
plus predecessor direct-grant revocation release. It does not itself authorize
that database change. FORCE remains a later posture-only release.

## Accepted execution evidence (2026-08-14)

- Initial exact main `05e652501485e2701720e1883906ec0a36bb75a0` / CI
  `31845083086` removed only the authorized predecessor, then failed closed on
  the provider diagnostic recorded above.
- Corrected exact main `4ff40f22c70072406168c378cdb13860f9de317b` / CI
  `31858295911` resumed only from that exact private state and completed all
  post-removal audits.
- Sanitized mode-`0600` evidence:
  `checkout-stock-reservation-predecessor-drain-4ff40f22c70072406168c378cdb13860f9de317b.json`;
  SHA-256
  `5f3b63675bdc84749b5f8fef25086bc42a5dddba5e87f5a46fa7bf6015322141`.
- Evidence records `sharedCredentialPredecessorsBefore=1`,
  `sharedCredentialPredecessorsAfter=0`, `predecessorRemoved=true`,
  `currentAliasesPreserved=true`, `canonicalHealthPassed=true`, and all
  migration/RLS/grant/provider-configuration mutation flags false.
- The restart file is absent. The current production deployment remains
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`; canonical health returned exactly
  `{ "ok": true }` after finalization.
