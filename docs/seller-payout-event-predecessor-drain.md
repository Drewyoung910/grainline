# SellerPayoutEvent predecessor deployment drain

Status: prepared and locally proven only. The read-only provider inventory and
tracked-source audit are accepted. No deployment has been removed by this
release, no database or provider configuration has changed, RLS remains off,
and predecessor table grants remain intact.

## Why this boundary exists

The compatible SellerPayoutEvent application is on every canonical production
alias, but a READY superseded Vercel deployment remains callable through its
unique URL. That predecessor was built after the accepted database credential
recovery and is conservatively treated as carrying the current pooled runtime
password. Revoking direct `SellerPayoutEvent` table grants while it remains
callable could turn an invocation or rollback to that artifact into a database
authorization failure.

Elapsed time closes in-flight requests but does not make a READY deployment's
unique URL unreachable. This gate therefore requires both:

1. zero tracked direct application access to `SellerPayoutEvent`; and
2. exact-ID removal plus absence proof for every callable current-credential
   predecessor.

## Exact read-only inventory

The 2026-08-22 read-only Vercel inventory included READY, BUILDING, QUEUED and
INITIALIZING Production states and found:

- current compatible deployment
  `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`, URL
  `grainline-qps6dvkab-drew-youngs-projects.vercel.app`, source
  `e9239463a71860451191344b26dd20b45298f239`, created at provider timestamp
  `1786857420805` (`2026-08-16T05:17:00.805Z`);
- exactly one newer-than-recovery predecessor,
  `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`, URL
  `grainline-l8zenc6ym-drew-youngs-projects.vercel.app`, source
  `84a58f0fc818b502564ef6bcd974ff4af3cc4395`, created at provider timestamp
  `1786729932642` (`2026-08-14T17:52:12.642Z`); and
- only older READY Production deployments after those rows. The byte-verified
  2026-08-13 credential-recovery evidence proves the superseded runtime and
  owner passwords reject, so those earlier artifacts cannot reach PostgreSQL
  with their embedded credentials.

Exact-ID inspection reported both reviewed deployments READY and capped every
function at 300 seconds. The current deployment has exceeded that request
bound by multiple days. This inventory does not remove either deployment.

## Zero-direct-access proof

`scripts/verify-seller-payout-event-zero-direct-access.mjs` enumerates every
tracked JavaScript/TypeScript source under `src/`. It fails closed on direct
Prisma delegate property access, computed delegate access, or raw quoted table
references. It also requires the exact three fixed-authority consumers:

- `src/lib/stripePayoutWebhook.ts`;
- `src/app/dashboard/seller/page.tsx`; and
- `src/app/api/account/export/route.ts`.

The current proof independently scanned both the exact deployed source
`e9239463a71860451191344b26dd20b45298f239` and the later operator tree. Each
tree contains 723 tracked source files, exactly those three consumers, the exact
six files containing any SellerPayoutEvent reference and zero direct access
matches. CI runs the current-tree proof on every change; the drain additionally
pins and reads the deployed Git tree by its exact commit. Any new reference, a
new direct consumer or a missing/extra authority consumer blocks the boundary.
This static proof complements rather than replaces the later live PostgreSQL
grant and pooled-runtime denial proofs.

## Restart-safe operator contract

`scripts/seller-payout-event-predecessor-drain.mjs`:

1. requires an exact clean `main` commit and successful same-commit `CI` run;
2. byte-verifies accepted mode-`0600` credential-recovery evidence at SHA-256
   `ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943`;
3. requires the exact two newest active-or-pending Production deployment rows,
   exact READY state, source commits and creation timestamps, with no
   unreviewed row before or between them;
4. verifies both exact deployment identities and the 300-second maximum
   request boundary;
5. reruns the zero-direct-access proof independently against the exact deployed
   source commit and the exact operator commit;
6. proves all four canonical aliases resolve to the current deployment and
   canonical health is exactly `{ "ok": true }`;
7. writes mode-`0600` restart state before mutation;
8. removes only exact deployment `dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`—never a
   project name, alias or deployment collection; and
9. proves the predecessor is absent, the current deployment and aliases remain
   intact, health remains green, then writes sanitized mode-`0600` evidence and
   removes restart state.

Immediately before removal it refreshes the current exact deployment, aliases,
health and active-or-pending inventory, so a new production build or alias
change cannot silently cross the reviewed boundary. If interruption occurs
after exact removal but before state advancement, the same exact commit/CI run
may prove absence and finalize. Every different
commit, run, deployment, inventory order, source, alias, health response,
timeout, recovery-evidence byte, state shape or source-access inventory fails
closed.

The operator contains no SQL, database connection, migration, RLS/grant,
deployment creation, alias promotion, environment-variable, credential, Stripe
or Vercel-configuration mutation. Exact deployment removal is destructive and
remains a separate execution boundary; recreation would require redeploying
the exact historical source.

## Reviewed invocation shape

After this release merges and exact-main CI succeeds, run the read-only
preflight from that exact clean main checkout:

```sh
SELLER_PAYOUT_DRAIN_CONFIRM=reviewed-seller-payout-event-predecessor-drain \
SELLER_PAYOUT_DRAIN_OPERATOR_COMMIT=<exact-main-commit> \
SELLER_PAYOUT_DRAIN_MAIN_CI_RUN_ID=<same-commit-green-CI-run> \
SELLER_PAYOUT_DRAIN_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/seller-payout-event-predecessor-drain-<exact-main-commit>.json \
npm run ops:seller-payout-event-predecessor-drain -- preflight
```

Run mode uses the same exact bindings and must follow only after the read-only
preflight passes. On failure, preserve the mode-`0600` restart state and stop;
never delete or edit it manually.

## Following boundary

Accepted drain evidence will permit preparation—not execution—of the separate
policyless ENABLE plus direct-grant-revocation release. It does not activate
RLS, change grants or authorize the later posture-only FORCE release.
