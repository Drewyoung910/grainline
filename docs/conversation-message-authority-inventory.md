# Conversation and Message Authority Inventory

Snapshot: 2026-07-25. Status: functions-only database authority is live. The
application-path conversion candidate has removed every direct protected-table
access and is not yet deployed; no Conversation or Message RLS is active from
this work.

## Count contract

`npm run audit:rls-conversation-message-inventory` parses the runtime
TypeScript tree. The audited baseline was 50 direct Prisma operations plus 5
raw SQL references. After the compatible audit fixes and eleven authority
conversion checkpoints it currently finds:

- 0 direct Prisma Conversation or Message operations;
- 0 raw SQL table references;
- 0 remaining direct protected-table access points.

The first application conversion checkpoint removed all seven direct
Conversation/Message operations from list polling, stream polling, mark-read
and unread-count routes. Those routes now call the exact
`grainline_conversation_get`, `grainline_message_list`,
`grainline_message_mark_read` and `grainline_message_unread_count` functions
through `src/lib/conversationMessageAuthority.ts`. The list route retains the
reported-staff exception; stream and mark-read explicitly remain
participant-only.

The second checkpoint removed both direct account-export Message queries and
both report-target Message/Conversation counts. Account export now loads one
actor-scoped projection and preserves the separate sent/received payload
collections in application code. Message and thread reports use one boolean
participant-relationship function.

The third checkpoint converted the two custom-listing Conversation checks, its
latest custom-request lookup, and the buyer-order participant-pair lookup.
Custom listing creation and rendering explicitly require the seller to be a
participant even though reported staff have a separate read-only review
exception elsewhere.

The fourth checkpoint converted the read-only new-message pair lookup and the
explicit start action. The page remains read-only until the user submits; the
submit now invokes the fixed database function that derives canonical order,
locks users, checks reciprocal blocks, validates optional listing context and
creates or reuses the conversation atomically.

The fifth checkpoint converted custom-order request and commission-interest
writes. Each app helper now invokes one installed, fixed-purpose database
function. The database derives the participants, source relationship, message
kind, system flag, payload fields and thread side effects while holding the
reviewed source locks. Commission interest creation, its durable source row,
opening message and interested-count update remain one statement and one
transaction. Removing the last consumers also removed the obsolete app-side
conversation get/create helper rather than retaining dead migration
scaffolding.

The sixth checkpoint converted custom-order-ready. The app still accepts only
the durable Listing id, resolves the seller identity without reading
Conversation or Message, then invokes the fixed source-bound function. That
function revalidates the private reservation, seller eligibility, participant
pair, exact conversation and full existing-message evidence under the
listing-scoped replay lock. A replay cannot create another message; it can
idempotently heal a post-commit Notification failure without resending email.

The seventh checkpoint converted seller response metrics. The larger metrics
transaction now calls one aggregate-only function for the seller and bounded
period; Conversation and Message rows or bodies never cross the function
boundary. The typed wrapper rejects malformed, negative, unsafe or logically
impossible counts before calculating the cached response rate.

The eighth checkpoint converted account deletion. Attachment discovery still
runs before any body redaction, but now projects only the deleting actor's sent
message bodies through the participant export function. The deletion
transaction then calls one fixed account-deletion function while holding the
existing User lifecycle lock. PostgreSQL derives the sensitive values, redacts
all sender bodies and redacts matching values in received bodies; the app has
no direct Message scan or update. Invalid result counts and database authority
errors fail the whole deletion transaction instead of permitting partial
privacy cleanup.

The ninth checkpoint converted the inbox. One participant-scoped statement now
applies archive state, reciprocal blocks, non-empty-thread visibility, bounded
search, stable `(updatedAt, id)` keyset pagination, latest-message selection
and per-thread unread counts before the 51-row cap. The typed wrapper validates
participants, actor-specific archive state, listing/message projection shape,
timestamps and non-negative safe unread counts. Seller profile display-name
and avatar enrichment remains a separate unprotected-table query.

The tenth checkpoint converted initial thread rendering. Conversation metadata
uses the participant/reported-staff projection before separately loading the
two retained User rows and optional Listing display context. The latest-message
window uses the monotonic Conversation timestamp plus one millisecond as a
strict upper cursor for the fixed newest-first before-page projection, reverses
the bounded result for chronological display and drops only the oldest overflow
row. This preserves the latest-200 long-thread behavior rather than accidentally
rendering the oldest 200 through the projection's no-cursor mode.

The eleventh checkpoint converted the remaining ordinary send, archive and
email-throttle paths. The page performs a cheap participant, recipient-state
and reciprocal-block preflight before attachment verification, but the
transactional write authority is the fixed database operation: it re-locks the
participant pair, rechecks blocks and account state, validates optional Listing
context, locks the exact Conversation, derives recipient and timestamp, inserts
the ordinary Message, sets first-response state and relies on the installed
thread-state trigger to monotonically bump and unarchive the Conversation.
Tracked upload claims remain in the same read-committed transaction as their
attachment Message. The app verifies the database-derived recipient before
commit. Archive/unarchive mutates only the actor's side through its fixed
function, and the email throttle derives Conversation and claim time from the
committed source Message rather than caller-supplied timestamps. Removing the
last consumers also removed the obsolete app-side Conversation/User/Listing
lock helpers.

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
| `src/app/messages/page.tsx` | Inbox, search, latest-message projection and unread grouping | Converted: one-statement participant inbox projection applies visibility, search, latest-message, unread and keyset bounds |
| `src/app/messages/[id]/page.tsx` | Participant or reported-thread view; user send; first response; thread bump; email throttle; archive state | Converted: thread projections plus fixed ordinary-send, archive and source-Message email-claim operations; upload claims share the send transaction |
| `src/app/api/messages/[id]/{list,stream,read}/route.ts` | Poll/stream projection and mark-read | Converted: exact recipient projections with per-call authority; staff list review remains bounded while stream/mark-read remain participant-only |
| `src/app/api/messages/unread-count/route.ts` | Participant unread total excluding blocked/archived threads | Converted: one-statement unread RPC |
| `src/app/messages/new/page.tsx` and `src/lib/conversationStartAccess.ts` | Read-only start prompt plus explicit canonical conversation create/get and optional context listing | Converted: the start action calls fixed database authority; obsolete app-side send locks are removed |
| `src/app/api/messages/custom-order-request/route.ts` and `src/lib/customOrderRequestAccess.ts` | Custom-request conversation/message creation | Converted: one fixed database operation revalidates the participant/block/seller/listing sources and derives the structured message |
| `src/app/api/commission/[id]/interest/route.ts` and `src/lib/commissionInterestMessageAccess.ts` | CommissionInterest, conversation and system-message transaction | Converted: one source-bound statement co-commits CommissionInterest, conversation, structured message and interested count |
| `src/lib/customOrderReadyLink.ts` and its seller/admin callers | Deduplicated ready-link message | Converted: Listing-derived operation owns participant/source validation, exact replay evidence and message creation |
| `src/app/dashboard/listings/custom/page.tsx` and buyer order detail | Participant lookup and latest custom request | Converted: bounded participant, pair and latest-request projections |
| `src/app/api/account/export/route.ts` | Sent and received message export | Converted: one participant export RPC, split into stable sent/received payload collections |
| `src/app/api/users/[id]/report/route.ts` | Message/thread report target validation | Converted: one participant existence RPC |
| `src/lib/accountDeletion.ts` | Attachment discovery and message redaction | Converted: sent-body media projection runs before one fixed, database-derived account-deletion redaction operation |
| `src/lib/metrics.ts` | Seller response-rate aggregate | Converted: aggregate-only function returns two validated counts and never thread rows or bodies |

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
   `custom_order_link`, `commission_interest_card`, and the forward-only
   attachment classification `file`. Commission interest and
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
8. Every Message writer locks the exact canonical Conversation after User and
   source locks, then writes one post-lock timestamp to both Message and thread
   state. A database insert trigger independently keeps `updatedAt` monotonic
   and clears archives. PostgreSQL transaction-start `now()` is not sufficient.

## Completion rule

This inventory is complete only when every protected access (55 in the original
baseline, 53 after compatible refactors, 37 after the first four authority
conversion checkpoints, 30 after the first structured writes, 26 after
custom-order-ready, 23 after seller metrics, 18 after account deletion, 16
after inbox conversion, 14 after initial thread rendering, and 0 after ordinary
send/archive/email conversion) has an explicit destination. The direct runtime
surface is now zero; completion still requires the compatible app to pass
before and after RLS and PostgreSQL proof to cover participant isolation,
reported-staff access, structured write families, block/account races, archive
semantics, export/deletion, metrics, rollback and FORCE. Conversation and
Message may activate together because each Message policy depends on its parent
Conversation; they must not be bundled with Notification, Order, payment,
shipping or Case activation.
