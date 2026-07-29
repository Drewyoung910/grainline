# Case, CaseMessage, and CaseMessageAttachment Pre-RLS Audit

Opened 2026-07-26. Status: active read-only behavior and authority audit.
No Case/CaseMessage/CaseMessageAttachment policy SQL, grant change, migration,
provider resource or production mutation is authorized by this document.
The phased rollout boundary is `docs/rls-case-case-message-plan.md`.

## Why this gate exists

`Case`, `CaseMessage` and `CaseMessageAttachment` contain dispute narratives,
participant identities, staff communications, private evidence, refund
evidence and lifecycle state. They are also read or mutated by payment,
shipping, account-lifecycle and seller-quality flows. RLS must encode the
intended dispute product rather than freeze accidental application behavior.

This is one tightly coupled group because CaseMessage visibility and write
validity depend on its parent Case. It remains a separate activation from
Order/payment/shipping even where a fixed operation must validate an Order.

## Current machine baseline

`scripts/case-case-message-rls-inventory.mjs` scans the TypeScript application
surface with the TypeScript AST. The initial baseline is:

- 41 direct Prisma `Case` or `CaseMessage` operations;
- 18 nested relation references through Order, Case, User or SellerProfile;
- 10 raw SQL references;
- 69 total protected references across 25 source files.

The Phase 1B private-evidence and lifecycle-integrity draft expanded the
scanner to `CaseMessageAttachment` and established the Phase 4 conversion
baseline at 46 direct operations, 22 nested relation references and 12 raw SQL
references: 80 total protected references across 29 source files. The first
compatible application conversions replace the Stripe dispute webhook's two
direct Case writes and one nested Case read with
`grainline_case_stripe_dispute_apply`, replace the seller-refund route's Case
read plus guarded update with `grainline_case_seller_refund_apply`, and replace
four staff-resolution writes/reads with its fixed claim protocol. The current
participant conversion also replaces two direct Case reads and one raw Case
update with `grainline_case_mark_resolved`. The buyer Case-open conversion
replaces one direct create, one nested Case read and two nested CaseMessage
references with `grainline_case_open`. The Case-reply conversion replaces a
second Case read, two direct CaseMessage replay reads, one Case update, one
CaseMessage create and five nested attachment references with
`grainline_case_reply`. The countdown is therefore 30 direct operations, 13
nested relation references and 11 raw SQL references: 54 remaining protected
references across 25 source files. The executable catalog retains all
twenty-six removed references in a converted-source ledger; neither the
original 69-reference audit nor the 80-reference Phase 4 baseline is discarded.

The Case-message preflight application conversion then removes the reply
route's final direct Case lookup and the private-evidence upload route's direct
Case lookup. The bounded Case-message page application conversion removes one
direct message read and one nested attachment relation. The grouped recipient
read application conversion removes two more direct operations and three
nested Order-to-Case relations. The PIN-gated staff queue conversion removes
its direct Case count, paginated Case read and nested message-count relation.
The current countdown is therefore 23 direct operations, 8 nested relation
references and 11 raw SQL references: 42 remaining protected references
across 16 source files. The converted-source ledger now retains all
thirty-eight removed references.

The scanner records direct calls, nested relation projections/filters and raw
SQL separately. It does not treat this count as authority approval. Every
reference still needs an actor, purpose and migration destination.

No participant-policy or Case/CaseMessage activation migration exists in the
current tree. Compatible source and fixed-operation migrations do exist on
isolated, unmerged branches. Direct runtime table access is therefore an
expected pre-activation gap, not evidence that the table is ready.

The second compatible fixed-operation candidate is the seller-refund Case
transition. It accepts only the current actor and one exact local
`OrderPaymentEvent`; PostgreSQL derives and locks the Order, seller graph and
Case, verifies the completed Order refund snapshot, derives full/partial Case
resolution fields, and stores replay authority in private
`CaseSellerRefundApplication`. A stale replay cannot resolve a later reopened
Case. The compatible route conversion now locks the seller User before
completing the Order refund, writes and resolves the exact local payment-event
source, invokes the fixed function in the same transaction, and validates the
complete returned Order/seller/buyer/source/disposition relationship. Terminal
Cases retain the prior staff-reconciliation warning. The live scanner records
no protected Case-table reference in the route. Order/payment direct-write
hardening remains deferred to its own sensitive group.

## Phase 2 aggregate classification boundary

The 2026-07-28 Phase 2 candidate inventories the production legacy shape
without selecting any row-level identifier or user-authored content. Its fixed
aggregate schema covers Order/party consistency, lifecycle and resolution
coherence, nullable author-kind classification, historical author
relationships, message timestamp ties and large histories, and private
attachment/DirectUpload/reference binding.

The production operator is manual-main and owner-only because RLS remains off
and the migration credential is the reviewed read-only inspection boundary.
It requires an exact clean dispatched commit, exact production endpoint and
roles, and the protected connection-string digest. PostgreSQL itself attests
that the repeatable-read transaction is read-only. Sanitized evidence contains
counts, fixed enum distributions and target/source hashes only.

A separate loopback-`grainline_ci` PostgreSQL 16 proof executes the exact
aggregate SQL after every committed migration. Static tests alone are not
accepted as SQL/schema proof. Neither the disposable proof nor this saved
production operator classifies the live rows; the protected production
inspection must still run and then stop. No inferred repair, backfill,
constraint, policy or grant is pre-authorized by a predicted zero count.

The first protected production dispatch (`30412359026`, exact main
`7767ae3ae7380ff91a74db0e8a1830f17c8d8b84`) failed before connection because
the client-options call passed the identity summary where its helper requires a
parsed `URL`. PostgreSQL was not queried, no evidence artifact was written and
production was unchanged. Client-option construction is now an exported,
focused-test boundary derived from the previously validated direct URL.

The corrected protected dispatch passed in run `30413133843` (job
`90453636790`) at exact main
`de9ad52ff6c7dfb58a44773ec9e14e44a103f0a4`. It found zero Cases, zero
CaseMessages and zero CaseMessageAttachments; all 50 fixed integrity/blocker
counts and all bounded status/resolution/author-kind distributions were zero.
Consequently there is no legacy cleanup or author-kind backfill to design.
Production posture remained pre-RLS and unchanged. The sanitized mode-0600
off-worktree artifact is
`case-case-message-legacy-inspection-de9ad52ff6c7dfb58a44773ec9e14e44a103f0a4.json`
at SHA-256
`dd4194a39e83e7c4363e9b251d495e66534df3d83c5f3ac2ab521a15dbae8654`.
It contains no ids, user-authored text, participant identities, object keys or
credentials.

## Confirmed product contract

- One Case exists per Order.
- A buyer opens the Case against the seller for that Order.
- The opening description is also the initial buyer CaseMessage.
- Buyer and seller may post while the Case is `OPEN`, `IN_DISCUSSION` or
  `PENDING_CLOSE`.
- The seller's first reply moves `OPEN` to `IN_DISCUSSION` and starts the
  48-hour discussion/escalation clock.
- A party message in `PENDING_CLOSE` reopens discussion and clears both stale
  resolution marks.
- A participant may escalate `IN_DISCUSSION` after the unlock time, or an
  `OPEN`/`IN_DISCUSSION` Case immediately when the counterparty is unavailable.
- PIN-verified employees/admins may read all Cases, post during
  `UNDER_REVIEW`, and resolve a Case.
- Mutual participant resolution records `DISMISSED`; staff resolution may
  dismiss or issue a full/partial Stripe refund.
- Stripe dispute webhooks may create a new source-backed `UNDER_REVIEW` Case
  or reopen an existing Case. A webhook-created Case is not falsely presented
  as a buyer-authored opening message; it records the exact
  `OrderPaymentEvent` source and may have no human-authored messages yet.
- The daily Case job closes stale `PENDING_CLOSE` records and escalates stale
  `OPEN`/`IN_DISCUSSION` records.
- Account export includes participant Cases and messages. Account deletion
  retains transaction records while redacting authored and bounded
  counterparty text.

## Actor and operation inventory

| Actor or subsystem | Reads | Writes | Required database destination |
|---|---|---|---|
| Buyer | Own Order's Case and full CaseMessage history | Open Case, initial message, reply, mark resolved, eligible escalation | Participant projections and fixed source-derived mutations using the server-resolved local user id |
| Seller | Case and messages for an Order wholly owned by the seller | Reply, mark resolved, eligible escalation; seller refund may resolve active Case | Participant projections plus fixed state transitions bound to Order ownership |
| Employee/Admin | Queue, detail, participant/order context and message history after page/PIN checks | Staff reply, escalation, resolution/refund | Staff projections and fixed staff operations that revalidate current role; the application PIN remains an additional boundary |
| Case cron | Due/stale Case ids and participant routing fields | Close/escalate eligible rows and write atomic audit evidence | Bounded fixed batch/record operations; no ordinary context-free table scan or broad DML |
| Stripe webhook | Existing Case for the exact disputed Order | Create/reopen `UNDER_REVIEW` Case atomically with dispute ledger/order state | Webhook-source operation bound to durable OrderPaymentEvent/Order evidence |
| Notification service | Durable Case, CaseMessage or audit evidence | None on Case tables | Existing fixed Notification source validation; no new direct runtime Case grant |
| Account export | Cases where the requester is buyer or seller and their messages | None | Participant export projection with bounded database pages |
| Account deletion | Active-case blocker, retained participant text and authored messages | Redact exact deleting-account content | Fixed lifecycle operation inside the deleting user's locked transaction |
| Order fulfillment/label/delivery | Whether an active Case exists for the exact Order | None on Case | Fixed boolean predicate or compatible participant/service projection |
| Seller refund | Existing Case for exact seller-owned Order | Resolve an active Case after refund evidence commits | Source-bound refund/case transition, preserving orphan/reconciliation behavior |
| Order PII retention | Whether an active Case blocks purge | None | Fixed retention eligibility predicate |
| Guild/verification/metrics | Seller-scoped unresolved Case counts/existence | None on Case | Aggregate-only functions; never dispute narratives or message rows |

## Confirmed strengths

- All public Case mutations require authentication or a verified cron secret.
- Browser mutations use the explicit cross-origin rejection boundary.
- Creation, reply, participant action and refund routes have dedicated rate
  limits; staff resolution and non-party staff replies additionally require
  the admin PIN.
- Application authorization checks buyer/seller participation before ordinary
  reads or writes and checks staff role before privileged behavior.
- Body sizes and text lengths are bounded and sanitized.
- The one-Case-per-Order unique index converts duplicate creation races into a
  conflict instead of duplicate disputes.
- Mark-resolved is one atomic SQL update with the participant predicate and
  active-state guard in the mutation.
- Staff refund resolution has a payment lock, Stripe idempotency keys, stale
  lock recovery, local payment evidence and explicit orphan/ambiguous outcome
  handling.
- Case reply creation locks and re-reads the parent Case, uses one post-lock
  database timestamp for Case/message state, and retains a bounded,
  attachment-aware duplicate window.
- Cron state changes and participant resolution marks create durable audit
  evidence in the same database transaction.
- Existing indexes cover participant lookup, status/creation queues,
  CaseMessage parent lookup and current `(caseId, createdAt)` ordering.
- Account deletion retains marketplace transaction evidence while redacting
  authored Case text and bounded sensitive values in counterparty text.

## Findings and required disposition

| ID | Severity | Finding | Required before RLS |
|---|---|---|---|
| CC-A01 | High | Foreign keys prove that Case buyer/seller/order ids exist, but not that the buyer owns the Order, that the seller owns every Order item, or that buyer and seller differ. The isolated compatible route now derives both parties from the locked Order, verifies every item has the same seller and rejects self-party Cases, but direct database writes are not yet protected. | Inspect legacy rows and add a new-row database invariant/trigger for the relationship before direct runtime Case creation is revoked. |
| CC-A02 | High | `CaseMessage.authorId` is not constrained to a Case participant or current staff member. The UI also labels historical messages from the author's mutable current `User.role`, so promotion/demotion can relabel old participant or staff speech. | Add durable source-derived author kind (`BUYER`, `SELLER`, `STAFF`, and only if needed `SYSTEM`), inspect/backfill legacy rows, enforce it on insert and render the snapshot rather than current role. |
| CC-A03 | High | Case creation previously checked Order/refund/case state and later inserted without locking the Order. The isolated compatible branch now uses one exact Order-row lock protocol for Case creation, label purchase, fulfillment, buyer delivery confirmation and seller-refund reservations, with fresh checks after lock acquisition. | Prove both race orderings in PostgreSQL, retain the protocol in the fixed database operations, and cover any additional conflicting transition found by the final inventory review. |
| CC-A04 | High | Reply deduplication previously serialized only identical `(case, author, body)` attempts. The isolated compatible branch now serializes every reply on the parent Case and shares one post-lock PostgreSQL timestamp across Case/message state. | Prove different-body, seller-first-reply, pending-close and cron race orderings in PostgreSQL, then preserve the same lock/timestamp rule in the fixed write operation. |
| CC-A05 | Medium/Scale | Buyer, seller and admin detail pages load the entire CaseMessage history ordered only by `createdAt`. Account export intentionally includes every participant Case/message as part of a much broader per-account export. Long disputes can create unbounded interactive query, render and payload cost, and equal timestamps lack a stable tie-breaker. | Use bounded `(createdAt,id)` keyset history for interactive pages and add a `(caseId,createdAt,id)` index. Keep account export complete through a dedicated participant projection; do not truncate legal export data. Move the whole-account export to an async streamed artifact if production evidence shows either a 10-second generation time or a 25 MiB uncompressed payload for one account. |
| CC-A06 | High/Product | Public and email copy gives the seller 48 hours to respond. The scheduled job does not escalate an `OPEN` Case when `sellerRespondBy` expires; it waits until that deadline is another 14 days old. Parties normally cannot escalate `OPEN` because it has no discussion unlock timestamp. The separate bulk route that uses the deadline is not scheduled. | Choose and document the actual policy. The current public 48-hour contract implies the scheduled transition must use the expired `sellerRespondBy` boundary, with idempotent audit/notification proof. |
| CC-A07 | High | The database has only a non-negative refund check. It does not enforce coherent lifecycle fields: active versus terminal resolution data, resolved timestamps/actor, discussion/unlock timestamps, resolution marks, or refund fields matching resolution type. | Inspect legacy combinations, define the state invariant, repair only classified rows, then add checks/triggers and prove every valid transition plus forged-state rejection. |
| CC-A08 | Expected gap | The original audit found 69 direct/relation/raw protected references; the current scanner pins 80 after private evidence, compatible lifecycle work, and replacement of three attachment-download relation reads with a fixed source-validating function. Participant RLS alone would break context-free cron/webhook/metrics/retention flows, while permissive service policies would recreate broad authority. | Convert all current references to explicit participant, staff, webhook, cron, lifecycle or aggregate destinations. Revoke direct runtime INSERT/UPDATE/DELETE before activation and keep no-context reads denied. |
| CC-A09 | High | The isolated reply route now re-reads the Case and actor role/account state after the Case lock, treats a staff user who is also a party as that party, and derives author kind/status effects from the fresh rows. It does not yet provide a database function boundary against a caller holding the runtime credential, nor a final shared Case/User lock order. | Fixed write functions must derive the author and current authority after the reviewed lock order. Caller input may include user-authored body only; recipient, author kind, status side effects and event identity are database-derived. |
| CC-A10 | Medium | Case is a predicate inside Order label, fulfillment, delivery, PII retention and seller-quality operations. Enabling RLS without converting these hidden relation/raw references would make active Cases invisible to context-free jobs or incorrectly permit an Order transition. | Pin every relation/raw reference in the inventory and replace it with a reviewed participant or fixed service predicate before activation. Keep the Order table's own later RLS release separate. |
| CC-A11 | Accepted launch requirement | Damage/not-as-described disputes have no evidence attachment model even though the Terms say staff review photos. The existing generic Message upload path persists publicly reachable R2 URLs, which is not an acceptable confidentiality boundary for dispute evidence. Adding sensitive evidence after Case RLS would also require another parent-scoped authority and retention rollout. | Include a private-object-backed `CaseMessageAttachment` image model in the tightly coupled Case group before policy SQL. Process and verify images, persist an opaque object key rather than a public URL, retrieve only after Case participant/staff authorization through a short-lived signed path, inherit parent Case visibility, and define export/deletion/retention behavior. PDF evidence remains prohibited until a reviewed malware-scan/quarantine pipeline exists. |
| CC-A12 | Deliberate later product work | The queue has no staff assignment/SLA ownership and the contractual one-time re-review is handled by email, not an in-product appeal state. These do not need broader participant table authority. | Keep them outside initial Case RLS unless the product decision changes. Record the trigger: add assignment/SLA when multiple staff share the queue; add an appeal record only with a reviewed legal/retention workflow. |
| CC-A13 | High/Product | Staff resolution notified/emailed the buyer only. The seller received no Case decision notice even when a staff refund changed seller financial state. The live Notification Case-source function permits staff-resolution recipients only when the recipient is the buyer. | Resolved in the isolated compatible branch without widening that function: create a fixed-copy staff `CaseMessage` atomically with resolution, then use the existing source-validating CaseMessage Notification family to derive the seller, route, copy and replay identity. |
| CC-A14 | High/Audit | Transition audit atomicity was inconsistent. The isolated compatible branch now co-commits strict human audit evidence for Case creation, participant escalation and staff resolution; participant mark-resolved and cron transitions already did so. | Preserve these pairings in fixed database operations and preserve Stripe orphan reconciliation when a refund has already left the database boundary. |
| CC-A15 | High/Concurrency | Review of the first green 14-ordering proof found that three harness paths were stronger than their real routes: participant mark-resolved and bulk cron used post-wait database clocks while the application used pre-wait JavaScript timestamps, and staff resolution was not contended against replies. A waiting mutation could therefore commit a regressed Case timestamp or an older staff resolution message. | Keep participant mark-resolved and staff resolution on the reviewed Order-then-Case lock order, derive transition/audit/message time after the locks from PostgreSQL, make bulk cron use per-row PostgreSQL time, and accept only an exact-head disposable run of the expanded 21-ordering harness. The later fixed-function review still owns the final shared Case/User authority-lock design. |
| CC-A16 | High/Integrity | `disputeCaseAction()` can reopen any existing Case, including a terminal refund Case. The current webhook clears `resolution`, `resolvedAt` and `resolvedById`, but leaves `refundAmountCents` and `stripeRefundId`, producing an active Case with stale terminal evidence. A newly webhook-created Case also has no initial CaseMessage, although the earlier audit treated every empty Case as corrupt. | The fixed dispute operation must bind to one durable `OrderPaymentEvent`, record it in `Case.openedByPaymentEventId` for a webhook-created Case, and explicitly allow that source-backed Case to begin without a human-authored message. On reopen it clears all five Case-level resolution/refund snapshot fields while retaining the durable Order payment/audit history. Convert the direct webhook before invariant activation. |
| CC-A17 | High/Authority | The first fixed dispute draft treated deterministic `SystemAuditLog` identity as replay authority even though runtime still has broad CRUD on that table, and it did not independently reject a valid but older Stripe event after a newer dispute event had been recorded. | Use a private FORCE/zero-policy/zero-table-grant `CaseStripeDisputeApplication` ledger for immutable replay identity. Keep the audit row as observability only. Validate bounded provider time and reject older sources plus same-time open sources superseded by terminal dispute state before mutating Case. Prove rejection leaves no Case or replay-ledger residue. |
| CC-A18 | High/Recovery | The first staff-resolution app conversion exposed two lease-recovery collisions. Generic 15-minute stale-refund cleanup and `charge.refunded` recovery could reclaim a `pending` Order sentinel even while a durable `CaseResolutionClaim` owned it. The route's friendly prechecks could also reject that claim's own pending, ambiguous or recorded refund state before the fixed prepare function could replay or finalize it. | Treat a non-null `caseResolutionClaimId` as a durable non-expiring lease in both cleanup and webhook state. Let the fixed prepare function validate and replay the exact actor/Case/resolution/stock claim before applying ordinary no-claim refund-conflict heuristics. Pin crash points before Stripe, after Stripe, after provider record and after finalization in the app/static and PostgreSQL proof. |
| CC-A19 | High/Concurrency | Participant mark-resolved fenced `sellerRefundId` but not `Order.caseResolutionClaimId`. A staged staff `DISMISSED` resolution deliberately has no refund sentinel, so the direct participant path could change the Case between staff prepare and finalize. The fixed-function review also found that a nullable retained buyer id could propagate SQL `NULL` into resolution flags, and that a missing audit status could evade a bare `NOT IN` replay check. | The compatible mark-resolved function locks the active actor, Order and Case in the shared order; rejects both refund and every staff-resolution claim lease before a new transition; normalizes nullable participant comparisons to strict booleans; derives the clock, state and deterministic audit inside PostgreSQL; and explicitly null-rejects replay metadata. Disposable PostgreSQL must prove foreign denial, both lease fences, nullable-buyer behavior, malformed-replay denial, serial marks, a real lock wait, rollback and zero residue before app conversion. |
| CC-A20 | High/Integrity | The buyer Case-open route did not require `Order.paidAt`. Its ordinary pending-fulfillment checks usually rejected an unpaid Order, but `reviewNeeded` or an unavailable seller intentionally bypasses those timing checks, leaving a path to open a dispute against an unpaid Order row. | The fixed Case-open operation must lock the Order and require `paidAt` before creating any Case artifact. It must also derive the one seller from a locked complete OrderItem/Listing/SellerProfile graph, reject refund/staff-claim evidence, preserve the reviewed timing exceptions only for paid Orders, and prove unpaid denial plus zero residue in PostgreSQL. |
| CC-A21 | High/Privacy and compatibility | A first shared Case read projection included the raw Stripe refund object id, and the catalog treated the staff queue as INVOKER even though it needs buyer/seller contact fields. The former exceeded participant UI need; the latter would either require broad runtime User visibility or silently break under later self-only User RLS. Timestamp-without-time-zone results also need explicit UTC treatment at the SQL boundary. | Exclude provider ids and all User PII from the shared recipient Case projection; convert its UTC database timestamps to `timestamptz`; keep PII-bearing staff queue work separate as a narrow source-validating SECURITY DEFINER projection with route-side staff PIN enforcement. |

CC-A05 authority correction (2026-07-29): the bounded message page cannot
remain an ordinary INVOKER projection because it must cross exact
Case/CaseMessage/attachment rows for both participants and staff. The
function-only candidate uses a source-validating SECURITY DEFINER projection
with a 51-row maximum and `(createdAt,id)` cursor. It intentionally omits
author profile/contact data and private object identifiers. This closes the
database-authority design portion of CC-A05; the three interactive page
callers still require conversion before the finding is complete.

CC-A21 correction (2026-07-29): the grouped recipient-read authority candidate
now returns only the Case lifecycle fields actually shared by participant and
staff detail surfaces. It omits `stripeRefundId`, User profile/contact fields,
Order detail, payment-event provenance and attachment/object identifiers.
Database UTC timestamps return as `timestamptz`; the typed validator rejects
extra fields, identity/authority drift, malformed enums, invalid dates and
negative or non-integral refund amounts. The separate staff queue is
reclassified to SECURITY DEFINER because its minimal buyer/seller contact
projection must remain available to PIN-verified current staff after self-only
User RLS. This authority-only checkpoint leaves the inventory at 50 current
references across 22 files and does not activate RLS or convert app callers.

CC-A11 implementation boundary (2026-07-26): the isolated Phase 1B branch uses
a separate non-public R2 bucket, never the generic public message uploader.
Its first compatible writer records an opaque key in
`CaseMessageAttachment`; the later DirectUpload preparation temporarily
dual-stores that key with a database-bound `directUploadId` so old and new
deployments can overlap safely. The duplicate key must be proven equal and
dropped after drain, before DirectUpload activation. Upload ownership is
claimed atomically with the message, retrieval remains behind a
participant/staff authorization route, and only attachment metadata enters
interactive history and account export. The private Cloudflare bucket and
application environment do not exist merely because this code exists;
production evidence upload stays blocked until bucket privacy, least-privilege
object access, authenticated signed read, foreign denial and cleanup are
proven.

The final compatible review made the storage boundary fail closed across the
whole lifecycle: a claimed `DirectUpload` cannot be rebound to another source
type/id; public rows require a public URL and private rows prohibit one;
message creation/retry responses strip the private object key; and account
anonymization retains claimed private lifecycle rows because authenticated
evidence reads still depend on them. Unclaimed private uploads remain covered
by retryable lifecycle cleanup. These are compatible application/schema
protections, not provider proof or final RLS authority.

CC-A13 and the staff-resolution portion of CC-A14 (2026-07-26): the isolated
branch co-commits a bounded, fixed-copy `STAFF` CaseMessage and a strict
`AdminAuditLog` with the successful Case resolution. The seller notice uses
that message through the existing live CaseMessage Notification family, so the
database revalidates the staff author, exact parent Case, seller recipient,
canonical sales route and replay identity. No new Notification function or
grant is introduced. The 55/55 callsite gate prevents this added path from
escaping the permanent authority inventory.

CC-A01/CC-A03/CC-A14 compatible boundary (2026-07-26): Case creation now takes
the exact Order row `FOR UPDATE`, re-reads eligibility after the lock, derives
the buyer from the Order, requires every Order item to resolve to one distinct
seller, then co-commits the Case, opening buyer message and strict actor audit.
Label purchase, fulfillment transitions, buyer delivery confirmation and
seller-refund reservation take the same Order lock before their conflict
predicates. Single-Case escalation locks and re-reads the Case, takes a
post-lock timestamp, and co-commits either the participant audit or staff/cron
system audit. These are compatible application protections; disposable
two-session PostgreSQL proof and later database invariant/fixed-function
enforcement remain required before Case RLS.

CC-A04/CC-A09 compatible boundary (2026-07-26): each reply locks the exact Case,
then re-reads the Case parties, status, actor role and actor account state.
Non-party staff authority stays distinct from participant authority, so a
staff account that is itself the buyer or seller cannot use the staff-only
`UNDER_REVIEW` path. After lock acquisition, one database
`clock_timestamp()` supplies Case `updatedAt`, discussion/escalation clocks,
private-upload claim time and CaseMessage `createdAt`. The body/attachment hash
advisory lock remains only the idempotent-retry guard; it is no longer the
general concurrency boundary. If fresh authority would newly classify the
caller as non-party staff, the write also fails unless that request already
completed the session-bound staff PIN check.

PostgreSQL proof scaffold boundary (2026-07-26): the isolated branch has a
loopback- and `grainline_ci`-only PostgreSQL 16 harness. The first accepted run
proved 14 explicit two-session winner orderings, but the later CC-A15 review
showed that its mark-resolved, cron and staff-resolution coverage was not
fidelity-complete. The candidate harness now has 21 orderings, adding
mark-resolved versus refund reservation, mark-resolved versus staff dismissal,
reply versus staff dismissal and an eligible discussion reply versus bulk
cron. Each check must observe the second connection in a PostgreSQL `Lock`
wait; all fixtures are synthetic and deleted in `finally`. Exact code head
`9f4079fe2f6667f14e63943f9a9eee22f350f46b` passed GitHub Actions run
`30217588001` against PostgreSQL 16.14 after the complete 163-migration tree,
production-style runtime grants and final grant/RLS catalog audit. All 21
checks observed a `transactionid` wait; the bounded result reported
`status=passed`, `persistentStagingChanged=false` and
`productionChanged=false`, then the service container and network were
destroyed. This closes the compatible CC-A03/CC-A04/CC-A15 proof checkpoint;
the later invariant and fixed-function gates remain separate.

Because the final authority review changed the compatibility migration bytes,
the current acceptance was rerun rather than inherited. Exact head
`4dc57266c18abf7ee4d4a8a700bcd2a52d0f3185` passed dedicated run
`30218521286` with the full migration tree, production-style grants,
migration/catalog audits and all 21 real-wait winner orderings. General CI run
`30218522907` passed the database guards and proofs, TypeScript, lint, all
2,089 tests, the high-severity dependency audit and production build. No
persistent staging or production database was used or changed.

## Preliminary RLS shape, not approved SQL

- `Case` SELECT should be visible to its current buyer, seller and current
  employee/admin. Ordinary sessions without a transaction-local user id see
  zero rows.
- `CaseMessage` SELECT should be inherited through the visible parent Case.
- Direct runtime INSERT, UPDATE and DELETE should be removed from both tables.
- Participant writes should be fixed operations that derive the Case, party,
  status, author kind and timestamps after locks.
- Staff operations should be fixed and role-validated. RLS cannot prove the
  application PIN, so PIN enforcement remains mandatory in the route/page
  layer and must be covered by authenticated smoke tests.
- Cron, webhook, account lifecycle, refund and aggregate operations should be
  narrow `SECURITY DEFINER` functions with pinned `search_path`, no dynamic
  SQL, runtime-only EXECUTE grants and source-derived targets. They must not
  become a generic Case bypass.
- FORCE is a later ownership-drift hardening release after ENABLE, compatible
  app proof and the actual pooled-runtime postflight. It does not subject the
  BYPASSRLS owner to policies.

## Product decisions before authority SQL

1. Correct the non-response deadline mismatch to the documented 48-hour
   contract unless legal/product copy is intentionally changed first.
2. Treat durable author kind, Order/party integrity, atomic transition evidence
   and reply timestamp locking as pre-RLS invariants.
3. Add bounded CaseMessage history before freezing the recipient read
   projection.
4. Correct seller delivery of staff Case decisions through the already-live
   Notification service boundary.
5. Include private processed-photo CaseMessage evidence in this group. Its
   parent visibility, upload verification, authenticated retrieval, retention,
   export and deletion behavior must be proven before policy SQL. Do not reuse
   public message URLs; add PDF only with a malware-scan/quarantine design.
6. Keep staff assignment/SLA and in-product appeals as named, triggered later
   work unless the launch product requirement changes.

## Pre-policy readiness gate

The source audit checkpoint is complete when the inventory and findings are
committed with green validation. The three-table
Case/CaseMessage/CaseMessageAttachment boundary is ready for reviewed
policy/authority SQL only when:

- the exact 80-reference conversion baseline, 42-reference current countdown
  and thirty-eight-reference converted ledger are pinned by tests (the original 69
  remains historical audit evidence);
- every reference has an actor and destination;
- CC-A01 through CC-A11 and CC-A13 through CC-A20 are fixed or have an accepted
  proof-backed design;
- the accepted CC-A11 attachment requirement is implemented and proven;
- legacy-data inspection queries exist and are read-only by default;
- the coverage matrix, architecture and strategy records reflect that
  Conversation/Message is complete and Case/CaseMessage is the active audit;
- the Extra-High machine-readable authority catalog maps every source to a
  fixed operation and records application/provider trust boundaries before
  policy/grant SQL is drafted.

## Compatibility progress

The Phase 1A bounded-history conversion replaces three unbounded nested
CaseMessage reads with one shared keyset reader. Its current inventory is 42
direct ORM calls, 15 relation references and 10 raw SQL references (67 total
across 26 source files). The original 69-reference checkpoint remains the
conversion ledger; no access path was silently removed.

The reader is correct with the existing `(caseId, createdAt)` index and uses
`id` as a stable tie-breaker. The exact `(caseId, createdAt, id)` index migration
is grouped with Phase 1B's reviewed compatible schema migration so the
protected migration-tree guard is updated once rather than bypassed.

The first Phase 4 application conversion (2026-07-28) removes every direct
Case-table reference from the signed Stripe dispute webhook. After recording
the exact `OrderPaymentEvent`, the route resolves its local row id and passes
only that id to `grainline_case_stripe_dispute_apply`; PostgreSQL derives the
Order, buyer, seller, Case target, transition and replay identity. The route
requires one relationship-consistent `create` or `reopen` result and fails the
transaction closed otherwise. The already-live Notification wrapper continues
to receive the distinct Stripe event id because its reviewed `order_payment`
source contract validates `OrderPaymentEvent.stripeEventId`. The function
migration must deploy before this compatible application; Case RLS remains off
and no production change is authorized by this checkpoint.

The fourth Phase 4 application conversion (2026-07-29) removes every direct
protected reference from the participant mark-resolved route. The browser
route retains the origin, authentication, local-account and rate-limit
boundaries, then invokes only the fixed participant-resolution function. It
accepts exactly one ten-key, identity-consistent result and uses only returned
Case, Order, participant and audit identities for its response and
Notification handoff. Retry notification authority remains the deterministic
audit source, including when an older pending-close event is replayed after the
counterparty has since completed mutual resolution. Direct Case reads, raw
updates, application-side lifecycle locks and application-side audit creation
are absent. This reduces the live conversion countdown to 68 references while
retaining all twelve removed references in the converted ledger. It does not
enable Case-family RLS or authorize production migration, deployment or grant
revocation.

The next Phase 4 authority candidate (2026-07-29) addresses buyer Case opening
before any application conversion. The static audit found CC-A20: the current
route never requires `Order.paidAt`, so its deliberate `reviewNeeded` and
seller-unavailable timing exceptions can admit an unpaid Order row. The
compatible `grainline_case_open(actorUserId, orderId, reason, description)`
function now requires a paid, buyer-owned locked Order; locks the complete
OrderItem/Listing/SellerProfile graph; derives exactly one distinct seller;
and rejects self-party, refund-event, seller-refund, staff-claim, active-label,
too-early and expired-window states. It co-commits one Case, buyer opening
message and strict audit with PostgreSQL-derived ids and UTC time.

Replay authority is not caller-supplied and does not rely on broadly writable
audit data. Private `CaseOpenApplication` binds the exact Order, Case, buyer,
seller, opening message, input reason/description hash and audit. It is born
with ENABLE plus FORCE RLS, zero policies and no runtime or PUBLIC table
grants. A retry succeeds only when the ledger, immutable Case opening fields,
message and exact audit metadata all agree; changed input or a missing/tampered
artifact fails closed. This compatible migration does not enable RLS or change
legacy grants on Case, CaseMessage or CaseMessageAttachment. The
64-reference application countdown is established only by the separate route
conversion below.

The fifth Phase 4 application conversion (2026-07-29) removes the buyer
Case-open route's direct Case create, nested Case read and two nested
CaseMessage references. The route retains origin, authentication,
local-account, user-scoped rate-limit, bounded-body and sanitized-description
boundaries before calling only `grainline_case_open`. A fail-closed validator
requires one exact nine-key result with the requested Order, actor and reason;
distinct database-generated Case/message/audit identities; one different
seller; `OPEN` status; and a reviewed create/replay action. Replay returns the
existing friendly conflict before Notification or email side effects. New
notifications, seller email lookup, observability and the response use
database-returned identities. The countdown is now 64 references across 25
files with sixteen references retained in the converted ledger. Case-family
RLS, direct-grant revocation, merge, production migration and deployment
remain unauthorized.

The next compatible authority candidate (2026-07-29) replaces the reply
route's eventual direct Case/message/attachment write boundary with
`grainline_case_reply`. The fixed operation follows the reviewed actor-User
then Case lock order, derives party/staff status and author kind from locked
rows, and makes the seller-first and pending-close transitions atomic with the
new message. It derives the clock, message/attachment ids, content metadata
and exact 30-second replay identity inside PostgreSQL.

Private evidence ids remain caller references rather than caller authority.
Each is locked and validated against actor ownership, verified private
lifecycle state, accepted endpoint/type/size and the exact Case segment in the
object key. The deferred lifecycle trigger establishes the exclusive
attachment reference before commit. R2 byte/signature verification remains a
route-side external precondition. This closes the fixed-function portion of
CC-A04/CC-A09. Exact-head GitHub Actions run `30440635790` passed at
`ac4f6955db4cbdaaf3785d8de9fd6849546f80a0`, including PostgreSQL 16
migration application, production-style grant convergence, forged-authority,
attachment, replay, transition, two-session lock, rollback and zero-residue
proofs, followed by every repository gate and the production build. Run
`30440456425` is retained as failed evidence: its DirectUpload seed reused an
uncast parameter across `varchar` and `text`, so PostgreSQL rejected the proof
fixture before the fixed function ran. The follow-up pins that fixture status
to `text`; it does not alter the migration. A subsequent proof extension
requires the attachment's lifecycle to be `CLAIMED` after the first message,
accepts the exact same-body/same-upload replay, rejects changed-body reuse of
that claimed upload and proves the Case still has one message. Exact head
`904745864275c3899f91263137400113189d1e95` passed the extended 20-check
PostgreSQL proof and every repository gate in run `30465487551`. The direct
route references remain in the 64-reference countdown until the separate
application conversion succeeds.

The separate compatible Case-reply application conversion then removes ten
of those route references: two direct CaseMessage replay reads, the second
Case read, the Case update, the CaseMessage create and five nested attachment
references. One direct Case preflight remains explicitly assigned to the later
source-bound `case_message_preflight` projection. The route retains origin, Clerk,
local-account, rate-limit, bounded-body, sanitized-text, participant/staff PIN,
recipient-availability and R2 verification boundaries before the fixed write.
It permits VERIFIED or CLAIMED objects only at the external byte/signature
check so an exact retry can be reverified; PostgreSQL still returns the exact
replay before upload freshness validation and rejects changed reuse of a
CLAIMED source. The result validator binds the complete database projection,
replay stops before Notification/email, and post-authority identities come
only from that result. The live countdown is now 54 references across 25 files
with twenty-six retained in the converted ledger. Production and Case-family
RLS remain unchanged.

The Case-reply application and future DirectUpload retirement compatibility
then passed at exact head
`4870908a8ff8df69a05acb52e4a7e2fffdfe91df`: normal CI run
`30467976149` completed the migration/grant/Case proof, all repository tests,
dependency audit and production build, while dedicated PostgreSQL run
`30467974830` engine-executed the changed retirement candidate. Neither run
deployed or mutated production.

The subsequent preflight audit found a future User-RLS dependency before SQL
was sealed. An INVOKER function cannot reliably derive the other party's
suspended/deleted state once a later self-only User policy hides that row; it
would either require an overbroad User SELECT policy or misclassify an existing
counterparty as missing. The corrected operation is therefore a narrow
SECURITY DEFINER source-bound read. It validates an active actor and the exact
Case participant/current-staff relationship internally, returns only fixed
Case/Order/party/status/author/messageable/availability fields, and exposes no
User profile or contact data. Its pinned search path, owner, runtime-only ACL,
PUBLIC denial, forged/no-row behavior, participant-versus-staff lifecycle
split, recipient state, transaction-local context, no-mutation guarantee and
zero-residue cleanup are part of the disposable PostgreSQL proof. Application
conversion remains separate, so the current 54-reference countdown does not
change at this function-only checkpoint.

Exact function-only head `67b899c714c5248c1a87df209bb01ca0e29c64b5`
passed GitHub Actions run `30470489003` (job `90639134941`), including
disposable migration deployment, production-style grant convergence, the
runtime-role Case-message preflight proof, zero-residue cleanup, final grant
audit and all repository gates. Draft PR #100 was restored to its stacked
Case-reply application base. Production remained unchanged.

The separate application conversion uses that fixed result in both routes.
It preserves Clerk/local-account authentication, origin and rate-limit gates,
the non-party staff PIN, bounded/sanitized message input, private-object byte
verification and the final locked reply function. It removes the duplicated
application-derived participant, role, status and counterparty checks, treats a
missing/disabled/unauthorized preflight row as a non-enumerating 404, and
strictly validates every returned field before making external object calls.
The resulting live countdown at the preflight checkpoint was 52 references
across 23 files with twenty-eight retained in the converted ledger. This
remains an isolated application candidate; it does not apply the function
migration, deploy, enable evidence or change Case-family RLS.

The bounded Case-message page app candidate completes CC-A05's interactive
history conversion for the buyer, seller and staff detail pages. One typed
wrapper invokes `grainline_case_message_page`; its validator pins the exact
projection, UTC-aware attachment timestamps, message and attachment bounds,
stable order, uniqueness and durable author-kind vocabulary. The pages no
longer fetch or display mutable per-message User profile names. The live
countdown is now 50 references across 22 files with thirty retained in the
converted ledger. Production and Case-family RLS remain unchanged.

The grouped recipient-read application candidate then removes five more
protected references: staff Case detail, the PIN-gated staff active count and
the buyer, seller and staff Order-to-Case relations. All use the fixed typed
recipient projections; buyer/seller pages obtain counterparty availability
from the existing database-derived message preflight instead of joining User
state through Case. Refund state is derived from the durable Case resolution,
not the omitted raw Stripe refund object id. The live countdown is now 45
references across 17 files with thirty-five retained in the converted ledger.
This remains isolated compatible preparation and does not change production or
Case-family RLS.

The staff queue authority and application candidate then removes the queue's
remaining three protected references. Its narrow
`grainline_case_staff_queue` function is intentionally SECURITY DEFINER
because PIN-verified staff need minimal buyer/seller labels that a later
self-only User policy must hide from ordinary runtime reads. The function
revalidates the current staff role, applies the optional Case-status filter,
derives total count and clamped page from one snapshot, preserves the current
resolved-last stable ordering, and emits no Case narrative, User identifier,
Clerk identifier, payment field or private-object field. UTC timestamps and
blank-name email fallback are database-derived. The typed wrapper rejects
extra fields, inconsistent pagination, duplicate rows, invalid ids/enums,
unbounded counts or display fields, and timestamps without an explicit
offset. The live countdown is now 42 references across 16 files with
thirty-eight retained in the converted ledger. This remains isolated
compatible preparation: production, table grants and Case-family RLS are
unchanged.

CC-A05's interactive-read portion and CC-A06's 48-hour query correction merged
to main at `8fcd6949`. Exact-head CI run `30211089240` passed. The Phase 1B
compatible migration adds the exact index and a nullable durable author-kind
column. Nullable is deliberate until the protected aggregate-only inspection
classifies every legacy message; every new application creation path must set
the source-derived kind meanwhile.

The next audit found that the planned generic
`grainline_case_order_active(orderId)` predicate was broader than any caller
needed. It would let the ordinary runtime credential probe active-dispute
state for an arbitrary Order. The corrected compatible candidate uses separate
buyer and seller predicates. Each validates the active local actor and derives
the exact buyer-owned or complete seller-owned Order before returning one
boolean; missing and unauthorized targets return no authority. Buyer delivery
confirmation, seller fulfillment and label purchase call the predicate once
for specific feedback and again after the existing Order lifecycle lock. The
locked call replaces the relation/raw-SQL Case checks and preserves the
Order-then-Case serialization used by Case opening.
Neither predicate changes `app.user_id`; disposable PostgreSQL must prove a
pre-existing caller context remains byte-for-byte unchanged across the
function call. This avoids adding a context-setting side effect to the fixed
predicate without overstating the broader boundary: the shared runtime role
can already supply application context, so Clerk and route-side actor
resolution remain load-bearing.

The same pass converts the retention cron's raw Case reference without granting
it a generic Case oracle. A fixed SECURITY DEFINER prune batch derives the
90-day cutoff, eligible Order targets, active-Case exclusion, exact PII fields,
rate-quote deletion and UTC purge timestamp inside PostgreSQL. Candidate
Orders are locked with `FOR UPDATE SKIP LOCKED`; callers provide only a bounded
batch size and cannot select Order ids or shorten the retention window. This
is a narrow shared lifecycle boundary that must be re-reviewed when Order and
OrderShippingRateQuote receive their own RLS.

The isolated candidate removes eight protected references: three from buyer
delivery confirmation, two from fulfillment, two from label purchase and one
from retention. The live countdown is now 34 references across 12 files with
forty-six retained in the converted ledger. This is not activation evidence:
disposable PostgreSQL authority, forced-RLS, grant, lock-race, rollback and
zero-residue proofs remain required before the checkpoint is accepted.
Production remains unchanged.

Exact-head CI attempt `30487848128` reached the new proof only after the full
migration tree and all predecessor Case proofs passed, then failed before its
first authority check because the disposable raw-SQL `SellerProfile` fixture
omitted required `updatedAt`. The container was torn down and production was
unchanged. The proof now supplies explicit timestamps for every seeded model
whose Prisma `@updatedAt` field has no database default, with a static
class-wide fixture contract.

The corrected candidate passed exact-head run `30488100064`, job
`90698760535`. Its 13-check PostgreSQL proof covered catalog/grants, forced-RLS
source isolation, authorized and foreign actors, fixed retention/rollback,
both lock races, unchanged caller context and zero residue. The same run
passed all preceding RLS proofs, final runtime grant audit, TypeScript, lint,
the full tests, dependency audit and production build. No production or
persistent staging state changed.
