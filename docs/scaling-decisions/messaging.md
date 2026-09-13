# Messaging, Support, and Case Scaling Decisions

Decision date: 2026-07-25  
Status: active; ordinary Conversation/Message RLS is still in preparation  
Owners: product and engineering

## Decisions that are settled now

### One ordinary conversation per user pair

Keep one canonical `Conversation` for each unordered pair of users. Listing and
custom-order context belongs on the individual `Message.contextListingId`, not
in duplicate inbox threads. This keeps blocking, reporting, unread state,
archive state, and relationship history coherent.

Revisit only if production research shows that users cannot understand the
combined history even with clear per-message context cards. Do not create
listing-specific duplicate conversations merely to work around UI grouping.

### Long threads use bounded reads

No route may load an unbounded message history. Thread history uses bounded,
stable keyset pagination backed by the Conversation/Message scale indexes.
Inbox projections and unread counts remain bounded and independently indexed.
Message-body substring search is backed by the raw-managed `pg_trgm` GIN index.

Review query plans and p95 latency when either of these is true:

- a real thread reaches 10,000 messages;
- the Message table reaches 1,000,000 rows;
- a message read/search query exceeds 500 ms p95 for seven days;
- the database reports sustained sequential scans or material index bloat on
  the message hot paths.

Those are review triggers, not automatic partitioning thresholds. Prefer query
and index correction first. Consider time/range partitioning only after real
plans show that bounded indexed reads are no longer sufficient.

### Realtime delivery remains transport-neutral

The current SSE endpoint holds a serverless request and polls PostgreSQL every
3–10 seconds per open thread. This is acceptable only for prelaunch and low
concurrency. RLS projections and fixed write authority remain the data contract
regardless of transport.

Before a public growth campaign, expose operational measurements for active
message streams, database pool utilization/wait time, message-query p95, and
stream error/reconnect rate. Run a capacity review when any of these occurs:

- 25 concurrent open message streams are sustained for 15 minutes;
- message traffic consumes 25% of the measured database connection budget;
- pool wait exceeds 100 ms p95 or message reads exceed 500 ms p95;
- reconnects or polling traffic materially affect unrelated checkout,
  webhook, notification, or case workloads.

At that review, load-test the real provider topology and set a migration date.
Move delivery to a managed realtime/fanout service before sustained concurrency
approaches the measured provider limit. The managed channel carries invalidation
or event signals; authorized message rows still come from recipient-scoped
database reads. Never solve stream pressure with broader table grants, long
database transactions, or an owner credential in application runtime.

### Staff outreach is a separate product

Ordinary buyer/seller threads never gain a general EMPLOYEE/ADMIN bypass.
Current staff visibility is limited to an exact unresolved message report.
Future Grainline-initiated outreach uses visibly branded
`SupportThread`/`SupportMessage` records with assignment, audit history,
participant visibility, notification/email delivery, and its own RLS review.
It can be implemented after ordinary Conversation/Message RLS because it is a
separate authority surface.

### Cases remain separate from ordinary messages

`Case`/`CaseMessage` is the durable dispute record and remains a separate RLS
activation group. Do not merge case discussion into ordinary conversations.
Before case scale work, audit evidence attachments, staff assignment/SLA,
appeal/reopen policy, retention, and refund-state atomicity together.

## Deferred conveniences

Typing indicators, reactions, user editing/deleting, richer delivery/read
receipts, and presence are intentionally deferred. Each adds write volume,
retention semantics, or realtime fanout. Add them only with explicit product
value, bounded storage, rate limits, abuse handling, and recipient authority.

## Already implemented or in the current reviewed candidate

- canonical participant-pair creation and serialization;
- immutable participant/message-routing database invariants;
- monotonic Conversation activity timestamps and archive reopening;
- explicit attachment kind;
- per-message listing context;
- bounded pagination/read indexes and message-body trigram search;
- source-derived structured-message authority;
- notification unread-count self-event correction;
- mobile horizontal-overflow and nested-scroll containment.

## Evidence and related records

- `docs/conversation-message-pre-rls-audit.md`
- `docs/conversation-message-authority-inventory.md`
- `docs/rls-conversation-message-plan.md`
- `STRATEGY.md`

Production measurements must be added here when they exist. Synthetic proof
establishes correctness and race behavior, not production capacity.
