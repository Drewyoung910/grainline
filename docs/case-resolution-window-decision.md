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

## Required atomic release surface

- replace only `grainline_case_cron_transition_batch(text, integer)` in a new
  migration;
- select and re-check buyer-only resolution marks after acquiring the existing
  User, Order, and Case locks;
- retain exact audit and Notification source binding;
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
