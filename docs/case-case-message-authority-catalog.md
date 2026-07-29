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
protected references behind `grainline_case_reply`. The Case-message preflight
application conversion then moves the final direct Case lookup from the reply
route and the direct Case lookup from the private-evidence upload route behind
`grainline_case_message_preflight`. The bounded Case-message page application
conversion then moves its direct message read and nested attachment relation
behind `grainline_case_message_page`. The grouped recipient-read application
conversion then moves the staff Case detail lookup, staff active-count query
and three nested Order-to-Case reads behind the fixed recipient projections.
The PIN-gated staff queue conversion then moves its Case count, paginated Case
read and nested message count behind `grainline_case_staff_queue`. At that
checkpoint the exact inventory was 42 remaining references across 16 source
files: 23 direct ORM operations, 8 nested relation references and 11 raw SQL
references. The Case-aware Order conversion then moves three buyer
delivery-confirmation references, two seller-fulfillment references, two
seller-label references and the retention cron's raw Case reference behind
three purpose-bound operations. The current exact inventory is therefore 34
remaining references across 12 source files, with all forty-six removed
references retained in the converted-source ledger. The executable catalog
deep-compares every remaining source and operation count with the live scanner.
A source cannot disappear, appear or claim conversion without changing a test.

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
- recipient reads set transaction-local actor context; ordinary self-owned
  projections may run as `SECURITY INVOKER`, while cross-user/source-bound
  projections use a minimal validated `SECURITY DEFINER` function instead of
  broad runtime table visibility;
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

The machine-readable catalog contains 28 operations.

### Recipient and staff projections

| Operation | Security | Purpose |
|---|---|---|
| `case_get` | INVOKER | One Case by id for a participant or current staff member |
| `case_get_by_order` | INVOKER | One visible Case by exact Order id |
| `case_message_page` | DEFINER | Source-bound, bounded stable `(createdAt,id)` history plus attachment metadata without object keys or User profile fields |
| `case_staff_queue` | DEFINER | Source-validating bounded staff queue, message counts and minimal buyer/seller contact fields |
| `case_staff_active_count` | INVOKER | Staff-only active Case count |
| `case_export` | INVOKER | Complete participant Case/message export plus attachment metadata |
| `case_message_preflight` | DEFINER | Source-bound current authority, messageable status and counterparty availability before upload or reply |

The interactive projection stays bounded. The account export is deliberately
complete and remains a separate projection; it must not inherit the
interactive page limit.

The message preflight, bounded message page and PII-bearing staff queue are
narrow source-validating exceptions to the remaining recipient projections.
The preflight must inspect the counterparty's suspended/deleted state, the
message page must cross the Case/CaseMessage/attachment boundary for both
participants and staff, and the queue must retrieve minimal buyer/seller
contact fields that a later self-only User policy must hide from an ordinary
INVOKER read. Keeping any of these operations `SECURITY INVOKER` would couple
Case administration to broad runtime table visibility and would break as later
User and Case-family RLS narrows direct reads.

All three `SECURITY DEFINER` projections validate the active actor and exact
participant-or-current-staff relationship internally. The message page returns
only stable message fields, durable or relationship-derived author kind, and
attachment id/content type/size/time. It deliberately drops the redundant
per-message author name and exposes no email, Clerk id, User profile field,
DirectUpload id or private object key. A legacy row without durable author kind
is labeled only when its author is the Case buyer or seller; an unknown
non-party legacy author remains `null`/`Participant` rather than being promoted
to staff from mutable current role.

### Narrow reads and predicates

| Operation | Security | Purpose |
|---|---|---|
| `case_attachment_read` | DEFINER | Existing source-validating private-object lookup through attachment → message → Case |
| `case_order_active_buyer` | DEFINER | One active-Case boolean only after deriving the active buyer and exact buyer-owned Order |
| `case_order_active_seller` | DEFINER | One active-Case boolean only after deriving the active seller and complete seller-owned Order graph |
| `case_order_pii_retention_prune` | DEFINER | Fixed 90-day fulfilled-Order PII prune batch whose locked targets and active-Case exclusion are database-derived |
| `case_seller_active_count` | DEFINER | Active unresolved count for the exact SellerProfile metrics path |
| `case_seller_verification_eligibility` | DEFINER | Aged unresolved count only after deriving the seller and verifying self-or-staff authority |
| `case_guild_unresolved_guard` | DEFINER | One aged-unresolved predicate for a seller in the exact guild/reinstatement state |
| `case_account_deletion_blockers` | DEFINER | Active participant Case blocker count only |

These functions do not expose arbitrary Case rows. Their result shapes must be
fixed and minimal. Seller verification, metrics and guild-revocation checks
stay separate: one generic `sellerUserId + optionalCreatedBefore` function
would be an avoidable dispute-quality oracle with more authority than any one
caller needs. The same rule applies to Order guards: no generic
`orderId -> dispute state` runtime oracle exists. The buyer and seller
predicates validate their exact relationship internally. Retention is a fixed
lifecycle write rather than a caller-selected list of Order ids or cutoff.

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

Exact function-only head `67b899c714c5248c1a87df209bb01ca0e29c64b5`
passed full GitHub Actions run `30470489003` (job `90639134941`). That run
engine-applied the complete migration tree to disposable PostgreSQL, converged
production-style grants, passed the runtime-role preflight authority and
zero-residue proof, audited final grants/RLS, and completed TypeScript, lint,
the full test suite, dependency audit and production build. Draft PR #100 was
restored to its intended Case-reply application base afterward. No production
migration or deployment occurred.

The separate preflight application conversion replaces the two remaining direct Case
preflight lookups in the reply and private-evidence upload routes. Both routes
call one typed wrapper, accept either no row or one exact validated result, and
derive the staff-PIN gate, messageable status and recipient availability only
from that result. Missing, malformed and unauthorized Case ids share the
non-enumerating 404 result. The strict validator rejects extra fields,
Case/actor/party drift, inconsistent author/staff identity, invalid recipient
state and a messageable flag that disagrees with the returned lifecycle state.
The reply function remains the locked final authority after external evidence
verification. This moves two references to the converted ledger, leaving 52
current references across 23 files and twenty-eight converted references at
that checkpoint; production and Case-family RLS remain unchanged.

The bounded Case-message page application conversion replaces the final direct
interactive `CaseMessage.findMany` plus its nested attachment relation with one
typed `grainline_case_message_page` wrapper. The buyer, seller and staff pages
pass their already-resolved local actor id; each receives only the fixed
projection and no longer joins mutable User profile fields for message labels.
The strict validator rejects extra fields, more than 51 messages, more than
four attachments per message, duplicate or unstable ordering, invalid author
kinds, overlong bodies, unsupported evidence types, impossible byte sizes and
attachment timestamps without an explicit UTC offset. A null legacy author
kind stays unlabeled. This moves two more references to the durable converted
ledger, leaving 50 current references across 22 files and thirty converted
references. It is an isolated compatible app candidate: production and
Case-family RLS remain unchanged.

The grouped Case recipient-read authority checkpoint adds three compatible
`SECURITY INVOKER` operations:
`grainline_case_get(actorUserId, caseId)`,
`grainline_case_get_by_order(actorUserId, orderId)` and
`grainline_case_staff_active_count(actorUserId)`. Each validates an active
actor, sets transaction-local `app.user_id`, derives participant or current
staff visibility in PostgreSQL, returns no row for missing, disabled or
unauthorized actors, pins `search_path`, denies PUBLIC and grants only its
exact runtime signature. The two Case results expose one fixed lifecycle
projection and deliberately exclude User profile/contact fields, Order
details, payment-source fields, attachment identifiers and the raw Stripe
refund object id. Database UTC `timestamp without time zone` values cross the
SQL boundary as `timestamptz`, preventing local-time reinterpretation.

This checkpoint does not convert an application caller, so the exact inventory
remains 50 references across 22 files with thirty converted references. It
also corrects `case_staff_queue` to a separate source-validating SECURITY
DEFINER design: the queue needs minimal cross-user buyer/seller contact data,
which a later self-only User RLS policy must hide from ordinary INVOKER
queries. The queue is not implemented by this migration and may not be folded
into the PII-free shared Case projection.

The grouped recipient-read application conversion uses those fixed operations
in the buyer and seller Order detail pages, the staff Case and Order detail
pages, and the PIN-gated staff navigation count. Participant pages obtain
counterparty availability from the already-proven
`grainline_case_message_preflight` result instead of joining mutable User
status through Case. Staff Case detail loads Order and minimal party contact
data separately only after `grainline_case_get` proves Case visibility. Raw
Stripe refund object ids no longer cross the shared Case projection or act as
application refund-state flags; the pages use the durable
`REFUND_FULL`/`REFUND_PARTIAL` resolution, while staff can still inspect the
separate payment-event ledger. This moves five references to the converted
ledger, leaving 45 current references across 17 files and thirty-five
converted references. It remains compatible app preparation only: no policy,
RLS posture, table grant, deployment or production data changes.

The PIN-gated staff queue authority checkpoint adds one compatible
`SECURITY DEFINER` projection,
`grainline_case_staff_queue(actorUserId, statusFilter, requestedPage,
pageSize)`. PostgreSQL revalidates an active EMPLOYEE or ADMIN, sets
transaction-local actor context, derives the total count and clamped page from
the same SQL snapshot, and returns at most 50 rows in the existing stable
resolved-last ordering. The result contains only Case and Order ids, reason,
status, message count, an explicit UTC creation timestamp, and the minimal
buyer/seller labels the queue already displays. It excludes User ids, Clerk
ids, avatars, Case narrative, payment/refund fields, evidence identifiers and
private object keys. Empty display names fall back to the stored email exactly
as the prior application query did.

One strict typed wrapper is now the only Case-family access in
`src/app/admin/cases/page.tsx`. It validates the exact result shape,
pagination arithmetic, bounded counts, ids, enums, unique rows, display-field
lengths and UTC timestamps before rendering. The existing
`requireAdminPageAccess` and session-bound staff PIN remain the application
precondition; the database function never accepts a PIN assertion. This moves
three protected references to the converted ledger, leaving 42 current
references across 16 files and thirty-eight converted references. The
compatible migration adds only the function and its exact runtime EXECUTE
grant. It does not enable Case-family RLS, change a table grant, mutate data,
deploy application code or alter production.

The first exact-head CI attempt, run `30484750466` (job `90687499390`), passed
the migration-tree guard, migration application, production-style grant
convergence and every preceding Case authority proof, then failed inside the
new proof's catalog query before exercising the queue. The probe supplied
uppercase string `'PUBLIC'` to `has_function_privilege`; PostgreSQL treated it
as a case-sensitive role name and returned `role "PUBLIC" does not exist`.
The migration and function were not the failure. The probe now uses the
repository's already-proven lowercase `'public'` pseudo-role spelling and a
static regression test rejects the uppercase form. This is retained as failed
evidence rather than erased or mislabeled as a database-authority failure.

The corrected second attempt, run `30484932502` (job `90688109558`), reached
the transaction-local context assertion after the function, grants,
staff/admin equivalence, pagination, filtering and denial checks had passed.
PostgreSQL returned an empty custom-GUC placeholder after commit rather than
`NULL`. This is the documented engine behavior already handled by the
Case-message preflight and page proofs: a locally set custom GUC may read as
either absent or `''` after the transaction ends. The proof now accepts only
those two non-actor states and still fails if any actor id leaks. No function,
grant or application authority was relaxed.

The Case-aware Order authority candidate rejects the earlier generic
`grainline_case_order_active(orderId)` design because it would expose an
arbitrary Order dispute-state oracle to the shared runtime credential. Buyer
delivery confirmation uses
`grainline_case_order_active_for_buyer(actorUserId, orderId)`; fulfillment and
label purchase use
`grainline_case_order_active_for_seller(actorUserId, orderId)`. Both functions
revalidate an active actor, derive the exact buyer-owned or complete
seller-owned Order graph, return `NULL` for missing or unauthorized targets
and expose only one boolean. Each route performs the fixed check both for
specific user feedback and again after taking the Order lifecycle lock. Case
opening follows the same Order-first lock order, so the second check is the
authoritative race boundary.

The predicates do not call `set_config` or otherwise change the caller's
transaction-local RLS context. Actor arguments remain application-resolved
inputs under the general runtime-credential threat boundary documented in the
Case plan, but a predicate call must not introduce an additional context
side effect that a later statement could inherit.

The retention cron no longer selects Case rows or accepts a caller-selected
cutoff/target. `grainline_order_buyer_pii_prune_batch(batchSize)` derives the
90-day cutoff from the PostgreSQL UTC clock, locks only eligible fulfilled
Orders with `FOR UPDATE SKIP LOCKED`, excludes active Cases in that locked
selection and clears only the existing reviewed buyer/fulfillment PII plus
same-Order rate quotes. The caller can choose only a batch size from 1 through
1000; a policy-window change requires reviewed migration SQL. This operation
is a named dependency of the later Order and OrderShippingRateQuote RLS group,
not a claim that those tables are already protected.

This candidate moves eight protected references to the durable ledger, leaving
34 current references across 12 files and forty-six converted references. It
is compatible preparation only: the migration adds three exact functions and
runtime EXECUTE grants, the application can coexist with the prior direct
reads, and production Case-family RLS, table grants and data remain unchanged.

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
  runtime/private grants for all 28 operations;
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
