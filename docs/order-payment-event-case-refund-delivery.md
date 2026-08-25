# OrderPaymentEvent staff Case delivery boundary

Status: compatible application candidate merged through exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739` and live in production deployment
`dpl_73aR913b9hfgkcdfBv2MwMyypR5a` from exact main
`2820986538c0d64f035defce052ba4ad0de1b3fb`. It does not add or replace a
database function, change grants or RLS, or call Stripe from PostgreSQL. Real
staff Case provider/replay proof remains outstanding.

Audited: 2026-08-24 after the evidence-bound refund-reconciliation and
inactive-seller recovery candidates.

## Finding

The existing staff Case protocol correctly separates the provider request from
the database transaction and already makes the Case, `OrderPaymentEvent`,
stock, resolution message, claim and audit transitions atomic. Participant
delivery remained outside that boundary: the route finalized the database
state, then attempted the buyer Notification, seller Notification and buyer
email in independent best-effort calls.

A process exit after finalization could therefore leave the refund and Case
durable without a durable participant-delivery job. Retrying the route would
not repeat the Stripe refund because the claim is generation-fenced, but
delivery depended on another successful request reaching the post-commit
section. Direct email also lacked the deterministic outbox identity used by
the seller-refund family.

## Compatible correction

`finalizeCaseStaffResolutionWithSideEffects()` now runs these operations in one
Prisma `READ COMMITTED` transaction:

1. invoke the existing source-validating
   `grainline_case_staff_resolution_finalize` function;
2. create the buyer's source-validated `REFUND_ISSUED` or `CASE_RESOLVED`
   Notification from the finalized Case;
3. create the seller's source-validated `CASE_MESSAGE` Notification from the
   database-generated resolution message; and
4. reserve one versioned `case_resolved` EmailOutbox row with deterministic
   key `case-resolution:<claim-id>`.

The route no longer owns notification payloads, recipient lookups or direct
email delivery. PostgreSQL derives Notification title, body, link, actor and
recipient relationship from the locked Case/CaseMessage source. The outbox
email is rendered from the validated finalization result and current buyer
record; preference, account-lifecycle, suppression and quota checks are
repeated by the existing worker before send.

Stripe remains outside this transaction. If local finalization, Notification
creation or outbox reservation fails, all local work rolls back and the same
claim/provider evidence may retry. After commit, the request attempts the exact
outbox job for current UX, while the scheduled worker recovers a process exit
or retryable provider failure without another Stripe refund. Replays dedupe by
the database-derived Case/CaseMessage sources and immutable claim ID.

## Proof and remaining boundary

Focused coverage pins transaction ordering, exact source identities, outbox
deduplication, versioned template selection, route removal of post-finalize
best-effort work, the pre-existing Case authority catalog and Notification
inventory. TypeScript must also accept the Prisma transaction client across
the fixed function, Notification and EmailOutbox helpers.

This closes the application crash gap only. It is not `OrderPaymentEvent` RLS
activation evidence and does not replace:

- disposable PostgreSQL and converted-deployment staff refund replay proof;
- signed Stripe test-mode delivery/retry proof;
- fresh aggregate-only production data classification;
- remaining append-only, taxonomy, currency and source invariants;
- actor-safe participant/staff projections and bounded aggregates;
- predecessor drain, policyless `ENABLE`, pooled-runtime postflight and
  separate `FORCE`.
