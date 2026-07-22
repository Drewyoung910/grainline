# Conversation and Message RLS Plan

Status: pre-RLS behavior/security audit in progress on
`codex/rls-conversation-message-20260722`. Notification Bucket B is complete in
production. No production SQL or RLS change has been made for Conversation or
Message.

## Security objective

Protect private conversation metadata, message bodies and attachments from
missing or incorrect application predicates while preserving the legitimate
participant, reported-staff, custom-order, commission, export, deletion and
metrics workflows. Application authentication, authorization, block checks,
rate limits, upload claims and content validation remain primary controls. RLS
is required defense in depth; it is not a claim that a runtime credential plus
arbitrary code execution cannot invoke every function granted to that role.

Conversation and Message are one tightly coupled activation group because
Message visibility is derived from its parent Conversation. They remain
separate from Notification, Order/payment/shipping and Case/CaseMessage.

## Verified baseline

The original machine inventory recorded 50 direct ORM operations and 5 raw SQL
table references. Compatible audit refactors currently leave 44 direct ORM
operations and 7 raw SQL references across 17 runtime files (51 total protected
access points). The surface includes the user inbox and
thread, list and stream polling, unread counts, per-recipient mark-read,
archive state, first-response metrics, email throttling, account export,
account-deletion redaction, user-report validation, seller response metrics,
custom-order request and custom-order-ready messages, and the
commission-interest system message. The durable detail and count contract are
in `docs/conversation-message-authority-inventory.md`.

Important architecture findings at this boundary:

- Direct table grants are currently broad because this group is not yet RLS
  protected. They must not survive activation.
- Message foreign keys do not prove that sender and recipient are the opposing
  participants in the referenced Conversation.
- Custom-order request, commission interest and custom-order-ready now commit
  their Conversation/Message effects in source-validated transactions. The
  later database functions must preserve those atomic boundaries.
- The staff thread page is intentionally narrow: an ADMIN or EMPLOYEE may read
  a non-participant thread only while an unresolved `MESSAGE_THREAD` report
  targets that exact conversation. There is no general staff bypass.
- The message stream authorizes once at HTTP entry today. The RLS projection
  should re-evaluate participant or unresolved-report authority on every poll,
  so resolving a report ends staff visibility without waiting for reconnect.
- Seller response metrics query Conversation and Message across a seller's
  history. That path needs an aggregate-only function, not broad service reads
  of message bodies.
- One Conversation remains canonical per participant pair. Listing context is
  stored on each Message so entry from multiple listings remains clear without
  fragmenting the inbox or rewriting old thread context.

## Target table policies and grants

### Conversation

- `SELECT`: the transaction-local user is `userAId` or `userBId`, or is an
  active staff reviewer with an unresolved `MESSAGE_THREAD` report for the
  exact conversation.
- No direct runtime `INSERT`, `UPDATE`, or `DELETE` after activation.
- Creation, context attachment, send-side state, archive state and email claims
  use fixed-purpose operations. A private generic mutation core, if needed,
  remains ungranted to `PUBLIC` and runtime.

### Message

- `SELECT`: the parent Conversation is visible under the exact same participant
  or reported-staff rule.
- No direct runtime `INSERT`, `UPDATE`, or `DELETE` after activation.
- Mark-read is a fixed recipient operation that derives `readAt=now()` and
  cannot clear or backdate another user's row.
- User send derives sender, recipient, ordinary kind/system status and thread
  side effects from the validated actor and Conversation. User body and claimed
  attachment payload are product input, but the caller cannot choose the write
  target or structured authority fields.
- Custom request, commission interest and custom-order-ready each retain a
  distinct source-validated operation.

The reported-staff predicate must remain usable after later User and UserReport
RLS. Prefer a small fixed predicate with pinned `search_path` and owner-private
internals over embedding a future cross-policy recursion trap. It may return
only a boolean and must not expose staff-wide row access.

## Planned one-statement read surface

Avoid wrapping inbox, page and long-poll requests in multi-query interactive
transactions solely to carry `app.user_id`. Notification provider evidence
already showed the connection-hold cost of that pattern. Use bounded
one-statement `SECURITY INVOKER` projections that set transaction-local context
inside the statement and query RLS-protected rows:

1. inbox/search with latest message and unread count;
2. thread metadata plus bounded message page;
3. incremental message list used by list and stream routes;
4. unread total;
5. participant conversation lookup and latest custom request;
6. account export rows;
7. report-target existence checks.

Every caller passes only the server-resolved local User id. Route ids, search
terms, cursors and page sizes remain bounded inputs, never identity context.
The direct runtime table query with no context must return zero rows.

## Fixed write families

1. **Create/get conversation**: derive canonical participant order; reject
   self, unavailable or blocked targets; lock the sorted pair; attach only a
   listing visible to both participants and never overwrite existing context.
2. **Ordinary send**: lock/revalidate the conversation, users and block pair;
   derive the opposing recipient; force ordinary kind/system fields; insert
   message, validate and derive any optional Listing context, set first response
   when appropriate, bump updated time and unarchive both participants atomically.
3. **Custom-order request**: validate seller custom-order and payment state,
   block state and optional seller-owned public listing; atomically create/get
   the conversation, attach context, insert the fixed kind and bump the thread.
4. **Commission interest**: bind the commission-interest system message to the
   durable CommissionInterest/CommissionRequest and exact buyer/seller pair in
   the same business transaction.
5. **Custom-order-ready**: derive conversation, seller, reserved buyer, payload
   and replay identity from the exact reserved Listing; preserve the existing
   advisory-lock/dedup behavior.
6. **Archive/unarchive and mark-read**: mutate only the authenticated
   participant's archive column or received unread messages.
7. **Email throttle claim**: bind the claim to the committed source Message and
   its Conversation; derive the throttle timestamp in the database.
8. **Account-deletion redaction**: fixed cleanup bound to the deleting account's
   transaction-local context; no general body-edit function.
9. **Seller response metrics**: aggregate-only service function returning
   counts, not Conversation or Message rows or bodies.

## Race and lifecycle requirements

- Reuse the sorted user-pair lock protocol already proven by Notification for
  every create/send operation and ordinary block mutation. A block committed
  first must prevent send; a send committed first must have one explicit,
  tested linearization point.
- Lock the Conversation before send/archive/context transitions. A send clears
  both archive timestamps as part of its commit. Ordinary send lock order is
  sorted Users/block absence, optional Listing source, then exact Conversation
  `FOR UPDATE`; derive the thread timestamp only after that final lock.
- Coordinate account deletion with the same user lifecycle locks so a new
  message cannot commit after deletion has decided the account is unavailable.
- Preserve unordered pair uniqueness and inspect legacy rows before enforcing
  canonical order, non-self conversations and exact message participants.
- Keep no direct Conversation or Message delete path. Account deletion retains
  the rows but redacts user content according to the existing retention design.

## Compatibility and rollout sequence

1. Inventory and pin every current access path. **Complete: original 55-path
   migration baseline; current compatible surface is 51 protected accesses.**
2. Complete `docs/conversation-message-pre-rls-audit.md` and fix its activation
   blockers before authority SQL. **In progress.**
3. Read-only legacy/preflight design: exact participant, message-pair, kind,
   orphan, report and archive aggregates; do not export bodies or identifiers.
   **Scaffold complete; protected main-only Production execution remains
   pending after the compatibility migrations.**
4. Preparation migration: functions, predicates, invariant checks/triggers and
   exact ACLs while RLS remains disabled.
5. Compatible app deployment: all protected accesses move to reviewed
   helpers; test before and after RLS.
6. Disposable PostgreSQL proof: policies/grants, every read/write family,
   direct denial, staff report resolution, account/block/archive races,
   deletion/export/metrics, rollback and legacy handling.
7. Protected backup and sanitized production inspection.
8. Initial `ENABLE`/explicit `NO FORCE` activation with exact two-table policy
   and grant guard, followed by runtime and authenticated route postflight.
9. Separate `FORCE ROW LEVEL SECURITY` hardening and fresh postflight.

Background jobs and old/new Vercel coexistence still exist pre-launch, so the
compatible app and database activation remain separate. A failed Preview with
`DATABASE_URL_SHAPE` is not authority to weaken the runtime credential guard.

The nullable `Message.contextListingId` preparation migration and compound
read indexes must land before the compatible application that selects/writes
them. They do not enable RLS or narrow grants and are compatible with the old
application. The application checkpoint then precedes invariant/RLS
preparation, so rollback never requires dropping a column used by a live build.
The exact additive pair is guarded as
`conversation-message-compatibility-reviewed`; CI and the manual Production
migration workflow fail closed on any other later migration or byte drift. This
phase does not authorize Conversation/Message policies or grants.

## Product and scale decisions

- Retain one ordinary Conversation per unordered participant pair. Per-listing
  threads create duplicate inbox rows, split history and make blocking/reporting
  semantics harder. Per-Message Listing context preserves why a message was
  sent while leaving the relationship thread coherent.
- `isSystemMessage` is presentation metadata for a server-generated structured
  card, not an authority bit. Every structured writer still validates its
  durable source and derives actor, recipient, kind and payload.
- Staff have no general bypass into ordinary messages. Exact unresolved-report
  review stays read-only. Grainline-initiated customer/shop outreach, if built,
  must use a separately labeled support-thread model with its own participants,
  audit trail, assignment and RLS contract.
- `Case`/`CaseMessage` remain a separate dispute record and later RLS group.
  They already provide participant/staff case discussion and should not be
  merged into ordinary Conversation history.
- Bounded keyset reads and matching indexes make the storage/query design
  reasonable for at least 50,000 registered accounts. This is not a claim of
  50,000 simultaneous live threads: the current per-thread SSE database polling
  must move to managed realtime/fanout before sustained high concurrency.

## Extra High gate

High effort is appropriate for this inventory, app call-graph refactor and
deterministic tests. Switch back to Extra High before accepting function
signatures, policy SQL, `SECURITY DEFINER` bodies, grants, legacy mutation,
block/account race claims, or an activation artifact. No draft SQL from this
phase should be promoted merely because the inventory test passes.
