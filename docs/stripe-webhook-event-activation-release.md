# StripeWebhookEvent policyless activation candidate

Status: isolated draft candidate only. It is not merged, deployed or applied to
production. Production remains on the compatible predecessor: RLS and FORCE
off, zero policies, and ordinary runtime CRUD retained for mixed-deployment
compatibility.

## Exact release boundary

- migration: `20260805060000_enable_stripe_webhook_event_rls`
- draft SHA-256:
  `29dcf34d4438999469313b22415f221f917c372fb6e880c57276c0e9ee177c2b`
- promoted migration SHA-256:
  `f33fc6c9b65444b437d62856c22116cac56c6a4d8c7b05340117120a06aab66b`
- migration-tree SHA-256:
  `72b5648c4cdc98245dd3b2887a0aab89b264ed860f6141d5a215c2fe34569a13`
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
Runtime `EXECUTE WITH GRANT OPTION` is rejected both by the activation
preflight and class-wide by the global grant audit; the runtime role may call
reviewed functions but may never delegate them.

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
