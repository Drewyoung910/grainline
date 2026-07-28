# Case and CaseMessage Pre-RLS Audit

Opened 2026-07-26. Status: active read-only behavior and authority audit.
No Case/CaseMessage policy SQL, grant change, migration, provider resource or
production mutation is authorized by this document.
The phased rollout boundary is `docs/rls-case-case-message-plan.md`.

## Why this gate exists

`Case` and `CaseMessage` contain dispute narratives, participant identities,
staff communications, refund evidence and lifecycle state. They are also read
or mutated by payment, shipping, account-lifecycle and seller-quality flows.
RLS must encode the intended dispute product rather than freeze accidental
application behavior.

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

The Phase 1B private-evidence and lifecycle-integrity draft expands the scanner
to `CaseMessageAttachment` and currently records 46 direct operations, 25
nested relation references and 12 raw SQL references: 83 total protected references
across 29 source files. The original 69-reference baseline remains above as
historical evidence; the generated current inventory, not either prose count,
is the activation completeness gate.

The scanner records direct calls, nested relation projections/filters and raw
SQL separately. It does not treat this count as authority approval. Every
reference still needs an actor, purpose and migration destination.

No Case/CaseMessage RLS migration exists in the current tree. Direct runtime
table access is therefore an expected pre-activation gap, not evidence that
the table is ready.

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
- Stripe dispute webhooks may create a new `UNDER_REVIEW` Case or reopen an
  existing non-terminal Case.
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
| CC-A08 | Expected gap | The original audit found 69 direct/relation/raw protected references; the current Phase 1B scanner pins 83 after private evidence and compatible lifecycle work. Participant RLS alone would break context-free cron/webhook/metrics/retention flows, while permissive service policies would recreate broad authority. | Convert all current references to explicit participant, staff, webhook, cron, lifecycle or aggregate destinations. Revoke direct runtime INSERT/UPDATE/DELETE before activation and keep no-context reads denied. |
| CC-A09 | High | The isolated reply route now re-reads the Case and actor role/account state after the Case lock, treats a staff user who is also a party as that party, and derives author kind/status effects from the fresh rows. It does not yet provide a database function boundary against a caller holding the runtime credential, nor a final shared Case/User lock order. | Fixed write functions must derive the author and current authority after the reviewed lock order. Caller input may include user-authored body only; recipient, author kind, status side effects and event identity are database-derived. |
| CC-A10 | Medium | Case is a predicate inside Order label, fulfillment, delivery, PII retention and seller-quality operations. Enabling RLS without converting these hidden relation/raw references would make active Cases invisible to context-free jobs or incorrectly permit an Order transition. | Pin every relation/raw reference in the inventory and replace it with a reviewed participant or fixed service predicate before activation. Keep the Order table's own later RLS release separate. |
| CC-A11 | Accepted launch requirement | Damage/not-as-described disputes have no evidence attachment model even though the Terms say staff review photos. The existing generic Message upload path persists publicly reachable R2 URLs, which is not an acceptable confidentiality boundary for dispute evidence. Adding sensitive evidence after Case RLS would also require another parent-scoped authority and retention rollout. | Include a private-object-backed `CaseMessageAttachment` image model in the tightly coupled Case group before policy SQL. Process and verify images, persist an opaque object key rather than a public URL, retrieve only after Case participant/staff authorization through a short-lived signed path, inherit parent Case visibility, and define export/deletion/retention behavior. PDF evidence remains prohibited until a reviewed malware-scan/quarantine pipeline exists. |
| CC-A12 | Deliberate later product work | The queue has no staff assignment/SLA ownership and the contractual one-time re-review is handled by email, not an in-product appeal state. These do not need broader participant table authority. | Keep them outside initial Case RLS unless the product decision changes. Record the trigger: add assignment/SLA when multiple staff share the queue; add an appeal record only with a reviewed legal/retention workflow. |
| CC-A13 | High/Product | Staff resolution notified/emailed the buyer only. The seller received no Case decision notice even when a staff refund changed seller financial state. The live Notification Case-source function permits staff-resolution recipients only when the recipient is the buyer. | Resolved in the isolated compatible branch without widening that function: create a fixed-copy staff `CaseMessage` atomically with resolution, then use the existing source-validating CaseMessage Notification family to derive the seller, route, copy and replay identity. |
| CC-A14 | High/Audit | Transition audit atomicity was inconsistent. The isolated compatible branch now co-commits strict human audit evidence for Case creation, participant escalation and staff resolution; participant mark-resolved and cron transitions already did so. | Preserve these pairings in fixed database operations and preserve Stripe orphan reconciliation when a refund has already left the database boundary. |
| CC-A15 | High/Concurrency | Review of the first green 14-ordering proof found that three harness paths were stronger than their real routes: participant mark-resolved and bulk cron used post-wait database clocks while the application used pre-wait JavaScript timestamps, and staff resolution was not contended against replies. A waiting mutation could therefore commit a regressed Case timestamp or an older staff resolution message. | Keep participant mark-resolved and staff resolution on the reviewed Order-then-Case lock order, derive transition/audit/message time after the locks from PostgreSQL, make bulk cron use per-row PostgreSQL time, and accept only an exact-head disposable run of the expanded 21-ordering harness. The later fixed-function review still owns the final shared Case/User authority-lock design. |

CC-A11 implementation boundary (2026-07-26): the isolated Phase 1B branch uses
a separate non-public R2 bucket, never the generic public message uploader.
It records opaque keys in `CaseMessageAttachment`, atomically claims verified
upload ownership with the message, retrieves only through a participant/staff
authorization route and includes attachment metadata in interactive history
and account export. The private Cloudflare bucket and application environment
do not exist merely because this code exists; production evidence upload stays
blocked until bucket privacy, least-privilege object access, authenticated
signed read, foreign denial and cleanup are proven.

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
committed with green validation. Case/CaseMessage is ready for policy/authority
SQL only when:

- the 69-reference baseline is pinned by tests;
- every reference has an actor and destination;
- CC-A01 through CC-A10 and CC-A13 through CC-A15 are fixed or have an accepted
  proof-backed design;
- the accepted CC-A11 attachment requirement is implemented and proven;
- legacy-data inspection queries exist and are read-only by default;
- the coverage matrix, architecture and strategy records reflect that
  Conversation/Message is complete and Case/CaseMessage is the active audit;
- no policy/grant SQL is drafted until an Extra-High authority review starts.

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

CC-A05's interactive-read portion and CC-A06's 48-hour query correction merged
to main at `8fcd6949`. Exact-head CI run `30211089240` passed. The Phase 1B
compatible migration adds the exact index and a nullable durable author-kind
column. Nullable is deliberate until the protected aggregate-only inspection
classifies every legacy message; every new application creation path must set
the source-derived kind meanwhile.

## Production compatibility release

PR #58 merged the reviewed Phase 1B compatibility boundary to `main` as
`da4489ace5a592880a325c3e6f90bad7ded8ee37`. Merge-bound general CI run
`30234737824`, Notification FORCE proof run `30234737862` and
Conversation/Message FORCE proof run `30234737831` all passed at that exact
merge commit. PRs #59 through #61 remained draft and were not part of this
release.

Protected Production Migrations run `30235375755` (job `89882085705`) received
an explicit exact-commit approval and passed every source, credential, role,
sealed-tree and prior-RLS release guard. It applied only:

- `20260726183000_prepare_case_message_author_kind`;
- `20260726183500_prepare_case_message_history_index`;
- `20260726183600_drop_legacy_case_message_history_indexes`; and
- `20260726184000_prepare_private_case_message_attachments`.

Prisma then reported all 163 migrations current. The final owner-side catalog
and runtime-grant audit passed for `grainline_app_runtime`: 59 tables, 21
enums, 57 `grainline_*` functions, four RLS policy tables and zero sequence
references. The four compatibility migrations do not enable Case or
CaseMessage RLS and do not create a policy.

The application was deployed separately from a clean detached worktree at the
same merge commit. Vercel production deployment
`dpl_3fknfRH5uMczmdq21xQmcAmc614V` reached `READY`, was promoted to
`thegrainline.com` and records both `meta.gitCommitSha` and
`meta.grainlineReleaseCommit` as the exact merge SHA. The production runtime
database guard verified the pooled `grainline_app_runtime` identity before the
build. `CASE_EVIDENCE_ATTACHMENTS_ENABLED=false` was supplied explicitly to
both build and runtime environments, so the prepared private-evidence feature
remains disabled. `/api/health` returned `200 {"ok":true}` after alias
promotion.

Two unauthenticated fake-id evidence requests returned `401` from Clerk
middleware before reaching the route and therefore are not evidence for or
against the route-local feature gate. A signed-in browser session was not
available for the optional route-level `404 {"error":"Not found."}` smoke.
This limitation does not widen the release: the exact-`true` application gate
and explicit deployment override remain fail closed. A separate authenticated
smoke is still required before any future authorization to set the flag true.
The local aggregate-only database postflight also could not start because the
cleaned workstation no longer had the `pg` client dependency; no production
connection was opened. The protected migration status and catalog/grant audit
above are the accepted database evidence for this compatibility release.

This release prepares integrity and deployment compatibility only. Case and
CaseMessage RLS remain off, DirectUpload preparation/activation remains
unreleased, and private Case evidence must not be enabled until those separate
gates and authenticated participant/staff-versus-foreign-user proof pass.
