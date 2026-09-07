# Order label outcome correction

Status, 2026-09-07: tested additive SQL draft only. No applied migration is
edited, no new migration is staged, and no production runner is wired.

## Verified input boundary

Both `grainline_order_seller_label_provider_record` and
`grainline_order_label_clawback_finalize` use `p_outcome NOT IN (...)` without
first rejecting NULL. PostgreSQL's three-valued logic bypasses the guard.
For a valid pending label claim with matching provider evidence, NULL then
falls through to successful label recording, including its audit and shipped
Notification. For an exact clawback claim, NULL takes the failure branch and
changes retry/review state rather than rejecting the malformed input.

This does not remove the actor, claim-generation, amount or provider-evidence
checks. Normal application callers select literal outcomes through
`orderLabelAuthority.ts`, `orderLabelFinalization.ts` and the label route;
no ordinary HTTP request supplying an arbitrary NULL outcome has been proved.
The finding is a database input-domain integrity defect, not evidence of an
unbound provider purchase or a completed production exploit.

## Narrow correction and regression proof

`scripts/build-order-label-outcome-correction.mjs` verifies exact predecessor
definition SHA-256 pins and adds only `p_outcome IS NULL OR` to each guard.
It emits `docs/rls-drafts/order-label-outcome-correction.sql`. The draft checks
both original bodies and function metadata/ACLs before replacing either
function, then checks the resulting bodies and authority. It changes no
signature, ownership, grants, table posture, or legitimate outcome branch.

`tests/order-label-authority-postgres.test.mjs` runs the existing legitimate
label lifecycle suite against both the historical functions and corrected
draft. New PGlite PostgreSQL cases reproduce both historical NULL behaviors,
reject NULL/empty/unknown/case/whitespace variants with unchanged Order,
SystemAuditLog and Notification state, and prove that source or PUBLIC EXECUTE
drift on the second function aborts before replacing the first. Existing
tests retain quote replacement, exact retry, cross-seller denial, amount
binding, private ambiguous-release authority, disabled-seller late success
and audit-collision rollback coverage.

Local verification: the historical/corrected label suites, release contracts
and ambiguous-provider operator tests passed 33/33. The neighboring reservation
repair, authority-composition, review-hold and prefix tests passed 18/18.
Builder syntax, focused lint and whitespace checks passed. Full CI
`34164274285` at `0fbe37fdf90c9fe2275c3d607c6fda7722089dd0` subsequently
passed, including the full suite and production build. It predates the new
rollback-only full-schema input-draft composition harness, whose exact-head
CI acceptance remains pending.

## Remaining release gate

This is not a production operator. Full-schema PostgreSQL 16 application,
complete-candidate catalog composition, exact database/role/ledger scope,
release wiring and the actual pooled-runtime postflight remain required.
The historical 18-migration postflight must remain byte-strict; this successor
belongs in the final candidate's distinct catalog proof. Do not claim the
live label function changed when this draft test passes.

The remaining receipt-notification and refund-reconciliation input-hardening
items stay in `order-core-pre-rls-audit.md`. Reservation repair is separately
tracked in `checkout-reservation-repair-outcome-correction.md`; do not bundle
its live-table acceptance into this draft's test result.
