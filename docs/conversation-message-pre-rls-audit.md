# Conversation and Message Pre-RLS Audit

Opened 2026-07-22; updated 2026-07-26. Status: the compatible application,
additive schema/index pair, reviewed invariant/data-normalization migrations,
25-function authority preparation, application conversion and initial
Conversation/Message RLS activation are live. The actual pooled production
runtime passed both the earlier rollback-only preparation postflight and the
authenticated post-activation proof. Both tables now have RLS enabled without
FORCE, exactly one reviewed SELECT policy each and direct runtime SELECT only.

The authenticated RLS-off compatibility proof passed at exact deployed release
`650d1dd8`, operator `11adbeda`, and CI run `30192400811`. It proved
middleware-owned unauthenticated denial; owner and foreign list isolation;
cursor validation; inbox, owner-thread and streamed not-found rendering;
cross-origin mutation denial; owner mark-read; unread-count transition; direct
database postconditions; and exact cleanup. Sanitized mode-`0600` evidence
SHA-256 is
`f3ad7589ca0e8069c3093199235aa1a3cb45a2a684caf0a077ba1974d3f2bde7`.
Every synthetic row, Clerk session/token, exact cache key and rate-limit
counter was removed, recovery state is absent, and direct email/notification
side effects were zero. Earlier failed attempts remain retained evidence and
all also cleaned up fully; none changed RLS, grants or ordinary production
data.

The initial activation passed exact PR CI `30193830373`, post-merge main CI
`30194063246` and Extra-High review. Protected run `30194195844` applied exact
main `448d5233` and migration
`20260726073000_enable_conversation_message_rls`; migration status and the
owner-side exact grant/policy audit passed. Authenticated operator `f474e761`
then proved the actual pooled runtime identity, exact policy expressions,
SELECT-only direct grants, context-empty isolation, direct DML denial,
participant/foreign route behavior and unread transition. Cleanup removed
every exact fixture, Clerk session/token, cache key and rate-limit counter; no
new Clerk user, Notification or email was created and no recovery state
remains. Sanitized mode-`0600` evidence SHA-256 is
`1f38671673e8040b222fcb620f8875c94cd47684969d423e6f260fc7a520e141`.
FORCE is intentionally still pending as a separate release.

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
| CM-A16 | High | Ordinary sends lock users/blocks but do not lock the Conversation before deriving `messageSentAt`. Concurrent sends can commit out of order, regress `Conversation.updatedAt`, and produce inconsistent inbox/archive ordering. | After the sorted participant and optional Listing locks, take `FOR UPDATE` on the exact canonical Conversation, derive the timestamp only after that lock, then insert messages and update thread state in the same transaction. |
| CM-A17 | High | PostgreSQL `now()` is transaction-start time. The compatible app derived `messageSentAt` after the Conversation lock but did not write it to Message rows, so a waiting transaction could still commit an older `createdAt`; commission-interest also inserted without bumping/unarchiving its Conversation. | Serialize every writer on the Conversation, write the same post-lock timestamp to Message and Conversation, and add a database trigger that monotonically bumps/unarchives the parent on every insert. |
| CM-A18 | Medium | File attachments carry `kind:"file"` only inside JSON while `Message.kind` remains null, and inbox body substring search has no matching trigram index. | Set the dedicated kind on new attachment rows and add a concurrent `pg_trgm` GIN index before freezing the message taxonomy/read contract. Do not guess legacy file kinds from private bodies. |
| CM-A19 | UI | On narrow mobile viewports the composer textarea requests full width beside two fixed controls, and the nested thread scroller permits horizontal overflow/scroll chaining that can paint the cream page layer behind Safari's normally translucent bottom browser toolbar. | Make the thread edge-to-edge with internal padding, bound every flex/card/attachment child, make the textarea shrinkable, suppress horizontal overflow, and contain touch overscroll within the vertical thread. |

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
- **CM-A16 fixed in the compatible app:** ordinary sends take locks in the
  reviewed order—sorted Users/block absence, optional Listing source, exact
  canonical Conversation `FOR UPDATE`—and only then derive the send timestamp.
  Custom-order-ready also locks its Listing/Seller source rows first and then
  calls the same exact Conversation lock helper instead of relying on a joined
  query's planner-dependent row-lock order. Message inserts, first-response
  state, thread bump and unarchive now share that serialization point. CM-A17
  subsequently found and closes the separate transaction-start timestamp hole
  by explicitly persisting the post-lock time.
- **CM-A17 remediation live:** ordinary text/attachment,
  custom-request, commission-interest and custom-order-ready writers all use
  the exact post-Conversation-lock timestamp for both Message and thread state.
  The invariant migration repairs any thread timestamp behind its newest
  message and installs an owner-private trigger using `GREATEST`, so future
  writers cannot regress time or forget to unarchive the thread.
- **CM-A18 remediation live:** new attachments set
  `Message.kind="file"`; the scale migration adds the raw-managed concurrent
  `Message.body` trigram index. Historical nullable kinds and nullable
  `contextListingId` values remain unknown rather than being inferred by
  parsing private bodies or projecting one old Conversation context across
  every historical Message.
- **CM-A19 fixed in production:** the mobile thread owns the full width
  with internal bubble padding; its scroller is explicitly x-locked, long
  structured/file content is bounded, and the composer textarea uses
  `min-w-0 flex-1` instead of `w-full` beside fixed controls. `touch-pan-y` and
  `overscroll-contain` prevent the nested chat scroller from chaining into the
  cream page behind Safari's translucent bottom toolbar. The in-app browser
  was unavailable in this session, so deterministic CSS/source checks and the
  production build remain the verification path until an authenticated visual
  smoke is available.
- **Compatibility release guard extended:** the two additive pre-RLS migrations
  have a distinct exact-tree phase,
  `conversation-message-compatibility-reviewed`. Older SavedSearch and
  Notification phases still reject them as later drift; this phase does not
  authorize RLS SQL or grant narrowing.
- **Compatibility production checkpoint complete:** protected migration run
  `29964062818` applied only the nullable listing-context column and five
  read-scale indexes at exact main `05e236bb15e6400496073e808fe37d740c0e48a8`.
  Vercel deployment `dpl_6SHrhrLsXReeG7hPhXyuMssCNLqP` is `READY`, aliased to
  `thegrainline.com`, passed the runtime-role guard and returned `{"ok":true}`
  from `/api/health`. Conversation/Message RLS remains disabled with legacy
  runtime CRUD retained at this checkpoint.
- **CM-A04 production inspection passed:** protected read-only run
  `29964469109` used one `REPEATABLE READ READ ONLY` transaction at the exact
  clean main commit. It found 4 Conversations and 17 Messages; zero self or
  noncanonical Conversations, duplicate pairs, empty Conversations, invalid
  Message pairs, self Messages, unknown kinds, invalid listing pairs, orphan
  unresolved reports or invalid private custom-listing pairs. It found one
  Message newer than its Conversation and one server card missing its
  presentation flag; both have semantic idempotent repairs in the isolated
  invariant migration. No ids, bodies, emails, credentials or raw rows were
  retained. The new participant/route/thread-state triggers subsequently
  passed disposable and actual pooled-runtime proofs recorded below.
- **First disposable invariant proof retained as failed evidence:** GitHub
  Actions run `30174296895` at candidate `07812a96` applied the migrations and
  converged the runtime grants in ephemeral PostgreSQL 16, then failed its
  first valid runtime Message insert with PostgreSQL `42883`.
  `pg_catalog.greatest(...)` incorrectly schema-qualified the parser-resolved
  `GREATEST` SQL construct. Production and persistent staging were untouched.
  The candidate now uses bare `GREATEST(...)`, preserves its intended null
  behavior, and adds a source-wide executable-SQL guard against qualifying
  this class of PostgreSQL special forms. This failed run remains failed; the
  required fresh CI result is recorded separately below.
- **Fresh invariant proof and Extra-High preparation review passed:** GitHub
  Actions run `30176662926` at exact head
  `a0775e7d2f035e2d3e4a452dbb8b8fdcd1ecc44e` passed the release-byte guard,
  PostgreSQL 16 migrations, production-style grant convergence, runtime
  trigger/route and real lock-wait proof, migration status, final grant/catalog
  audit, TypeScript, lint, 1,952 tests, the fail-closed dependency audit and
  production build. The SQL review accepted the pinned `search_path`, private
  trigger ACLs, exact participant routing, immutable identities and monotonic
  parent-thread update. It also found and fixed two non-SQL issues before
  promotion: deterministic React `useId()` could suppress legitimate
  cross-tab Notification sync, and custom-order-ready left multi-relation row
  lock order to the query planner. The corrected app uses a random per-mounted
  bell token and locks Listing/Seller source rows before the exact Conversation
  helper. Conversation/Message RLS is still off and production is unchanged by
  this proof.
- **Invariant preparation production checkpoint complete:** PR 39 merged as
  exact main `98a1e592b8ae3571186ede5edd3b5b95fcb9dfe1`. GitHub CI run
  `30177311522` and Notification FORCE-equivalence run `30177311535` passed.
  Vercel production deployment `dpl_GZiSfXTxXENTfqLk6LqZmJtvC3Ud` is `READY`
  and aliased to `thegrainline.com`; its build used the reviewed pooled
  `grainline_app_runtime` identity. Protected Production workflow run
  `30177568806` then applied only
  `20260722231500_enforce_conversation_message_invariants` and
  `20260722232000_add_message_body_trgm_index`. Prisma reported all 155
  migrations applied, and the final production-style audit passed for 58
  tables, 20 enums, 32 `grainline_*` functions, one extension, two pre-existing
  RLS policy tables and zero sequence references. Conversation and Message
  remained RLS-disabled with their preparation grants.
- **Actual pooled-runtime postflight passed after two retained diagnostic
  failures:** the rollback-only operator first passed full CI as
  `25cc41e7f2c2efe02460a18f691dd18c539f0944` in run `30177872919`, then its
  live catalog query failed before fixture writes because `constraint` was an
  unquoted reserved alias. Commit `ea0871b3` renamed the alias, added the
  reserved-alias guard and passed run `30178035501`; its live write proof then
  exposed the known node-postgres parsing hazard for Prisma
  `timestamp without time zone` values. Commit `51757b2d` moved the equality
  check into PostgreSQL, used timezone-neutral text only for diagnostics,
  prohibited client-side `toISOString()` in this operator and passed run
  `30178177519`. The accepted 2026-07-25 production proof connected through the
  reviewed pooled endpoint as `grainline_app_runtime`, verified it was not the
  owner and had no `BYPASSRLS`, checked the canonical-pair constraint, four
  enabled owner-private trigger functions, their ACLs and the valid trigram
  index, accepted one valid Message/thread update, rejected a forged route,
  Message route rewrite, Conversation participant rewrite, noncanonical pair
  and direct trigger-function execution, then rolled back. Its final residue
  query found zero fixture Users, Conversations and Messages. Sanitized result:
  RLS disabled, FORCE disabled, policy count zero, `productionChanged=false`.

## Audit completion criteria

1. CM-A01 through CM-A19 are fixed or have the explicit design/scale
   disposition recorded above. CM-A04's invariant-preparation production
   application and actual-runtime postflight are complete; CM-A10 is complete
   through the initial RLS/grant activation and live pooled-runtime proof.
2. Full tests, typecheck, lint and production build pass on the compatible app
   before any RLS activation.
3. A sanitized read-only legacy inspection proves canonical/non-self
   conversations, exact Message participant pairs, structured kinds, orphan
   state, reported-thread state and archive/timestamp aggregates without
   retaining bodies or identifiers.
4. Extra High accepted the invariant-preparation SQL, fixed authority
   functions, initial policy SQL and grant narrowing in their separate
   releases. Initial activation is live and accepted; FORCE remains its own
   later Extra-High review and release boundary.

This audit pattern is required for each later sensitive group, with scope
adapted to that group's actors and provider/background workflows.
