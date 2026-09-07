# Checkout reservation repair outcome correction

Status, 2026-09-07: reproduced in disposable PostgreSQL and corrected in a
tested SQL draft. No migration is staged, no production workflow is wired, and
production acceptance remains outstanding.

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
