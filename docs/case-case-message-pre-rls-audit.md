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
- Case reply creation uses a transaction, status compare-and-swap and a bounded
  duplicate window.
- Cron state changes and participant resolution marks create durable audit
  evidence in the same database transaction.
- Existing indexes cover participant lookup, status/creation queues,
  CaseMessage parent lookup and current `(caseId, createdAt)` ordering.
- Account deletion retains marketplace transaction evidence while redacting
  authored Case text and bounded sensitive values in counterparty text.

## Findings and required disposition

| ID | Severity | Finding | Required before RLS |
|---|---|---|---|
| CC-A01 | High | Foreign keys prove that Case buyer/seller/order ids exist, but not that the buyer owns the Order, that the seller owns every Order item, or that buyer and seller differ. A compromised internal caller can create a structurally valid cross-user Case. | Inspect legacy rows. Make every creation family derive buyer/seller from the locked Order and add a new-row database invariant/trigger for the relationship. Reject self-party Cases. |
| CC-A02 | High | `CaseMessage.authorId` is not constrained to a Case participant or current staff member. The UI also labels historical messages from the author's mutable current `User.role`, so promotion/demotion can relabel old participant or staff speech. | Add durable source-derived author kind (`BUYER`, `SELLER`, `STAFF`, and only if needed `SYSTEM`), inspect/backfill legacy rows, enforce it on insert and render the snapshot rather than current role. |
| CC-A03 | High | Case creation checks Order/refund/case state and later inserts without locking the Order. It can race label purchase, fulfillment, delivery confirmation or a seller/staff refund and leave a combination each route intended to prevent. A foreign-key check does not provide the needed business serialization. | Establish one Order-row lock order shared by Case creation and conflicting Order transitions. Recheck eligibility after the lock and prove both race orderings in PostgreSQL. |
| CC-A04 | High | Reply deduplication serializes only identical `(case, author, body)` attempts. Different concurrent replies can update the same Case with timestamps derived before lock wait, and CaseMessage uses an implicit database timestamp. This can regress inactivity ordering or produce commit/order disagreement. | Lock the exact Case before final authority/state derivation; use one post-lock database timestamp for CaseMessage and Case `updatedAt`; prove different-body, seller-first-reply, pending-close and cron races. |
| CC-A05 | Medium/Scale | Buyer, seller and admin detail pages load the entire CaseMessage history ordered only by `createdAt`. Account export also materializes all participant Cases/messages at once. Long disputes can create unbounded query, render and payload cost, and equal timestamps lack a stable tie-breaker. | Add bounded `(createdAt,id)` keyset history with a `(caseId,createdAt,id)` index. Keep full export rights through bounded pages/streaming rather than truncation. |
| CC-A06 | High/Product | Public and email copy gives the seller 48 hours to respond. The scheduled job does not escalate an `OPEN` Case when `sellerRespondBy` expires; it waits until that deadline is another 14 days old. Parties normally cannot escalate `OPEN` because it has no discussion unlock timestamp. The separate bulk route that uses the deadline is not scheduled. | Choose and document the actual policy. The current public 48-hour contract implies the scheduled transition must use the expired `sellerRespondBy` boundary, with idempotent audit/notification proof. |
| CC-A07 | High | The database has only a non-negative refund check. It does not enforce coherent lifecycle fields: active versus terminal resolution data, resolved timestamps/actor, discussion/unlock timestamps, resolution marks, or refund fields matching resolution type. | Inspect legacy combinations, define the state invariant, repair only classified rows, then add checks/triggers and prove every valid transition plus forged-state rejection. |
| CC-A08 | Expected gap | The runtime still has 69 direct/relation/raw protected references. Participant RLS alone would break context-free cron/webhook/metrics/retention flows, while permissive service policies would recreate broad authority. | Convert all references to explicit participant, staff, webhook, cron, lifecycle or aggregate destinations. Revoke direct runtime INSERT/UPDATE/DELETE before activation and keep no-context reads denied. |
| CC-A09 | High | Reply authorization, account state and staff role are checked before the transaction, not re-derived after locking the Case and relevant users. Role/party/account changes can race the final write. | Fixed write functions must derive the author and current authority after ordered Case/User locks. Caller input may include user-authored body only; recipient, author kind, status side effects and event identity are database-derived. |
| CC-A10 | Medium | Case is a predicate inside Order label, fulfillment, delivery, PII retention and seller-quality operations. Enabling RLS without converting these hidden relation/raw references would make active Cases invisible to context-free jobs or incorrectly permit an Order transition. | Pin every relation/raw reference in the inventory and replace it with a reviewed participant or fixed service predicate before activation. Keep the Order table's own later RLS release separate. |
| CC-A11 | Product decision | Damage/not-as-described disputes have no evidence attachment model even though the Terms say staff review photos. Adding sensitive evidence after Case RLS would require another parent-scoped authority and retention rollout. | Decide before policy SQL whether launch requires Case evidence. If yes, add a first-party-upload-backed `CaseMessageAttachment` to this tightly coupled group. If no, record the email/support evidence path and a concrete trigger for adding it later. |
| CC-A12 | Deliberate later product work | The queue has no staff assignment/SLA ownership and the contractual one-time re-review is handled by email, not an in-product appeal state. These do not need broader participant table authority. | Keep them outside initial Case RLS unless the product decision changes. Record the trigger: add assignment/SLA when multiple staff share the queue; add an appeal record only with a reviewed legal/retention workflow. |
| CC-A13 | High/Product | Staff resolution notifies/emails the buyer only. The seller receives no Case decision notice even when a staff refund changes seller financial state. The live Notification Case-source function also permits staff-resolution recipients only when the recipient is the buyer. | Add source-derived seller decision copy and delivery, with a narrowly reviewed extension to the existing Notification function. Prove both participants receive the correct non-buyer-centric result and no foreign recipient is possible. |
| CC-A14 | High/Audit | Transition audit atomicity is inconsistent. Participant mark-resolved and cron actions write audit evidence in the same transaction, but Case creation writes its user audit after Case commit, staff resolution writes a best-effort admin audit after commit, and participant escalation writes no durable actor event. | Make every authority-changing transition write durable actor/source evidence atomically with the Case mutation. Preserve Stripe orphan reconciliation when a refund has already left the database boundary. |

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
5. Decide evidence attachments explicitly. Do not let their absence become an
   accidental permanent policy shape.
6. Keep staff assignment/SLA and in-product appeals as named, triggered later
   work unless the launch product requirement changes.

## Pre-policy readiness gate

The source audit checkpoint is complete when the inventory and findings are
committed with green validation. Case/CaseMessage is ready for policy/authority
SQL only when:

- the 69-reference baseline is pinned by tests;
- every reference has an actor and destination;
- CC-A01 through CC-A10 and CC-A13 through CC-A14 are fixed or have an accepted
  proof-backed design;
- CC-A11 has an explicit launch decision;
- legacy-data inspection queries exist and are read-only by default;
- the coverage matrix, architecture and strategy records reflect that
  Conversation/Message is complete and Case/CaseMessage is the active audit;
- no policy/grant SQL is drafted until an Extra-High authority review starts.
