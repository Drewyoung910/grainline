# Checkout reservation repair outcome correction

Status, 2026-09-08: reproduced in disposable PostgreSQL and corrected in a
tested SQL draft. The full-schema/runtime-login proof is now implemented in
ordinary CI; exact-head native acceptance is pending. No migration is staged,
no production workflow is wired, and production acceptance remains outstanding.

## Confirmed boundary

`grainline_checkout_reservation_repair_finalize(text,bigint,text)` is the
shared runtime operation used by stale reservation repair. The current
TypeScript caller chooses one of six literal outcomes, but the database did
not reject a SQL NULL for that argument. PostgreSQL three-valued logic let it
skip both the deferred outcomes and the session/outcome consistency check,
then call the stock-restoration helper. A valid repair generation and claimed
reservation were still required. An existing durable Order still prevents
restoration. This is a latent integrity defect under malformed runtime input,
not evidence that normal provider calls have already oversold stock.

The regression reproduces the historical behavior with a session-bound
reservation: NULL restores one unit and makes the listing active. The corrected
function rejects NULL at entry with the existing input-validation error. No
lookup, repair-lease update, stock change, or lock-release result occurs.

## Correction and proof

`scripts/build-checkout-reservation-repair-outcome-correction.mjs` extracts the
exact applied predecessor definition and verifies SHA-256
`d4f9132c3ba2924b5a9d453bfb96a004afed913f474311cc200b6c2cf8077ef5`.
It changes only the missing `p_outcome IS NULL` predicate and emits
`docs/rls-drafts/checkout-reservation-repair-outcome-correction.sql`.
The draft checks the exact original and resulting function bodies, owner,
SECURITY DEFINER/search path, execution ACLs, and retained policyless FORCE
table posture inside one transaction. CREATE OR REPLACE preserves the function
identity and ACLs. It performs no row repair and changes no grants or RLS.

`tests/checkout-reservation-repair-outcome-correction.test.mjs` executes the
original and corrected definitions and the real stock-restoration helper in
PGlite PostgreSQL. It covers:

- NULL and malformed outcomes with and without a bound session, asserting the
  entire reservation and listing state remains unchanged after rejection;
- all six legitimate outcomes, exact retry, stale generation, wrong
  session/outcome pairing, missing reservation and existing paid Order;
- direct runtime table/helper denial after the correction;
- refusal and rollback on function-source, PUBLIC EXECUTE, runtime table-grant,
  or FORCE posture drift.

This focused fixture proves the input boundary and branch compatibility. It
does not replace a complete-schema PostgreSQL 16 release application or an
actual pooled production-role postflight.

## Full-schema and actual-login proof follow-up

`scripts/checkout-repair-outcome-runtime-postgres-proof.mjs` accepts only the
loopback `ci` / `grainline_ci` PostgreSQL 16 service, with strict URL/engine
identity and no connection overrides. It verifies the unchanged full Order
candidate prefix, records the template catalog, refuses an existing
`grainline_checkout_repair_runtime_proof` database, and clones that disposable
template. All fixture writes and committed draft DDL stay in this child.

The production draft pins `neondb_owner`. CI uses owner `ci`: the proof asserts
the exact generated production bytes first, then maps exactly four owner-name
literals in the attestation and removes only the outer transaction wrapper.
The function definition, input guard, expected body hashes, ACL requirements
and FORCE checks are identical. The production draft and historical migrations
are not edited. This role-mapped CI proof is not a production execution artifact.

A distinct `grainline_app_runtime` connection must have matching CURRENT_USER
and SESSION_USER, restricted flags and no inherited membership. The proof
refuses an existing role password before installing a deliberately non-secret
CI password. It first reproduces the old NULL restoration in the child, proves
draft application and rollback, then commits the correction only in the child
and exercises the shared matrix through the real login:

- 20 malformed outcomes across bound/unbound sessions and CRON/ACCOUNT claims
  reject at the input guard with the complete reservation/listing state unchanged;
- all six legitimate outcomes for both claim kinds (12 controls), including
  exact results/restore reasons, stock visibility, deferral diagnostics, stale
  generations and unchanged-state retry;
- wrong session/outcome pairings, unclaimed and missing reservations, and an
  already-paid Order that completes the reservation without restoring stock;
- direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE and private-helper denial, plus
  exact runtime source/owner/search-path, policyless FORCE and column/table
  privilege checks.

Catalog comparisons permit exactly one function-body change and nothing else:
functions/ACLs, relations, columns, policies, roles, defaults, the entire observed
migration ledger, constraints, triggers, indexes, memberships and namespaces are
preserved. Historical fixed source checks run against the unchanged template;
they are not widened to accept the successor. This is a source/behavior proof,
not Stripe response authentication, account-deletion completion or a load test.

On success or failure, close child connections, restore/verify the role password
is NULL, drop only the child this invocation created, verify its absence and
recheck the parent prefix/catalog. Every independent cleanup is attempted;
any failure remains a failure. No forced drop, session termination, preexisting
database removal, provider access or production credentials are allowed. Native
Actions service teardown contains ambiguous creation failures; do not retry or
claim clean recovery of an unacknowledged CREATE.

The local test builds the current Prisma schema offline and imports the actual
reservation normalize trigger, CHECK constraints and partial unique index,
then executes the same scenarios. It reproduced the historical restoration and
passed the corrected matrix. PGlite simulates roles, so it is explicitly not the
real-login/full-migration acceptance. Its first new-harness attempt failed on
multi-statement prepared-query protocol; using PGlite's simple-protocol `exec`
adapter corrected the fixture integration without changing SQL behavior.
Injected first/second-application failures must restore the original catalog;
repeat application must fail closed and preserve the corrected catalog. Cleanup,
identity, target, privilege and catalog-drift tests cover rejected alternatives.

Run focused checks with `node --experimental-strip-types --test
tests/checkout-repair-outcome-runtime-proof.test.mjs
tests/checkout-reservation-repair-outcome-correction.test.mjs`. Full local and
exact-head native CI acceptance remain to be recorded for this follow-up.

Final local verification for the September 8 proof candidate: 24 combined
focused tests passed; the full two-worker suite passed 4,445 tests with 13 skips,
zero failures (4,458 total). Lint, TypeScript, script syntax and whitespace
checks passed. ESLint's dependency emitted its existing TSNonNullExpression
analysis warning; the lint command exited successfully. No native/full-migration
or actual-login acceptance is inferred from the local PGlite result. Exact-head
CI remains the next gate; post-push results are recorded on draft PR #432.

Solo pre-patch and final bypass/regression reviews traced both
`checkoutStockRestore.ts` and `accountDeletion.ts`: neither legitimate caller
supplies NULL, and both use the same six-outcome finalizer. The accepted guard
is unchanged; this pass adds evidence, not new runtime authority. The proof
checks actual constraint enforcement, no-op replay and both claim kinds rather
than relying only on missing-row denials. Provider truth still belongs to the
reviewed application/provider boundary, not an asserted SQL outcome string.

## Remaining release work

Promote this as a separate CheckoutStockReservation integrity release. Before
production execution, give the migration its own immutable byte pin, compose
the existing catalog readers with this one successor, and prove the full
schema, grants, role posture, migration ledger and restart behavior in CI.
The guarded production runner must accept only the exact reviewed before/after
states; the final pooled-runtime read-only check must verify the new body and
unchanged table denial. Do not replay the old activation migration or weaken
historical source pins to accept arbitrary successor bodies.

No compatible app deployment is required by the input change: every legitimate
caller uses an already accepted non-null outcome. A rollback should preserve
the NULL rejection; do not restore the known unsafe body as routine rollback.
Any future incompatible change needs its own reviewed recovery plan.

This correction is a prerequisite for relying on reservation repair during
Order activation. The wider Order suffix and `OrderItem`/shipping-quote
activations remain separately tracked.
