# StripeWebhookEvent policyless activation candidate

Status: isolated draft candidate only. It is not merged, deployed or applied to
production. Production remains on the compatible predecessor: RLS and FORCE
off, zero policies, and ordinary runtime CRUD retained for mixed-deployment
compatibility.

## Exact release boundary

- migration: `20260805060000_enable_stripe_webhook_event_rls`
- draft SHA-256:
  `cd34605de8d48601283ebeae8be24458e2ec49e32c871726ec18c9e84169aebe`
- promoted migration SHA-256:
  `044c662136daaf68a78e0ada7b2a3a2501c17fde6bfa3d69f321985402848b72`
- migration-tree SHA-256:
  `4a59c7f9cc42b334371cf5ff91e1b9f1a734f720be3472d7e1d8565d87bf08b6`
- database-first rollback SHA-256:
  `a59b087417806305e6fe114c6bddebf7b164e1a2be64d077858403ba7d4cd555`
- guarded phase: `stripe-webhook-event-activation-reviewed`
- protected table: exactly `public."StripeWebhookEvent"`
- fixed runtime functions: exactly six
- policies: zero
- FORCE: deliberately off until a separate posture-only release
- direct runtime table and column privileges after activation: zero
- row-data mutations in the activation: zero

The draft-to-migration staging tool accepts only the exact byte-pinned SQL and
rejects policies, FORCE, function creation, row-data writes, and table grants.
The release verifier independently pins the promoted migration, entire
migration tree, rollback SQL, Prisma config and production deploy-guard shape.

## Authority model

`StripeWebhookEvent` is a service ledger, not participant-owned data. The
runtime role therefore receives no row policy and no direct table authority.
All application and operations access remains through these exact fixed
`SECURITY DEFINER` functions:

1. `grainline_stripe_webhook_begin(text,text)`
2. `grainline_stripe_webhook_complete(text,bigint)`
3. `grainline_stripe_webhook_fail(text,bigint,text)`
4. `grainline_stripe_webhook_prune_batch(integer)`
5. `grainline_stripe_webhook_health_summary()`
6. `grainline_legacy_stock_restore_claim(text)`

The activation preflight requires the table-owner migration session, an owner
that can continue through later FORCE, the exact NOBYPASSRLS/NOINHERIT runtime
role posture, and only the proven non-effective Neon bootstrap membership
edge. It recursively rejects other membership. It also pins the predecessor
grant/policy state, claim-generation invariant, required indexes, row
coherence, exact function identities through `oidvectortypes(proargtypes)`,
owners, search paths, volatility, ACLs and absence of dynamic SQL.

## Mixed-deployment sequence

This migration must not run until the stacked compatible application changes
have merged, deployed and drained. A pre-activation compatibility postflight
still reads the table directly under the pooled runtime role, so CI isolates
this migration until all predecessor proofs complete. CI then restores and
applies only this activation, converges the runtime role, audits the complete
grant/RLS catalog, and runs the activated proofs.

Production migration wiring does not authorize production. A future manual
dispatch must be bound to one exact reviewed main commit after its exact-main
CI succeeds and after the compatible app deployment/drain evidence is
accepted.

## Proof contract

The disposable PostgreSQL proof must establish:

- exact policyless ENABLE/NO-FORCE posture and zero runtime table/column
  privileges;
- SQLSTATE `42501` for direct runtime SELECT, INSERT, UPDATE and DELETE;
- exact six-function catalog and successful begin/fail/reclaim/complete,
  health, prune and legacy-claim calls with zero residue;
- the existing full lease proof again behind activation, including immutable
  type, stale-generation rejection and database-clock reclaim;
- the existing maintenance proof again behind activation, including bounded
  prune, aggregate health and advisory-lock claim race; and
- a database-first rollback that restores predecessor CRUD for old code, then
  always restores the exact activated posture and leaves no fixture row.

The new engine scripts reject every non-loopback target and require the
`grainline_ci` database. Local PostgreSQL is unavailable in this worktree, so
GitHub Actions is the load-bearing engine/syntax/concurrency proof. Static
release, grant-inventory and deploy-guard tests passing locally do not by
themselves claim PostgreSQL acceptance.

Exact-head CI run `30978141342` reached the activated disposable PostgreSQL
posture and passed migration application, grant convergence and the global
grant/RLS audit, then failed closed in the activation proof because its
synthetic legacy-claim value contained underscores after the accepted Stripe
test prefix. The fixed function correctly rejected that noncanonical fixture.
The proof now uses `cs_test_grainlineactivationproof`, asserts that the fixture
and migration retain the same canonical checkout-session format, and binds its
rollback residue check to that exported value. This was a proof-fixture defect;
it did not reach or change production.

## Remaining gates

1. Commit and push the isolated candidate and open a draft PR.
2. Obtain green exact-head CI, including disposable PostgreSQL, full tests,
   dependency audit and production build.
3. Perform a separate Extra-High authority/SQL review of the exact head.
4. Merge the stacked compatible preparation/application/maintenance releases
   in order; run the compatible production migrations and deploy the compatible
   app without activating this migration.
5. Verify signed webhook, retry, ops-health, retention and legacy stock-restore
   behavior, drain the prior deployment, and run the predecessor postflight.
6. Only then review an exact-main production activation dispatch.
7. Prepare FORCE as its own later posture-only release after stable activation
   evidence.

No production state or provider variable changes are authorized by this
candidate.
