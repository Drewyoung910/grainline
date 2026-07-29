# Case, CaseMessage, and CaseMessageAttachment Authority Catalog

Opened 2026-07-28. Status: Phase 4 compatible operation conversion. This
document and `scripts/case-case-message-authority-catalog.mjs` authorize no
production migration, deployment, participant policy, direct-grant revocation
or activation. Production RLS remains off for all three participant tables.

## Fixed boundary

This is one tightly coupled three-table visibility and write-integrity group:

1. `Case` is the participant and lifecycle root.
2. `CaseMessage` inherits participant/staff visibility and valid-author
   authority from its parent Case.
3. `CaseMessageAttachment` inherits visibility from its parent message and
   must bind only to a verified private `DirectUpload`.

The Phase 4 baseline is 80 protected references across 29 source files: 46
direct ORM operations, 22 nested relation references and 12 raw SQL
references. After converting the Stripe dispute webhook, seller-refund route,
staff Case-resolution write path, participant mark-resolved route and buyer
Case-open route, the inventory was 64 remaining references across 25 source
files: 35 direct ORM operations, 18 nested relation references and 11 raw SQL
references. The Case-reply application conversion then moves ten more
protected references behind `grainline_case_reply`. The current exact
inventory is therefore 54 remaining references across 25 source files: 30
direct ORM operations, 13 nested relation references and 11 raw SQL
references. The executable catalog deep-compares every remaining source and
operation count with the live scanner and retains all twenty-six removed
references (three from the Stripe webhook, two from the seller-refund route,
four from staff resolution, three from participant mark-resolved, four from
buyer Case opening and ten from Case reply) in a separate converted-source
ledger. A source cannot disappear, appear or claim conversion without changing
a test.

`CaseResolutionClaim` is a supporting private service ledger for the external
Stripe resolution handshake. `CaseStripeDisputeApplication`,
`CaseSellerRefundApplication` and `CaseOpenApplication` are separate immutable
replay ledgers for, respectively, source-bound dispute create/reopen,
seller-refund Case application and one exact buyer Case opening. None has a
user-facing read path or is a participant-content table. Each is created
FORCE-protected with zero policies and no `PUBLIC` or runtime table privileges;
only its exact fixed Case function may use it.

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
| `case_message_preflight` | DEFINER | Source-bound current authority, messageable status and counterparty availability before upload or reply |

The interactive projection stays bounded. The account export is deliberately
complete and remains a separate projection; it must not inherit the
interactive page limit.

The message preflight is deliberately the narrow exception to the other
recipient projections. It must inspect the counterparty's suspended/deleted
state without making that other User row generally visible. Keeping it
`SECURITY INVOKER` would couple Case messaging to broad runtime `User` reads
and would break when later self-only User RLS hides the counterparty. The
`SECURITY DEFINER` function therefore validates the active actor, exact Case
participant-or-current-staff relationship and fixed output internally; it
returns no row for a missing, disabled or unauthorized actor and exposes no
email, Clerk id, name or other User profile data.

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
| `case_mark_resolved` | actor and Case | Current active participant, Order/refund/staff-claim conflicts, pending-close or mutual dismissal state, UTC clock, deterministic audit and stable replay identity |
| `case_escalate` | actor and Case | Participant deadline or current staff authority, counterparty state, transition clock and audit |
| `case_staff_resolution_prepare` | staff resolution, bounded refund amount and bounded stock decision | Current staff, Order→Case locks, eligibility, amount cap, resolution claim, refund lease and provider idempotency scope |
| `case_staff_resolution_provider_record` | claim, fixed `RECORDED` or `AMBIGUOUS` outcome, and bounded Stripe fields only for `RECORDED` | Same claim actor, locked claim/Order/Case and claim-derived amount/currency/reason; `RECORDED` creates local payment evidence, while `AMBIGUOUS` creates none and freezes the claim for reconciliation |
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
| `case_stripe_dispute_apply` | Exact durable `OrderPaymentEvent` produced after signed Stripe webhook verification; rejects wrong-charge, terminal and superseded sources; a webhook-created Case records that source, while a reopened Case clears stale Case-level resolution/refund snapshots; immutable replay authority is stored in private `CaseStripeDisputeApplication`, while `SystemAuditLog` remains non-authoritative observability |
| `case_seller_refund_apply` | Current seller actor plus exact same-Order local `OrderPaymentEvent` whose id, amount, currency, refund kind and provider id match the locked completed Order refund; derives the active Case transition, terminal/no-Case disposition, immutable `CaseSellerRefundApplication` replay identity and co-committed audit |
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
3. For a refund, `case_staff_resolution_provider_record` accepts one fixed
   provider outcome and re-locks the same claim/Order/Case. `RECORDED` requires
   explicit bounded refund/reversal ids and statuses, derives the
   amount/currency/reason, writes local `OrderPaymentEvent` and audit evidence
   and advances the claim to `PROVIDER_RECORDED`. `AMBIGUOUS` requires every
   asserted provider-evidence field to be absent, writes no payment event and
   advances the claim to `RECONCILIATION_REQUIRED` while retaining the Order
   lease and ambiguous refund sentinel.
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

`AMBIGUOUS` is intentionally not a generic provider-result escape hatch. The
runtime may fail closed into reconciliation, but it cannot use that branch to
assert a refund, transfer reversal or successful Case resolution. Only
`RECORDED` may create payment evidence, and only a claim with that exact linked
evidence may finalize a refund.

Reconciliation is itself a fixed operation. `RETRY_EXISTING_SCOPE` returns the
same claim-derived idempotency scope and keeps the lease. Only a current
PIN-verified `ADMIN` may choose `CONFIRMED_NO_PROVIDER_EFFECT`; the function
requires no linked local payment evidence, records an immutable audit and then
advances the claim to the distinct terminal
`RELEASED_NO_PROVIDER_EFFECT` state before releasing the Order lease. It must
not reuse `FINALIZED`, because no Case resolution or provider effect was
finalized. The admin's provider review is an explicit human trust boundary,
not a fact PostgreSQL claims to prove.

The compatible staff-resolution application candidate replaces four
protected route references with the fixed claim protocol and leaves only two
friendly Case reads plus the final nested message projection on that route.
It validates a nonempty, bounded, duplicate-free Stripe refund set, requires
the primary refund in that set, validates returned claim/Case/Order identities
against the prepared result and uses only database-derived values for the
provider call and post-commit side effects.

A durable Case claim now fences generic stale-refund cleanup and
`charge.refunded` recovery regardless of wall-clock age. Ordinary
seller-refund/ledger/label conflict heuristics run only when the Order has no
active resolution claim; otherwise the fixed prepare function validates exact
claim ownership and replay state. This is required for crash recovery before
Stripe, after Stripe, and after provider recording. It does not grant the
application a reconciliation path: `RECONCILIATION_REQUIRED` remains
fail-closed until a separately audited ADMIN surface invokes the already
reviewed reconciliation operation.

The ledger schema must store only the fixed workflow evidence: claim id, Case,
Order, staff actor, resolution, bounded refund amount, database-derived stock
plan, status, idempotency scope, optional exact payment-event link and
created/provider-recorded/finalized/reconciled clocks. A partial unique index
permits only one claim whose state is neither `FINALIZED` nor
`RELEASED_NO_PROVIDER_EFFECT` per Case and Order. Checks bind refund-only
fields to refund resolutions, prohibit a payment event before
`PROVIDER_RECORDED`, prohibit finalization without the required evidence and
require no local payment evidence for `RELEASED_NO_PROVIDER_EFFECT`. Both
terminal claim kinds remain with the Case/Order audit record; there is no
generic cleanup lease.

The fixed function proves the local ledger relationship, not Stripe itself.
PostgreSQL does not independently attest Stripe. Signed webhook/client
handling is an external trust boundary.
`Order`/`OrderPaymentEvent` direct-write hardening remains a named dependency
of the later order/payment group. The Case proof must nevertheless reject an
event for another Order, actor, action, amount, currency, resolution claim or
provider object.

A Stripe-dispute-created Case is not falsely attributed to the buyer as a
human-authored opening message. It records the exact durable source in a
nullable, unique `Case.openedByPaymentEventId` relationship. Therefore the
normal buyer-open operation still creates its opening message atomically,
while a source-backed webhook Case may begin with no human-authored messages.
Reopening any prior Case clears the Case-level `resolution`, `resolvedAt`,
`resolvedById`, `refundAmountCents` and `stripeRefundId` snapshot before moving
to `UNDER_REVIEW`; the immutable OrderPaymentEvent/AdminAuditLog history is
retained. The current direct webhook clears only the first three fields, so
that path must be converted before invariant activation rather than frozen as
correct behavior.

## Participant resolution authority checkpoint

The isolated Phase 4 successor adds one compatible
`grainline_case_mark_resolved(actorUserId, caseId)` operation. It locks the
current active actor, then the Case's Order and exact Case; re-derives the
participant side; and permits only `OPEN`, `IN_DISCUSSION` or
`PENDING_CLOSE`. PostgreSQL derives the pending-close or mutual-dismissal
transition, post-lock UTC clock, resolver and deterministic strict audit. A retry
reuses the same audit identity so the already-live Notification source retains
one stable event.

The review found CC-A19 before application conversion: a staged staff
`DISMISSED` claim carries `Order.caseResolutionClaimId` without
`sellerRefundId`, so the legacy participant route could mutate the Case
between staff prepare and finalize. The fixed operation rejects either lease
after taking the Order lock. It also normalizes nullable legacy participant
ids to strict booleans and explicitly rejects missing replay status instead of
depending on PostgreSQL `NOT IN` three-valued behavior. The migration retains
all legacy Case table grants and does not enable participant RLS; engine proof,
application conversion, merge, production migration and deployment remain
separate and unauthorized.

The compatible application candidate removes both direct `Case.findUnique`
operations and the raw `Case` update from the participant mark-resolved route.
After the existing origin, Clerk, local-account and rate-limit boundaries, the
route calls only `grainline_case_mark_resolved(actorUserId, caseId)`. A
fail-closed application validator requires one row with the exact ten-key
result, the requested actor/Case, exactly one participant side, the
database-derived deterministic audit id, coherent status/mark state and no
extra keys. The route maps only the reviewed PostgreSQL SQLSTATE families to
bounded client responses; unknown failures retain the normal server-error
path. Notification recipient, event kind and link remain source-derived by the
already-live Notification function from the returned audit identity. The
converted-source ledger retains all three removed references rather than
silently reducing the baseline.

## Buyer Case-open authority checkpoint

The next isolated compatible candidate adds
`grainline_case_open(actorUserId, orderId, reason, description)`. It follows
the shared actor-User then Order lock order, locks the full item/listing/seller
relationship before deriving one seller, and accepts user-authored text only
within the route-compatible trimmed length and byte bounds. Buyer, seller,
target Case, opening message, audit ids, UTC clock and replay identity are
database-derived.

CC-A20 was found during this review rather than frozen into the authority: the
legacy route never checks `Order.paidAt`. Because `reviewNeeded` and
seller-unavailable Orders intentionally bypass the normal pending/future
delivery blocks, an unpaid Order could otherwise become disputable. The fixed
function requires `paidAt`, then independently fences seller refund state,
every staff-resolution claim, blocking refund events, active label purchase,
pending fulfillment, future estimates and the 30-day close boundary. Timing
exceptions remain available only after payment.

`CaseOpenApplication` is an owner-operated immutable replay ledger. Its
composite Case/Order binding plus buyer, seller, opening-message, audit, reason
and description-hash fields prevent a broadly writable audit row or
caller-chosen idempotency token from becoming authority. ENABLE plus FORCE,
zero policies and zero table grants deny runtime inspection or mutation. A
retry validates the Case, message, ledger and exact audit metadata before
returning the original identities. The compatible migration changes no Case
family RLS posture or legacy table grant; application conversion, merge,
production migration and deployment remain separate and unauthorized.

Implementation commit `f7aa25a50191f84b6ec09be3709fe0abad25cc0e`
passed GitHub Actions run `30436133437` against disposable PostgreSQL 16.
The run applied the sealed migration tree, converged production-style runtime
grants, passed the forged-buyer/unpaid/multi-seller/refund/timing/replay
denials, proved the real two-session Order lock wait, rolled the proof back
with zero residue, and passed the final grant/RLS catalog audit. TypeScript,
lint, the full repository suite, the reviewed dependency audit and the
production build also passed. This is engine proof for the isolated draft
authority in PR #96; it is not application conversion, merge, production
migration, deployment or Case RLS activation evidence.

The compatible application successor removes the buyer route's direct Case
create, nested Case existence read and two nested CaseMessage references. The
route retains origin protection, Clerk authentication, local-account
enforcement, user-scoped rate limiting, bounded JSON parsing and text
sanitization before calling only `grainline_case_open`. It validates one exact
nine-key result, stops a strict replay before Notification or email side
effects, and uses only database-returned Case, Order, buyer and seller
identities afterward. The response retains the buyer UI's required Case
identity and state without querying protected tables. This moves four
references into the converted ledger and reduces the activation countdown to
64; it does not authorize merge, production migration, deployment, grant
revocation or Case-family RLS activation.

## Case-reply authority checkpoint

The next isolated compatible candidate adds
`grainline_case_reply(actorUserId, caseId, body, directUploadIds)`. The
function locks the active actor User before the exact parent Case, rederives
party-versus-staff authority with party precedence, fences the current Case
status and participant availability, and derives author kind, Case transition,
UTC time, message/attachment identities and attachment metadata. A seller's
first `OPEN` reply starts discussion and the 48-hour escalation clock; a party
reply to `PENDING_CLOSE` returns the Case to `IN_DISCUSSION` and clears both
resolution marks.

The caller controls only sanitized text and at most four DirectUpload
identities. Each attachment must be the actor's verified private
`caseEvidenceImage`, must be scoped by object key to the locked Case, and must
derive content type, byte size and object key from the lifecycle row. The
existing deferred reference trigger then establishes the exclusive
`CASE_MESSAGE_ATTACHMENT` claim atomically with the message. R2 object
existence and signature verification remain an explicit application/provider
precondition because PostgreSQL cannot inspect the object store.

Replay identity is database-derived from the locked Case, actor, exact body
and sorted upload set. An advisory transaction lock serializes identical
requests, while the parent Case lock serializes every differing reply and
lifecycle transition. A retry within 30 seconds returns the original message
only when the body and complete attachment set match; no recipient, author
kind, transition, dedup token, timestamp, content metadata or generated id is
caller-supplied.

This migration is functions-only and coexistence-safe. It changes no
Case-family RLS posture or legacy table grant. The application reply route,
notifications/email behavior, merge, production migration, deployment,
direct-grant revocation and Case-family activation remain separate and
unauthorized until the subsequent route conversion passes independently.

The authority boundary passed exact-head GitHub Actions at
`ac4f6955db4cbdaaf3785d8de9fd6849546f80a0` in run `30440635790`.
PostgreSQL 16 applied the sealed migration tree, converged the production-style
runtime grants, passed the Case-reply authority and two-session lock proof, and
then passed the broader grant/RLS proofs, TypeScript, lint, complete repository
suite, reviewed dependency audit and production build. The preceding run
`30440456425` failed before exercising the authority function because its
DirectUpload proof fixture reused one uncast parameter as both `varchar` and
`text`; follow-up `ac4f6955` pins the fixture value as `text` and removes an
out-of-transaction `SET CONSTRAINTS` warning. The failed run changed no
persistent environment and is retained as diagnostic evidence rather than
discarded. Before application conversion, the proof was extended to preserve
the attachment-retry boundary explicitly: the first request claims the private
upload, an exact same-body/same-upload retry returns the original message, and
the same now-claimed upload with changed body fails without creating a second
message. The extended 20-check proof and every repository gate passed at exact
head `904745864275c3899f91263137400113189d1e95` in GitHub Actions run
`30465487551`.

The compatible application successor retains one direct Case preflight read
for the later source-bound `case_message_preflight` conversion, but removes both
direct CaseMessage replay reads, the Case update, the CaseMessage create and
all five nested attachment references. It verifies R2 existence, size, type
and signature before calling only `grainline_case_reply`; VERIFIED and CLAIMED
objects may reach that external check so exact retries can be re-verified, but
the fixed database function alone decides exact replay and rejects changed
reuse. One strict result validator binds the returned actor, parties, Case,
Order, status, author kind, timestamp and attachment metadata. A replay returns
before Notification or email, and every security-relevant identity used after
the function comes from the database result. This moves ten references to the
converted ledger and leaves 54 current references; production and Case-family
RLS remain unchanged.

The conversion also closes a future compatibility trap in the disposable
DirectUpload `objectKey` retirement candidate. Before retirement the authority
function dual-writes the compatibility column. The retirement candidate now
rebuilds that exact fixed function without `objectKey` in the same transaction
that drops the column, preserves its EXECUTE ACL, and postflights its owner,
security mode, pinned search path, runtime-only grant and function definition.
That keeps Case replies operable after the separately gated retirement rather
than deferring a known post-retirement failure.

Exact application-conversion head
`4870908a8ff8df69a05acb52e4a7e2fffdfe91df` passed the complete GitHub
Actions gate in run `30467976149`. The same head passed dedicated DirectUpload
Authority PostgreSQL Proof run `30467974830`, which generated and
engine-executed the changed compatibility-key retirement candidate instead of
relying on static source checks. Draft PR #99 was then restored to its intended
Case-reply-authority base. Vercel's draft-branch deploy refusal is expected;
this evidence includes no deployment, migration apply or production change.

The next compatible operation is
`grainline_case_message_preflight(actorUserId, caseId)`. It returns exactly
one fixed Case/Order/party/status/author/preflight shape only when the active
actor is that Case's buyer, seller or a current employee/admin. Missing,
disabled and unauthorized actors receive no row. PostgreSQL derives party
precedence, messageable participant/staff status and the counterparty's
missing/deleted/suspended state; no caller supplies role, author kind, status,
recipient or availability.

The initial INVOKER design was rejected during hard review. It would need broad
runtime reads of the counterparty's User row and would silently break when a
later self-only User RLS policy hides that row. The accepted narrow DEFINER
shape validates the source relationship internally, exposes no name, email,
Clerk id or profile field, pins `search_path = pg_catalog`, rejects PUBLIC
execution and grants only the exact runtime signature. The route-side Clerk
identity, active local account and session-bound staff PIN remain explicit
application trust boundaries. The final `grainline_case_reply` operation still
locks and revalidates the write, so the preflight never becomes race authority.

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
- keep Stripe-dispute replay identity in private
  `CaseStripeDisputeApplication`, never in broadly writable
  `SystemAuditLog`, and reject valid-but-superseded provider events;
- keep seller-refund replay identity in private
  `CaseSellerRefundApplication`; derive the Case target, resolution, amount,
  provider id and audit from one locked local refund source rather than
  accepting any of them from the caller;
- make cron notification replay durable and bounded;
- prove every actor/foreign/no-context read, every valid/invalid transition,
  attachment binding, provider-event mismatch, account-deletion source
  mismatch and rollback in disposable PostgreSQL 16;
- prove real lock waits for every documented race pair;
- keep invariant/activation SQL outside `prisma/migrations` until its
  authority review is accepted; compatible operation migrations remain
  unmerged and unapplied until their own exact SQL and engine proof passes.

Before production activation, the compatible application must convert all 80
references to catalog destinations and the scanner must reach exactly zero
direct protected access. DirectUpload activation/private-bucket proof must
also complete before Case evidence or the three-table Case boundary is
enabled.
