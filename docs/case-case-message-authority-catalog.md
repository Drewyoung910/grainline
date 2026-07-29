# Case, CaseMessage, and CaseMessageAttachment Authority Catalog

Opened 2026-07-28. Status: Phase 3 design and executable catalog only. This
document and `scripts/case-case-message-authority-catalog.mjs` contain no
policy, grant, trigger, function body or production-migration authorization.
Production RLS remains off for all three tables.

## Fixed boundary

This is one tightly coupled three-table visibility and write-integrity group:

1. `Case` is the participant and lifecycle root.
2. `CaseMessage` inherits participant/staff visibility and valid-author
   authority from its parent Case.
3. `CaseMessageAttachment` inherits visibility from its parent message and
   must bind only to a verified private `DirectUpload`.

The current exact inventory is 80 protected references across 29 source files:
46 direct ORM operations, 22 nested relation references and 12 raw SQL
references. The executable catalog deep-compares every source and operation
count with the live scanner. A source cannot disappear, appear or claim a new
destination without changing a test.

`CaseResolutionClaim` is a supporting private service ledger for the external
Stripe resolution handshake. It has no user-facing read path and is not a
fourth participant-content table. It is created already FORCE-protected with
zero policies and no `PUBLIC` or runtime table privileges; only the fixed Case
resolution functions may use it.

`DirectUpload`, `Order`, `OrderPaymentEvent`, `Notification`,
`AccountDeletionSideEffect`, `AdminAuditLog` and `SystemAuditLog` remain
separate groups or service ledgers. A Case function may validate an exact row
from one of those sources; it may not gain generic table authority or move the
source table into this activation silently.

## Threat model and honest limit

The database boundary must stop accidental or forged direct Case-table access
by the ordinary runtime role:

- no-context and foreign-user reads return no rows;
- direct runtime `INSERT`, `UPDATE` and `DELETE` are absent after activation;
- recipient reads set transaction-local actor context and run as
  `SECURITY INVOKER`;
- exceptional writes use fixed `SECURITY DEFINER` functions with a pinned
  `search_path`, schema-qualified objects, no dynamic SQL and exact EXECUTE
  grants;
- private cores are not executable by `PUBLIC` or the runtime role;
- targets, parties, author kind, transition state, clocks, audit metadata,
  links and replay identity are derived after the reviewed lock order.

The application still authenticates the human. The pooled runtime credential
can supply a syntactically valid local User id, so a fully compromised runtime
can impersonate an application actor within any granted function. Clerk
authentication, server-side actor resolution, request-origin protection, rate
limits, staff re-verification and the staff PIN remain load-bearing. The SQL
must not claim to prove those application facts.

Some validated source tables still have broad runtime DML until their later
group is hardened. Case functions must validate those sources now, and this
catalog names that residual dependency rather than presenting it as protection
against arbitrary runtime compromise.

## Operation catalog

The machine-readable catalog contains 26 operations.

### Recipient and staff projections

| Operation | Security | Purpose |
|---|---|---|
| `case_get` | INVOKER | One Case by id for a participant or current staff member |
| `case_get_by_order` | INVOKER | One visible Case by exact Order id |
| `case_message_page` | INVOKER | Bounded stable `(createdAt,id)` history plus attachment metadata without object keys |
| `case_staff_queue` | INVOKER | Bounded staff queue and message counts |
| `case_staff_active_count` | INVOKER | Staff-only active Case count |
| `case_export` | INVOKER | Complete participant Case/message export plus attachment metadata |
| `case_message_preflight` | INVOKER | Current authority, messageable status and counterparty availability before upload or reply |

The interactive projection stays bounded. The account export is deliberately
complete and remains a separate projection; it must not inherit the
interactive page limit.

### Narrow reads and predicates

| Operation | Security | Purpose |
|---|---|---|
| `case_attachment_read` | DEFINER | Existing source-validating private-object lookup through attachment → message → Case |
| `case_order_active` | DEFINER | One boolean for an exact Order transition/retention guard |
| `case_seller_active_count` | DEFINER | Active unresolved count for the exact SellerProfile metrics path |
| `case_seller_verification_eligibility` | DEFINER | Aged unresolved count only after deriving the seller and verifying self-or-staff authority |
| `case_guild_unresolved_guard` | DEFINER | One aged-unresolved predicate for a seller in the exact guild/reinstatement state |
| `case_account_deletion_blockers` | DEFINER | Active participant Case blocker count only |

These functions do not expose arbitrary Case rows. Their result shapes must be
fixed and minimal. Seller verification, metrics and guild-revocation checks
stay separate: one generic `sellerUserId + optionalCreatedBefore` function
would be an avoidable dispute-quality oracle with more authority than any one
caller needs.

### Participant and staff writes

| Operation | Caller decisions | Database-derived authority |
|---|---|---|
| `case_open` | actor, Order, reason, bounded text | Locked Order, buyer, one distinct seller, eligibility/refund state, Case/message/audit ids, clocks, BUYER author kind and audit metadata |
| `case_reply` | actor, Case, bounded text, bounded upload ids | Fresh participant/staff authority, author kind, status effects, message/attachment/audit ids, replay identity and exclusive private-upload binding |
| `case_mark_resolved` | actor and Case | Participant side, Order/refund conflict, pending-close or mutual dismissal state, clock and audit |
| `case_escalate` | actor and Case | Participant deadline or current staff authority, counterparty state, transition clock and audit |
| `case_staff_resolution_prepare` | staff resolution, bounded refund amount and bounded stock decision | Current staff, Order→Case locks, eligibility, amount cap, resolution claim, refund lease and provider idempotency scope |
| `case_staff_resolution_provider_record` | claim plus explicit bounded Stripe refund/reversal ids and statuses | Same claim actor, locked claim/Order/Case, claim-derived amount/currency/reason, local payment event/audit ids and PROVIDER_RECORDED state |
| `case_staff_resolution_finalize` | actor and resolution claim | Claimed Case/Order/decision, held lease, claim-linked local refund evidence, Case fields, fixed staff message, audit and exact stock targets |
| `case_staff_resolution_reconcile` | admin, unresolved claim, bounded reason and fixed reconciliation action | Current ADMIN, claim/Order/Case, evidence presence, retry scope or audited no-provider-effect lease release |

PostgreSQL can generate UUID text for new Case, CaseMessage, attachment and
audit identities with `pg_catalog.gen_random_uuid()`. Prisma `cuid()` is a
client default, not a database default. Because production has zero rows,
fixed SQL must generate its own opaque identities rather than falsely claiming
that the database derives an omitted Prisma CUID. The application and routes
must continue treating these ids as opaque strings.

User-authored Case text is legitimate caller input. Every function still
enforces its own byte/character bounds and accepted enums; the word
“sanitized” in an application input name is not trusted as proof.

### Provider, refund, cron, and lifecycle writes

| Operation | Source binding |
|---|---|
| `case_stripe_dispute_apply` | Exact durable `OrderPaymentEvent` produced after signed Stripe webhook verification |
| `case_seller_refund_apply` | Exact seller-owned Order plus committed local refund event |
| `case_cron_transition_batch` | Database-selected due rows by a fixed transition family and bounded limit |
| `case_account_deletion_redact` | Exact locked `LOCAL_ANONYMIZE` `AccountDeletionSideEffect`; the deleting User is derived |
| `case_lock_core` | Private exact Case-row lock; never runtime-executable |

The cron operation performs target selection, fresh eligibility checks,
transition and per-row `SystemAuditLog` insertion in one bounded statement. It
uses stable ordering plus `FOR UPDATE SKIP LOCKED`; the caller cannot claim a
Case id or timestamp. It returns bounded audit and recipient metadata for the
already-live source-validating Notification wrappers. The SQL proof must cover
concurrent cron invocations and every cron/reply/resolution winner ordering.

The cron conversion must preserve notification retryability. A committed
transition has a durable audit source; retry logic may replay the same source
through the existing deduplicating Notification wrapper. It must not depend on
an in-memory list that is lost after the transition commits.

## Staff PIN boundary

No database function accepts `staffPinWasVerified`, `authorized` or an
equivalent boolean. PostgreSQL cannot attest a session-bound PIN challenge, so
such an argument would let any caller assert the result.

For non-party staff visibility, evidence reads, reply/escalation and every
staff resolution:

1. the route authenticates the staff user and completes the existing
   session-bound PIN challenge;
2. the database function independently locks/re-reads the User and verifies a
   current, non-banned, non-deleted `EMPLOYEE` or `ADMIN` role;
3. authenticated route smoke proves that the application precondition was not
   removed.

These are two different controls. Neither is described as proof of the other.

## Refund/provider boundary

Staff refund resolution is intentionally staged because the Stripe call cannot
run inside PostgreSQL:

1. `case_staff_resolution_prepare` locks Order then Case, validates the staff
   decision, creates a database-generated `CaseResolutionClaim`, holds the
   exact refund lease when needed and returns a claim-derived Stripe
   idempotency scope.
2. The trusted application calls Stripe with that exact scope.
3. For a refund, `case_staff_resolution_provider_record` accepts explicit
   bounded refund/reversal ids and statuses, re-locks the same claim/Order/Case,
   derives the amount/currency/reason, writes local `OrderPaymentEvent` and
   audit evidence and advances the claim to `PROVIDER_RECORDED`.
4. `case_staff_resolution_finalize` accepts only the actor and claim id, then
   re-locks/revalidates everything. It never accepts a generic
   `providerResult`, Case target, payment-event target, refund amount, stock
   target or resolution choice at finalization.

For a refund, prepare commits the claim as `PROVIDER_PENDING` before returning
the Stripe idempotency scope. The lifecycle is `PROVIDER_PENDING` →
`PROVIDER_RECORDED` → `FINALIZED`, with a fail-closed
`RECONCILIATION_REQUIRED` state for an outcome that cannot be classified. A
non-refund claim uses `LOCAL_READY` → `FINALIZED`. A provider-pending claim is
never automatically expired or released: if the request fails before or during
Stripe, retry uses the exact same idempotency scope and records the eventual
result. An explicit staff reconciliation operation, not elapsed wall time, is
required to release an unresolved claim.

Reconciliation is itself a fixed operation. `RETRY_EXISTING_SCOPE` returns the
same claim-derived idempotency scope and keeps the lease. Only a current
PIN-verified `ADMIN` may choose `CONFIRMED_NO_PROVIDER_EFFECT`; the function
requires no linked local payment evidence, records an immutable audit and then
releases the claim/lease. The admin's provider review is an explicit human
trust boundary, not a fact PostgreSQL claims to prove.

The ledger schema must store only the fixed workflow evidence: claim id, Case,
Order, staff actor, resolution, bounded refund amount, database-derived stock
plan, status, idempotency scope, optional exact payment-event link and
created/provider-recorded/finalized clocks. A partial unique index permits only
one non-final claim per Case and Order. Checks bind refund-only fields to refund
resolutions, prohibit a payment event before `PROVIDER_RECORDED`, and prohibit
finalization without the required evidence. Finalized claims remain with the
Case/Order audit record; there is no generic cleanup lease.

The fixed function proves the local ledger relationship, not Stripe itself.
PostgreSQL does not independently attest Stripe. Signed webhook/client
handling is an external trust boundary.
`Order`/`OrderPaymentEvent` direct-write hardening remains a named dependency
of the later order/payment group. The Case proof must nevertheless reject an
event for another Order, actor, action, amount, currency, resolution claim or
provider object.

## Account deletion boundary

The redaction function does not accept a free `deletingUserId`. It accepts an
exact `AccountDeletionSideEffect` id, locks a `LOCAL_ANONYMIZE` source in the
expected lifecycle state, derives the User, locks the User and derives the
sensitive values and Case/message targets. The existing application
re-verification, Clerk deletion and retry-worker behavior remain external
preconditions.

`AccountDeletionSideEffect` is currently a separately scheduled service-ledger
hardening group. Until that group removes broad runtime DML, the Case record
must state the dependency and must not claim arbitrary-runtime-compromise
resistance from the side-effect row alone.

## Required SQL and proof gates

Before compatible function SQL can be accepted:

- freeze exact signatures, return types, volatility, parallel safety and
  runtime/private grants for all 26 operations;
- define one shared lock order across User, Order, Case, DirectUpload and
  dependent rows;
- define and database-enforce the Case relationship, lifecycle and author-kind
  invariants;
- implement the private `CaseResolutionClaim` lifecycle, recovery fencing and
  zero-policy/zero-table-grant posture;
- make cron notification replay durable and bounded;
- prove every actor/foreign/no-context read, every valid/invalid transition,
  attachment binding, provider-event mismatch, account-deletion source
  mismatch and rollback in disposable PostgreSQL 16;
- prove real lock waits for every documented race pair;
- keep all draft SQL outside `prisma/migrations` until the authority review is
  accepted.

Before production activation, the compatible application must convert all 80
references to catalog destinations and the scanner must reach exactly zero
direct protected access. DirectUpload activation/private-bucket proof must
also complete before Case evidence or the three-table Case boundary is
enabled.
