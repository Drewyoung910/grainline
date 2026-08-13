# Case Resolution Window Decision

Status: isolated candidate, not merged, migrated, deployed, or live. The
Case-only guarded production phase is prepared but has not been dispatched.

Decision date: 2026-08-11.

## Decision

Participant resolution marks are asymmetric because the buyer owns the dispute:

| State | Result |
| --- | --- |
| Buyer and seller both mark resolved | Resolve immediately as `DISMISSED`. |
| Buyer marks resolved; seller does not confirm or reply | Remain `PENDING_CLOSE` for seven calendar days, then resolve as `DISMISSED`. |
| Seller marks resolved; buyer does not confirm or reply | Remain `PENDING_CLOSE` until the buyer confirms or either party sends a Case message. Seller silence never dismisses the buyer's Case. |
| Either participant sends a message while pending | Return to `IN_DISCUSSION` and clear both resolution marks. |
| The same participant marks resolved again after that reply | Start a new resolution cycle with a new database-derived audit and Notification source; retries within one active cycle reuse its source. |

Seller-only pending rows remain visible in the existing staff queue. Automatic
staff escalation can be considered later with its own notification and SLA
design; it is deliberately not smuggled into this correction.

## Why

The prior database function auto-dismissed every stale `PENDING_CLOSE` Case
after seven days. Because either participant can create that state, a seller
could mark a dispute resolved and the buyer's silence would eventually dismiss
it. That contradicted the UI statement that both parties must confirm and was
not disclosed in the Terms.

The buyer-initiated timeout is safe because the buyer who owns the Case has
affirmatively said the issue is resolved. The seller-initiated timeout cannot
carry the same authority.

The Extra-High branch review also found that the original participant authority
treated a resolution mark as a permanent one-per-actor event. Its deterministic
`(Case, actor)` audit ID was correct for retries but collided after a Case reply
cleared both marks and the same participant later started a legitimate new
resolution cycle. The correction keeps legacy audit IDs replayable, generates
each new cycle suffix inside PostgreSQL, and reuses the newest fully validated
source while that participant's mark remains active. A participant reply clears
both marks before another cycle; a staff reply may advance the Case timestamp
without clearing the mark, so timestamp equality is deliberately not replay
authority. If the other participant has since completed the Case, the first
actor's older pending source is returned only as an explicit
`historical_replay`: PostgreSQL reports the current terminal state and the route
suppresses a notification that the older source cannot truthfully authorize.
No audit or dedup identity is accepted from the caller.

The seven-day deadline also has a dedicated `resolutionMarkedAt` clock. Using
the general Case `updatedAt` value would let an unrelated staff reply silently
restart the seller's response window. The compatible migration backfills only
from a fully validated, co-committed participant mark audit and fails closed for
an active pending row without that evidence. New participant marks set the
clock atomically; the cron selects and rechecks that immutable active-window
clock. The field is authoritative only while the Case is `PENDING_CLOSE`.
Participant replies clear the active marks and status; the historical clock is
then ignored, and the next participant mark overwrites it atomically. Keeping
it nullable and non-authoritative outside `PENDING_CLOSE` preserves compatible
coexistence with existing staff and refund transitions during deployment.

## Required atomic release surface

- replace only `grainline_case_cron_transition_batch(text, integer)` and
  `grainline_case_mark_resolved(text, text)` in a new migration;
- select and re-check buyer-only resolution marks after acquiring the existing
  User, Order, and Case locks;
- retain exact audit and Notification source binding;
- prove mark, same-cycle retry, reply/reopen, second mark with a distinct source,
  staff follow-up without mark invalidation, and second-cycle retry through the
  pooled runtime role;
- verify the database-derived participant notification remains accurate, and
  align buyer and seller UI, Help pages, Terms, cron metrics, static tests, and
  disposable PostgreSQL proof;
- preserve the Case ENABLE plus FORCE posture and all existing grants.

## Production boundary

This decision record does not authorize a migration or deployment. Before a
production release, require exact-main CI, a disposable PostgreSQL pass proving
buyer expiry plus seller-only exclusion, a migration-tree/grant audit, and the
usual read-only pooled-runtime postflight. The guarded migration runner also
moves the queued StripeWebhookEvent FORCE and CheckoutStockReservation
authority migrations out of its workspace before `prisma migrate deploy`, then
uses an engine-enforced read-only catalog proof to confirm the exact Case
migration checksum, live function body and grants, preserved Case FORCE posture,
and absence of those two queued migration rows.

## CI proof-isolation history

The candidate exposed an important distinction between migration-tree proofs
and live grant audits. Sealed historical proofs need the complete reviewed
successor tree, while the grant audit must see only migrations already applied
to its current disposable database state. The workflow therefore restores
queued successor directories only around their sealed proofs and re-isolates
them before every grant audit or earlier `migrate deploy` boundary.

The following failed CI runs are retained as evidence rather than erased from
the record:

- `31539632706`: the Case successor was still isolated when the Stripe sealed
  prefix verifier needed it;
- `31540047001`: a historical Stripe proof still required an exact old tree
  instead of explicitly accepting the reviewed successor tree;
- `31540557968`: the proof accepted successors, but their directories were not
  present for the full-tree verification;
- `31540984229`: the queued FORCE and checkout directories remained visible to
  a grant audit whose disposable database had not applied them.
- `31563305183`: PostgreSQL rejected the candidate before any proof ran because
  a schema-qualified `substring` call incorrectly used the parser-only
  `substring(value FROM start)` form. The migration now uses the ordinary
  two-argument function form, and the repository-wide PostgreSQL special-form
  guard rejects schema-qualified `substring` calls containing top-level `FROM`
  or `FOR` tokens.
- `31663445190`: every disposable PostgreSQL behavior, concurrency, grant,
  Case activation, and Case FORCE proof passed, but the final read-only catalog
  postflight collapsed function authority and body predicates into one opaque
  zero count. The postflight now proves the exact function authority first and
  then checks named replay/body invariants separately. It also rejects the old
  timestamp-coupled replay predicate directly instead of treating the mere
  presence of `updatedAt` as evidence; that field remains a legitimate Case
  lifecycle field but is not replay authority.

None of these runs changed production. The final invariant is fail-closed in
both directions: complete reviewed tree during sealed proofs, and an applied-
state-matching tree during grant audits and migration execution.
