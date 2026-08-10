# StripeWebhookEvent policyless activation production release

Status: Phase A is live in production. Exact main
`f987645784a447604fcab2399dc8e7fd7bef9d7c`, CI `31408797498`, guarded
migration run `31410550315`, migration status, global grant/RLS audit and the
separate actual pooled-runtime read-only postflight are accepted. Production
has policyless ENABLE with FORCE off, zero policies, zero direct runtime/PUBLIC
table or column authority, and exactly six fixed functions. No app deployment
or Stripe/Vercel provider change accompanied activation.

## Exact release boundary

- migration: `20260805060000_enable_stripe_webhook_event_rls`
- draft SHA-256:
  `af47ed86b90276b0285618b7751c27a15fc52bd0a1a7bcc279c959e05c37e88b`
- promoted migration SHA-256:
  `6e9175b503d77cf899c8d4b9abb882788776e7d104a39bad5f7c4a5de122e033`
- migration-tree SHA-256:
  `fbbaeaf57b32ebd382138685ea972487ed0c52f92fe01ca88421bf2021b9b2c5`
- database-first rollback SHA-256:
  `2174c06aba53726523921ef0938cc92744aed187ea5dfdff3a8ea1e3499b3722`
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
It also counts every runtime-executable overload of the six trusted names, so
a shadow signature cannot survive merely because the canonical signature is
still present.
Every function body is pinned to the MD5 of the exact current `prosrc` derived
from its reviewed preparation migration; signature-compatible body drift aborts
activation before table posture changes. The operator postflight independently
compares SHA-256 digests of those same sources under the actual runtime login.
Runtime `EXECUTE WITH GRANT OPTION` is rejected both by the activation
preflight and class-wide by the global grant audit; the runtime role may call
reviewed functions but may never delegate them.

## Mixed-deployment sequence

This migration must not run until the stacked compatible application changes
have merged, deployed and drained. A pre-activation compatibility postflight
still reads the table directly under the pooled runtime role and now requires
exact per-operation CRUD, zero PUBLIC/column/grant-option drift and exact
source/ACL identity for all six fixed functions, so CI isolates this migration
until all predecessor proofs complete. CI then restores and
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
- the production-postflight catalog and denial path through a new direct
  connection authenticated as the disposable CI runtime role, never owner
  `SET ROLE`;
- SQLSTATE `42501` for direct runtime SELECT, INSERT, UPDATE and DELETE;
- exact six-function catalog and successful begin/fail/reclaim/complete,
  health, prune and legacy-claim calls with zero residue;
- the existing full lease proof again behind activation, including immutable
  type, stale-generation rejection and database-clock reclaim;
- the existing maintenance proof again behind activation, including bounded
  prune, aggregate health and advisory-lock claim race; and
- a database-first rollback that restores predecessor CRUD for old code, then
  always restores the exact activated posture and leaves no fixture row.

The rollback preflight and postflight reject direct PUBLIC table and column
authority as well as runtime authority. The disposable PostgreSQL proof injects
each PUBLIC drift class separately and proves the rollback aborts before any
posture mutation.

After production activation, run
`scripts/stripe-webhook-event-activation-production-postflight.mjs` only from
the exact clean activated main commit with the local pooled production
`grainline_app_runtime` credential. It rejects owner or aliased credentials,
attests the exact endpoint, database, role and repeatable-read/read-only engine
state, verifies exact table/function/source/ACL posture, proves direct SELECT
denial, calls the aggregate health function, and proves the write-capable begin
function reaches SQLSTATE `25006` at the engine read-only fence. Its fresh
mode-0600 evidence contains only sanitized target identity, run bindings and
aggregate proof results. This remains a separate operator step because the
GitHub Production environment holds only the owner migration credential; the
runtime URL must not be added there merely to automate this proof.

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

The earlier Extra-High authority-review checkpoint
`fb0facf146e58123ddd2f4a727fda1b966669d5d` then passed exact-head CI run
`31272188477`. That run accepted the corrected maintenance and activation byte
pins; applied and rolled back the disposable PostgreSQL release; proved direct
runtime SELECT, INSERT, UPDATE and DELETE denial; re-audited the restored
activated posture; passed 2,824 tests with seven intentional skips, TypeScript,
lint, clean production and complete dependency audits, and the production
build. The expected Vercel Preview guard failure is not application-build
evidence and does not authorize a deployment. PR #164 has since been
synchronized through PR #163 exact head
`2c084d470df7805f9c5616044a2c58b7586b2650`, whose CI run `31281007479`
passed. The source pins, PUBLIC rollback checks and production postflight added
after that synchronization passed exact-head CI run `31282060518` at exact
checkpoint `7a57316bcd16daeef5ac9d595180284d1953e316`. That run applied the
activation in disposable PostgreSQL, converged and audited the policyless
posture, opened a new direct connection authenticated as the disposable
runtime role for the production-postflight-equivalent denial/health/read-only
fence proof, re-proved the lease and maintenance contracts, injected both
PUBLIC grant-drift classes into the rollback proof, restored and re-audited
the activation, and passed TypeScript, lint, 2,846 tests with seven intentional
skips, both dependency audits and the production build. This is candidate
evidence only; it did not merge, deploy or change production.

## Accepted pre-merge gates

- Exact candidate `d9b637c6a76196579317de3b189046746ca19916` passed
  exact-head CI `31372665563`, including disposable PostgreSQL activation,
  direct runtime-login proof, rollback/restoration, global grant audit, full
  tests, TypeScript, lint, dependency audits and production build.
- Vercel reports current canonical production deployment
  `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` is `READY`, with source
  `69c14c0618ea7ab9c74756422273d17d66db7efa`; the canonical health endpoint
  returned HTTP 200.
- The hardened historical compatibility postflight passed from the exact
  clean candidate through the actual pooled production runtime role. In an
  engine-attested repeatable-read read-only transaction it confirmed exact
  predecessor CRUD, zero PUBLIC/column/grant-option drift, exact four-private
  plus six-runtime function identity and source, six zero integrity counts,
  direct private-function denial and no production mutation. Sanitized local
  evidence is mode 0600 and is bound to CI `31372665563` plus maintenance
  migration run `31290691183`.

## Remaining gates

1. Keep the database-first compatibility rollback ready through the Phase-A
   observation boundary; investigate and roll back database posture first if
   fixed-operation health regresses.
2. Keep valid Connect v2 signed delivery mandatory on the launch checklist;
   it is not a database-authority prerequisite because every signed route uses
   the same fixed lease wrappers and has zero direct table access.
3. Prepare FORCE as its own later posture-only release after stable activation
   evidence.

No production state or provider variable changes are authorized by this
candidate.
