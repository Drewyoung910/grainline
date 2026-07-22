# Conversation and Message Pre-RLS Audit

Date: 2026-07-22. Branch:
`codex/rls-conversation-message-20260722`. Status: active prerequisite audit;
no Conversation or Message RLS SQL has been drafted, applied or deployed from
this branch.

## Why this gate exists

RLS must enforce the intended product contract, not freeze accidental current
behavior. Every sensitive table group therefore receives a behavior,
authorization, integrity, lifecycle and test audit before policy SQL. The
machine call-graph baseline in `docs/conversation-message-authority-inventory.md`
is necessary but not sufficient.

## Confirmed strengths

- Global middleware blocks suspended/deleted authenticated accounts before
  private pages and APIs. Message write paths also recheck account state.
- Participant pages and APIs use explicit `userAId`/`userBId` predicates.
- Non-participant staff access is read-only and limited to an active unresolved
  `MESSAGE_THREAD` report for the exact Conversation. Staff live updates,
  mark-read, archive, composer and custom-listing actions are disabled.
- Ordinary message send validates membership, both account states and reciprocal
  blocks again inside its write transaction. It rate-limits, bounds text,
  verifies attachment ownership/content at persistence time and atomically
  claims direct uploads with Message rows.
- Conversation pairs are canonicalized by all three current create paths and a
  functional unordered unique index prevents swapped duplicates.
- Commission interest and its opening system message commit in the same
  transaction as the open-state guard and interest row.
- Custom-order-ready uses an advisory transaction lock and a duplicate check.
- Inbox/unread queries exclude blocked and archived threads; a new message
  reopens both participants' archive state.
- Account export includes both sent and received messages. Account deletion
  preserves retained rows while redacting the deleting sender's bodies,
  bounded sensitive values in received content and first-party attachments.
- Message list/stream inputs and result sizes are bounded, private-cache headers
  are present, and staff review does not start those live-update routes.
- Long threads and inboxes use stable `(createdAt,id)` / `(updatedAt,id)`
  keysets with bounded 200-message and 50-conversation windows. One participant
  pair retains one Conversation while each Message can preserve its own
  validated Listing context.

## Findings and required disposition

| ID | Severity | Finding | Required before RLS |
|---|---|---|---|
| CM-A01 | High | `GET /messages/new` creates or updates a Conversation and has no creation rate limit. Prefetch/navigation can create durable empty rows without a submitted message. | Make GET read-only. Move create/get into an explicit origin-guarded, rate-limited mutation or the first-message transaction. Remove the empty-conversation workaround once compatible. |
| CM-A02 | High | Custom-order request performs create/get, context attach, Message insert and thread bump as separate commits. A failure can leave partial state, and account/block state is not rechecked at the write boundary. | Replace with one atomic operation that locks/revalidates the participant pair, seller/listing state and block absence. |
| CM-A03 | High | Conversation start, ordinary send, custom request, commission interest and custom-order-ready use check-then-write block tests without the sorted user-pair lock protocol. A concurrent block can race a create/send. | Use `FOR SHARE` on the sorted User pair at `READ COMMITTED`, matching the existing block writer's `FOR UPDATE` locks; prove both race orderings. |
| CM-A04 | High | Message foreign keys do not enforce that sender and recipient are the two opposing participants in the parent Conversation. | Inspect legacy data, then add a new-row invariant trigger/check and prove forged sender/recipient rejection. |
| CM-A05 | High | `sendCustomOrderReadyLink` accepts caller-supplied conversation, seller, buyer and listing payload rather than reloading the exact reserved Listing relationship. Its Notification wrapper later validates source, but the Message can still be minted from a bad internal call. | Reduce the helper/function input to stable source ids and derive target, structured kind, body and replay identity from the locked Listing/Conversation rows. |
| CM-A06 | Medium | Custom-order request and commission-interest POST routes lack the repository's explicit cross-origin mutation guard. Cookie policy helps, but these routes are inconsistent with the hardened mutation boundary. | Add `getExplicitCrossOriginPostRejection` before auth, parsing, rate-limit consumption or database work; pin order in tests. |
| CM-A07 | Medium | Incremental list/stream cursors carry only `createdAt`. Ordering includes `id`, but `createdAt > since` can skip a same-timestamp row at a page boundary. | Use a `(createdAt,id)` cursor end to end and prove tie handling. |
| CM-A08 | High | Account deletion obtains its conflicting User row lock only at the final User update, after message redaction. A concurrent send can pass its checks and commit after the deletion scan. | Lock the deleting User at the start of the anonymization transaction and make sends take the compatible sorted-pair share lock. Prove deletion-first and send-first orderings. |
| CM-A09 | Design | `isSystemMessage` is true for commission-interest cards but false for custom-order-ready cards, and no runtime behavior currently consumes the flag. | Define the semantic contract before adding checks. Do not use this field for authority until existing and intended structured kinds are reconciled. |
| CM-A10 | Expected gap | Runtime currently has broad Conversation/Message CRUD because this group has not activated RLS. | After compatible helpers are live, revoke all direct DML, keep context-denied SELECT, and expose only reviewed fixed operations. |
| CM-A11 | High | Private custom listings are authorized correctly by the page for their seller and reserved buyer, but public-only metadata calls `notFound()` first, so both authorized viewers can receive a false 404. | Return generic no-index metadata for non-public listings without exposing private fields; retain viewer-aware page authorization and pin both boundaries in tests. |
| CM-A12 | Medium | Threads render only the latest 200 messages and have no older-history control; the inbox similarly caps at 50 conversations. Long-lived users can lose access to valid history even though the rows remain stored. | Add stable keyset pagination for older messages and inbox conversations before freezing the read API/RPC contract. |
| CM-A13 | Scale | The SSE route holds a serverless request and polls PostgreSQL every 3–10 seconds per open thread. That is acceptable for prelaunch/low concurrency but is not a 50k-concurrent-user transport. | Keep the storage/read contract transport-neutral, record an operational migration threshold, and move high-concurrency delivery to a managed realtime/fanout channel rather than weakening RLS or opening long DB transactions. |
| CM-A14 | Medium | Rendering or prefetching a thread marks matching `NEW_MESSAGE` Notification rows read before the participant actually opens the client UI; archive/unarchive writes also lacked an explicit rate limit. | Move Notification read state into the existing origin-guarded participant POST fired by the mounted client, and rate-limit archive state changes. |
| CM-A15 | High | The one-thread-per-pair rule redirects an existing conversation before validating the new `listing` query, so entering from another listing loses that context. Overwriting the Conversation-level listing would make older messages misleading; creating one thread per listing would fragment the inbox. | Keep one Conversation per participant pair, validate listing context before both new/existing redirects, store the validated context on each Message, and derive it again from the locked Listing and participant pair at send time. |

## Remediation progress

- **CM-A01 fixed in the compatible app:** `/messages/new` now performs only
  read/validation work. A visible server-action submission is limited to 20
  starts per hour and calls `startConversationForUser`, which locks the sorted
  User pair, checks reciprocal blocks, serializes same-pair creation with a
  transaction advisory lock and creates/attaches context at `READ COMMITTED`.
- **CM-A02 fixed in the compatible app:** custom-order conversation create/get,
  seller/listing revalidation, structured Message insert and thread bump now
  commit in one `READ COMMITTED` transaction. Failures leave no partial thread
  or message state.
- **CM-A03 fixed:** ordinary start, ordinary send, custom-order request,
  commission interest and custom-order-ready all use the sorted User lock
  protocol. The creation advisory mutex is scoped to
  create/get only, so normal messages between a pair are not globally serialized.
- **CM-A05 fixed in the compatible app:** custom-order-ready accepts only a
  Listing id. Its locked transaction derives and validates the private active
  listing, reserved buyer, seller, exact Conversation pair, structured payload,
  link and dedup scope; callers cannot choose cross-user write targets.
- **CM-A06 fixed:** custom-order request and commission-interest POSTs now run
  the explicit cross-origin guard before authentication, rate-limit consumption,
  parsing or database work; source-order tests pin the boundary.
- **CM-A11 fixed in the compatible app:** metadata for private/non-public rows is
  now generic and `noindex,nofollow` rather than throwing a public-only 404.
  The page remains the viewer-aware enforcement point, allowing only the seller,
  reserved buyer or explicit active staff preview while returning 404 to others.
- **CM-A08 fixed in the compatible app:** account deletion takes `FOR UPDATE`
  on the deleting User before reading and redacting retained messages. Ordinary
  sends take the compatible sorted-pair `FOR SHARE` locks, producing an explicit
  send-first-or-delete-first ordering with no post-scan message race.
- **CM-A14 fixed in the compatible app:** thread page rendering is read-only for
  Notification state. The mounted participant client invokes the existing
  origin-guarded, rate-limited read POST, which marks both Message rows and the
  exact thread's Message notifications. Archive/unarchive actions share a
  60-per-hour account limiter.
- **CM-A07 fixed in the compatible app:** list, stream, client merge and older
  history requests carry bounded `(createdAt,id)` cursors. Both directions
  include the id tie-breaker, so equal timestamps cannot skip a row.
- **CM-A09 decided:** `isSystemMessage` means server-generated structured
  presentation, not authorization. Commission-interest and custom-order-ready
  cards set it; a buyer-authored custom-order request does not. No policy or
  application authorization may trust this flag by itself.
- **CM-A12 fixed in the compatible app:** initial thread and inbox reads are
  bounded to the latest 200 messages and 50 conversations, with stable keyset
  controls for older history. Additive compound indexes match those paths.
- **CM-A13 disposition recorded:** the relational model, bounded projections,
  keysets and indexes are suitable for 50,000 registered accounts. The current
  SSE implementation is explicitly low-concurrency transport: every open
  thread holds a serverless response and polls PostgreSQL every 3–10 seconds.
  Before sustained high concurrent messaging, replace it with managed
  realtime/fanout while keeping the same RLS read contract; do not solve
  transport scale with broader database grants.
- **CM-A15 fixed in the compatible app:** listing entry points now validate
  context before reusing the canonical pair Conversation and preserve the
  query through the redirect. The composer displays/removes that context, and
  each created Message stores a Listing relation re-derived under row locks
  from the listing plus exact participant pair. Custom-request and
  custom-order-ready messages store the same source-derived relation.
- **Compatibility release guard extended:** the two additive pre-RLS migrations
  have a distinct exact-tree phase,
  `conversation-message-compatibility-reviewed`. Older SavedSearch and
  Notification phases still reject them as later drift; this phase does not
  authorize RLS SQL or grant narrowing.

## Audit completion criteria

1. CM-A01 through CM-A15 are fixed or have the explicit design/scale
   disposition recorded above. CM-A04 and CM-A10 remain intentionally open
   until the legacy inspection and reviewed database-authority phase.
2. Full tests, typecheck, lint and production build pass on the compatible app
   before any RLS activation.
3. A sanitized read-only legacy inspection proves canonical/non-self
   conversations, exact Message participant pairs, structured kinds, orphan
   state, reported-thread state and archive/timestamp aggregates without
   retaining bodies or identifiers.
4. Only then may Extra High review accept policy/function SQL and PostgreSQL
   concurrency claims.

This audit pattern is required for each later sensitive group, with scope
adapted to that group's actors and provider/background workflows.
