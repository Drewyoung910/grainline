# Conversation and Message Authority Inventory

Snapshot: 2026-07-22. Status: design baseline on
`codex/rls-conversation-message-20260722`; no Conversation or Message RLS is
active from this work.

## Count contract

`npm run audit:rls-conversation-message-inventory` parses the runtime
TypeScript tree. The audited baseline was 50 direct Prisma operations plus 5
raw SQL references. After the first compatible audit fixes it currently finds:

- 44 direct Prisma Conversation or Message operations;
- 6 raw SQL table references;
- 50 total protected-table access points across 17 files.

The test `tests/conversation-message-rls-inventory.test.mjs` pins the count and
the exact per-file/model/operation summary. A new access path must therefore be
classified here instead of silently inheriting broad runtime authority. The
original 55-path count is the migration baseline, not an activation target: the compatible app
should move protected operations behind reviewed helpers, so the direct count
will intentionally fall as the design is implemented.

## Actor and operation inventory

| Actor or subsystem | Reads | Writes | Required database authority |
|---|---|---|---|
| Participant | Inbox/search, thread metadata, message history, incremental polling/stream, unread count, custom-order context and account export | Start/get conversation, send user text or attachment, archive/unarchive own side, mark received messages read | Participant-scoped recipient RPCs; targets and counterpart derived from the validated conversation |
| Staff reviewer | Full thread only while an active staff account has an unresolved `MESSAGE_THREAD` report for that exact conversation | None | Read-only reported-thread predicate; no general staff or admin bypass |
| Custom-order buyer | Existing participant and request context | Create request message and optionally attach a validated public seller listing | Fixed custom-request operation that validates seller eligibility, block state and listing ownership, then commits conversation/message/thread state atomically |
| Custom-order seller/admin review | Reserved buyer/conversation/listing relationship | Emit one custom-order-ready message and bump/unarchive the thread | Listing-source operation deriving conversation, seller, buyer, kind and payload from the reserved listing |
| Commission seller | Commission buyer and resulting conversation | Create interest, conversation and commission-interest system message atomically | CommissionInterest/CommissionRequest-source operation; no caller-selected recipient, kind or system flag |
| Account export | Sent and received messages for the authenticated account | None | One participant export projection; no foreign thread data |
| Account deletion | Sender attachments and messages to redact; received messages containing the deleting account's sensitive values | Redact the deleting sender's bodies and bounded sensitive values in received bodies | Fixed account-deletion redaction operation bound to the transaction-local deleting user; no ordinary message-edit authority |
| User report validation | Exact message or thread relationship between reporter and reported account | None | Participant-scoped existence checks only |
| Seller metrics and guild cron | Aggregate first-message and response counts for one seller | None on Conversation/Message | Aggregate-only function returning counts, never bodies or thread rows |
| Notification source validation | Durable Message and Conversation evidence for NEW_MESSAGE/custom-order notifications | None on Conversation/Message | Existing owner-backed Notification functions retain their fixed source validation; no new runtime table grant |

## Current access groups

| Files | Current responsibility | Migration destination |
|---|---|---|
| `src/app/messages/page.tsx` | Inbox, search, latest-message projection and unread grouping | One-statement participant inbox RPC |
| `src/app/messages/[id]/page.tsx` | Participant or reported-thread view; user send; first response; thread bump; email throttle; archive state | Thread projection RPC plus fixed send, archive and email-claim operations |
| `src/app/api/messages/[id]/{list,stream,read}/route.ts` | Poll/stream projection and mark-read | Per-call participant/staff revalidation; bounded incremental read and mark-read RPCs |
| `src/app/api/messages/unread-count/route.ts` | Participant unread total excluding blocked/archived threads | One-statement unread RPC |
| `src/app/messages/new/page.tsx` and `src/lib/conversationStartAccess.ts` | Read-only start prompt plus explicit canonical conversation create/get and optional context listing | Implemented compatible operation with rate limit, sorted participant locks, reciprocal block check and pair advisory lock |
| `src/app/api/messages/custom-order-request/route.ts` and `src/lib/customOrderRequestAccess.ts` | Custom-request conversation/message creation | Implemented atomic compatible operation with locked participant/block/seller/listing revalidation; later replace direct protected-table DML with fixed database authority |
| `src/app/api/commission/[id]/interest/route.ts` | CommissionInterest, conversation and system-message transaction | Source-bound commission message operation retained inside the business transaction |
| `src/lib/customOrderReadyLink.ts` and its seller/admin callers | Deduplicated ready-link message | Listing-derived custom-order-ready operation |
| `src/app/dashboard/listings/custom/page.tsx` and buyer order detail | Participant lookup and latest custom request | Bounded participant lookup/request projection helpers |
| `src/app/api/account/export/route.ts` | Sent and received message export | Participant export RPC |
| `src/app/api/users/[id]/report/route.ts` | Message/thread report target validation | Participant existence RPC |
| `src/lib/accountDeletion.ts` | Attachment discovery and message redaction | Participant media projection plus account-deletion-only redaction operation |
| `src/lib/metrics.ts` | Seller response-rate aggregate | Aggregate-only service function |

## Data invariants to inspect before preparation SQL

1. Conversation participants must be distinct and stored in canonical order.
   The unordered unique index prevents a second swapped pair but does not prove
   all legacy rows are canonical or non-self.
2. Every Message sender and recipient must be the two opposing participants in
   its parent Conversation. The current foreign keys do not enforce that
   compound relationship.
3. Ordinary user sends must not choose `recipientId`, structured `kind`, or
   `isSystemMessage`. User-authored body/attachment content is necessarily
   caller input, but write targets and authority metadata must be derived.
4. Structured kinds currently observed are `custom_order_request`,
   `custom_order_link`, and `commission_interest_card`. Commission interest and
   custom-order-ready are server-generated and set `isSystemMessage=true`;
   custom-order request is buyer-authored and remains false. The flag controls
   presentation only and never confers authority. Legacy values must be
   inspected before adding a check or trigger.
5. A send must lock and revalidate participant account state and the sorted
   block pair, then insert, update first-response state, bump the thread and
   clear both archive timestamps in one transaction.
6. Staff visibility must disappear once the exact report is resolved. A live
   stream must re-evaluate that authority on every poll rather than relying on
   its initial HTTP check.
7. One Conversation remains canonical per participant pair. A validated
   optional `Message.contextListingId` records the listing relevant to that
   individual message; it must reference an active listing whose seller is a
   participant, and a private listing must be reserved for the other participant.

## Completion rule

This inventory is complete only when every protected access (55 in the original
baseline, 50 after current compatible refactors) has an explicit
destination, direct runtime INSERT/UPDATE/DELETE is removed, the compatible app
passes before and after RLS, and PostgreSQL proof covers participant isolation,
reported-staff access, structured write families, block/account races, archive
semantics, export/deletion, metrics, rollback and FORCE. Conversation and
Message may activate together because each Message policy depends on its parent
Conversation; they must not be bundled with Notification, Order, payment,
shipping or Case activation.
