# OrderPaymentEvent staff Case delivery boundary

Status: compatible application candidate merged through exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739` and live in production deployment
`dpl_73aR913b9hfgkcdfBv2MwMyypR5a` from exact main
`2820986538c0d64f035defce052ba4ad0de1b3fb`. It does not add or replace a
database function, change grants or RLS, or call Stripe from PostgreSQL. Real
staff Case provider/replay proof remains outstanding.

Audited: 2026-08-24 after the evidence-bound refund-reconciliation and
inactive-seller recovery candidates.

## Pre-proof re-audit (2026-08-29)

The separate production-proof review re-read the complete admin page, client
panel, authenticated route, TypeScript result validators, fixed PostgreSQL
prepare/provider/finalize functions, marketplace-refund helper, participant
delivery transaction and existing PostgreSQL proof. The financial and
authority design remains the intended design:

- current `EMPLOYEE` or `ADMIN`, same-session Admin-PIN possession, origin
  rejection and the refund rate limit precede every resolution attempt;
- PostgreSQL derives and locks the Case, Order, single seller, buyer, full
  refund amount, currency, stock plan, payment intent, transfer eligibility,
  claim ID and idempotency scope;
- Stripe stays outside the database transaction, while ambiguous provider
  outcomes enter an administrator-only reconciliation state instead of being
  guessed or retried under a new scope;
- finalization revalidates the exact claim-linked payment evidence and commits
  the Case transition, staff message, stock, audit, participant Notifications
  and versioned email-outbox reservation atomically; and
- full refunds restore eligible unfulfilled in-stock inventory automatically,
  while partial stock restoration remains an explicit staff decision bounded
  by purchased quantities and rejected after fulfillment.

The review did not treat a transfer-reversal ID paired with a null amount as
malformed. Stripe can return an unexpanded string reversal even when the
request asked for expansion, and the shared refund contract intentionally
retains that provider shape. The production acceptance proof is stricter: it
must retrieve the expanded reversal and prove the exact expected amount before
acceptance.

One product-safety defect was found outside the database protocol: the admin
panel previously issued a Full Refund or Dismiss resolution on the first
click. The panel now requires an action-specific confirmation before any
request, including the exact formatted amount for a partial refund. This does
not weaken or replace server authorization.

No broader Case feature redesign is required before this authority proof.
Staff outreach remains the separately planned support-thread system; it must
not be smuggled into the dispute-resolution authority.

## Prepared authenticated acceptance operator (2026-08-29)

The isolated candidate adds
`scripts/order-payment-event-case-refund-production-proof.mjs` and its unit
plus real-PGlite PostgreSQL coverage. Review or merge does not authorize the
operator. A later execution must be bound to one exact main commit, successful
exact-main CI, the currently deployed compatible source/deployment, and the
accepted seller-refund evidence file plus its SHA-256 digest.

The restart-safe journal uses explicit pending stages before account, payment,
fixture, refund and signed-event replay mutations. It creates one private,
vacation-hidden synthetic seller/Listing/Order/Case graph and one disposable
Stripe test-mode Express destination account. The Case and its buyer-authored
opening `CaseMessage` are created atomically. Every pre-existing collision,
partial fixture, provider identity, refund/reversal amount, source-bound
payment row, claim, resolution message, Notification, skipped email, audit,
stock transition and replay identity fails closed.

The proof uses the normal production authentication and Admin-PIN routes. The
raw PIN is accepted only by a nonce-bound `127.0.0.1` form and retained in
memory just long enough to obtain the normal session-bound signed cookie. It
is never logged, written to the restart journal or included in evidence. To
minimize temporary authority, the retained non-customer operational canary
stays `USER` while Stripe/account/fixture work runs. It is promoted to
`EMPLOYEE` only around the PIN verification or Case API call and restored to
`USER` in that operation's `finally` path. `restore-canary` is a separate
restart-safe recovery command that revokes its active sessions and restores
the exact role without discarding the proof journal. If the production
per-user PIN map does not include this canary, the PIN route must fail closed;
the operator must stop rather than changing provider variables inside the
proof.

Cleanup is intentionally exact rather than broad: each marker-bound row is
verified, deleted with an asserted cardinality and rechecked as absent. The
disposable account must have zero balance before deletion. Exactly one
processed `charge.refunded` lease, immutable Stripe test objects, the normal
Admin-PIN security audit and bounded-TTL rate-limit/provider telemetry remain.
The operator does not guess or delete Upstash internal key names. Sanitized
mode-`0600` evidence records hashes and counts only.

The first authorized invocation from exact main
`b53a1c4d8d6cc19a1fabb6144320cd4527e1b37c` / CI `33270465433` failed closed
before creating a restart journal or touching Stripe, Clerk or PostgreSQL. Its
local Git reader returned the current revision as `commit`, while the shared
reviewed-main verifier requires the field name `head`. The correction aligns
that internal interface and adds a regression that executes the real Git
reader, so mocked execution bindings cannot hide the mismatch again. The
failed invocation is not acceptance evidence and does not authorize a broader
retry.

The admin resolution panel also now asks for an action-specific confirmation
before Full Refund, Partial Refund or Dismiss. That client guard is additional
product safety; server, PIN and database authority remain mandatory.

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

This closes the application crash gap and prepares the live proof only. The
operator has not run and is not `OrderPaymentEvent` RLS activation evidence.
It does not replace:

- execution and acceptance of the converted-deployment staff refund provider,
  authenticated-route and replay proof;
- fresh aggregate-only production data classification;
- remaining append-only, taxonomy, currency and source invariants;
- actor-safe participant/staff projections and bounded aggregates;
- predecessor drain, policyless `ENABLE`, pooled-runtime postflight and
  separate `FORCE`.
