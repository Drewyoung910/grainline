# Conversation and Message RLS Plan

Status: compatibility and invariant-preparation releases are live. The
preparation SQL passed disposable PostgreSQL proof, Extra-High review and an
actual pooled production-runtime rollback-only postflight. Notification Bucket
B is complete in production. Conversation/Message RLS remains disabled with
zero policies. The complete authority-policy draft passed Extra-High review,
disposable PostgreSQL 16 proof and full CI at `7a7654c3` in run `30180610380`;
the first protected aggregate-only production inspection passed safely at
exact main `aa487bfb` in run `30181030719` and found one legacy custom-order
link without its new durable Listing source column. The second protected
aggregate-only inspection at exact main `09222adb` in run `30182892742`
classified exactly one repairable and zero unrepairable rows, with every other
relationship/source count zero. The narrow fail-closed cleanup is now complete
in production: protected migration `30183709885` applied exact main
`ac1f519e`, and read-only postflight `30183765803` returned zero missing,
repairable, unrepairable, invalid and duplicate custom-link sources with every
other anomaly count zero. Functions-only promotion is complete in production:
protected run `30186315784` applied exact main `70770bed`, and the final
owner-side grant/RLS audit passed. The exact
functions-only disposable candidate is
`20260726022500_prepare_conversation_message_authority` at SHA-256
`9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07`.
It contains 25 functions/function ACLs, no RLS, policies or table-grant
changes. Run `30184548860` at `037f654c` passed every candidate-aligned
PostgreSQL step but remains failed evidence overall because the disposable
migration was not removed before static migration-tree guards ran. Teardown is
now exact-hash and fail-closed. Fresh run `30184742417` at `3c488bac` passed
the complete candidate-aligned PostgreSQL, static, dependency-audit and build
gates. The executable body is proposed for promotion at SHA-256
`eba8daf4228efd0d13c35a8a99b68167fa879b11791f3059efbaa7599c793b98`;
that exact promoted release passed separate fresh run `30185303311` at
`825b218c`, evidence-only run `30185481070` at `0a98ed1c`, and post-merge
main run `30185597811` at `70770bed`. Its separately prepared pooled-runtime,
read-only postflight passed with the exact release binding, 25-function
catalog/ACL, 19 callable functions, six private-core denials, RLS/FORCE off,
zero policies and legacy table CRUD retained. Sanitized mode-0600 evidence
SHA-256 is
`fa11589253cafbd87f16a9442dc2fd57afc136263cc1ac89b93219ebbede295d`.
Application conversion is complete in the isolated candidate but is not yet
deployed; the first bounded checkpoint converted
list polling, stream polling, mark-read and unread count through four exact
authority functions, and the second converted account export plus message/thread
report validation. The third converted custom-order participant, pair and
latest-request reads. The fourth moved the read-only start-page pair lookup and
explicit conversation start behind fixed authority. The fifth converted
custom-order request and commission-interest writes and removed the now-unused
app-side conversation get/create helper. The sixth converted
custom-order-ready, including exact replay evidence and post-commit
Notification healing. Direct protected-table access is now reduced from 53 to
26. The seventh converted seller response metrics to the aggregate-only
function, reducing the surface to 23. The eighth moved deletion-time attachment
discovery and Message redaction behind the participant export projection and
fixed account-deletion authority function, reducing the surface to 18. The
ninth moved inbox visibility, search, latest-message selection, unread grouping
and keyset bounds into one participant projection, reducing the surface to 16.
The tenth moved initial participant/reported-staff thread metadata and the
latest 200-message window behind bounded projections, reducing the surface to
14 without changing long-thread chronology. The eleventh moved ordinary text
and attachment writes, source-Message email claims and participant-side
archive state behind the installed fixed functions, preserving upload claims
inside the read-committed write transaction and reducing the machine inventory
to zero direct protected-table operations or raw references.
Pull-request CI run `30189704185` passed the complete PostgreSQL 16
invariant/legacy/functions-only/recipient-RLS proof, TypeScript, lint, 2,007
tests, dependency audit and production build at `03af5bae`. The subsequent
set-level Extra-High review found no new database-authority bypass and added a
fail-closed wrapper hardening checkpoint: actor relationship, bounded
identifiers, finite timestamps, and generated-identifier equality for new
rows. Fresh reviewed-head run `30189982915` passed the same complete gate at
`a27e99d3`. The application-authority Extra-High gate is complete with no open
findings; merge and the RLS-off compatibility deployment/postflight remain
separate boundaries.
Policy/table-grant activation and FORCE remain later separate releases.

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
table references. Compatible audit refactors left 45 direct ORM operations and
8 raw SQL references across 17 runtime files (53 total protected access
points). The eleven authority checkpoints removed every direct protected
operation: the current candidate has 0 ORM operations and 0 raw references
across the runtime tree.
The surface includes the user inbox and
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
  their Conversation/Message effects through the installed source-validated
  database functions, preserving each atomic boundary.
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
  `FOR UPDATE`; derive the thread timestamp only after that final lock and
  explicitly write it to Message.createdAt. Do not rely on the `now()` default,
  which is the PostgreSQL transaction-start time.
- Keep a database-level insert trigger that monotonically bumps Conversation
  time with `GREATEST` and clears both archive timestamps. It is a durable
  invariant, not a replacement for source validation or fixed RLS writes.
- Coordinate account deletion with the same user lifecycle locks so a new
  message cannot commit after deletion has decided the account is unavailable.
- Preserve unordered pair uniqueness and inspect legacy rows before enforcing
  canonical order, non-self conversations and exact message participants.
- Keep no direct Conversation or Message delete path. Account deletion retains
  the rows but redacts user content according to the existing retention design.

## Compatibility and rollout sequence

1. Inventory and pin every current access path. **Complete: original 55-path
   migration baseline; current authority-conversion surface is zero direct
   protected accesses after converting polling/read, privacy, report-target,
   custom-order reads, conversation start and all three structured write
   families, aggregate seller response metrics, account deletion, inbox and
   initial thread rendering, ordinary send, archive state and email claims.**
2. Complete `docs/conversation-message-pre-rls-audit.md` and fix its activation
   blockers before authority SQL. **Complete for the preparation boundary:
   app findings fixed; invariant proof, Extra-High review, protected production
   application and actual pooled-runtime postflight passed.**
3. Read-only legacy/preflight design: exact participant, message-pair, kind,
   orphan, report and archive aggregates; do not export bodies or identifiers.
   **Complete at exact main `05e236bb15e6400496073e808fe37d740c0e48a8`; the
   aggregate-only inspection found no authority-invalid rows.**
4. Preparation migration: canonical/immutable participant pairs, exact Message
   routing, monotonic thread state, metadata normalization and body-search
   index while RLS remains disabled. **Complete in production. The first
   disposable run `30174296895` remains failed evidence: PostgreSQL `42883`
   rejected the invalid `pg_catalog.greatest(...)` qualification on the first
   valid runtime insert after migrations/grant convergence. Production was
   untouched. Fresh run `30176662926` passed the exact release guard,
   PostgreSQL 16 migrations, runtime trigger/route and lock proof, migration
   status, grant/catalog audit, TypeScript, lint, 1,952 tests, dependency audit
   and production build at head `a0775e7d2f035e2d3e4a452dbb8b8fdcd1ecc44e`.
   Extra-High review accepted the invariant SQL after separately correcting a
   cross-tab Notification source-token regression and making custom-order-ready
   Listing/Seller-then-Conversation row-lock order explicit. Exact main
   `98a1e592b8ae3571186ede5edd3b5b95fcb9dfe1` deployed as
   `dpl_GZiSfXTxXENTfqLk6LqZmJtvC3Ud`; protected workflow `30177568806` applied
   the two preparation migrations. The accepted operator at `51757b2d`, after
   retained reserved-alias and timestamp-parser diagnostic failures, passed
   CI run `30178177519` and the actual pooled `grainline_app_runtime`
   rollback-only proof with zero fixture rows left behind. RLS and FORCE remain
   disabled with zero policies.**
5. Compatible app deployment: all protected accesses move to reviewed
   helpers; test before and after RLS. **The invariant-compatible application
   is live. The authority RPC/helper conversion candidate now has zero direct
   protected-table accesses and passes TypeScript, focused lint and the full
   2,007-test suite (2,004 pass, 3 intentional skips). Checkpoint push, fresh CI
   PostgreSQL proof and Extra-High authority review are complete. PR 50 merged
   as exact main `650d1dd818ac3694f7fd6da9954aaf053786cc40` after final
   PR-head run `30190097435` and post-merge main run `30190239983` passed.
   Exact Production deployment `dpl_C1rXvRMMJetR25Na4X5yHSa91HpM` is READY,
   aliased to `thegrainline.com`, and returned `{"ok":true}` from
   `/api/health` after the runtime-role build guard passed. RLS and grants
   remain at the preparation posture. The authenticated RLS-off compatibility
   postflight remains before database activation. The first operator run at
   `16bddf5a` is retained failed evidence: PostgreSQL `42883` rejected
   schema-qualified multi-array `pg_catalog.unnest(...)` while seeding the
   synthetic users. The operator revoked/removed every token, session, cache,
   rate-limit counter and exact fixture row, and the idempotent cleanup rerun
   passed. Production application, RLS and grants were unchanged. The corrected
   candidate uses bare multi-array `unnest(...)`, extends the source-wide
   special-form guard, and requires a fresh CI plus live pass.**
6. Disposable PostgreSQL proof: policies/grants, every read/write family,
   direct denial, staff report resolution, account/block/archive races,
   deletion/export/metrics, rollback and legacy handling. **Complete for the
   disposable draft at exact head `7a7654c3` in run `30180610380`, including
   RLS-off compatibility scoping, structured replay validation, malformed
   payload handling, exact function ACL/search-path catalog and real lock
   waits. The two immediately preceding failed runs remain documented evidence,
   not passing results.**
7. Protected backup and sanitized production inspection. **The first exact-main
   run `30181030719` retained only aggregate evidence and found four
   Conversations, 19 Messages and one custom-order-link row with missing
   `Message.contextListingId`; all other invalid relationship/source counts
   were zero. The second exact-main run `30182892742` proved through aggregate
   counts that exactly one row's valid legacy payload resolves to the exact
   private Listing/seller/reserved buyer/Conversation relationship, with zero
   unrepairable rows and zero duplicate sources. The approved cleanup candidate
   is capped at one fully validated update, locks the source/target tables,
   rejects malformed or expanded scope, and asserts zero missing, invalid or
   duplicate custom-link sources. After its protected migration, rerun the full
   inspection and require every custom-link missing/invalid count to be zero.
   **Complete:** protected migration `30183709885` applied the exact one-row
   repair and postflight `30183765803` returned all required custom-link and
   other authority-invalid counts as zero.**
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

The live compatibility checkpoint is protected migration run `29964062818`
plus Vercel production deployment `dpl_6SHrhrLsXReeG7hPhXyuMssCNLqP`. The
aggregate legacy inspection is protected run `29964469109`. The later live
invariant checkpoint is exact main
`98a1e592b8ae3571186ede5edd3b5b95fcb9dfe1`, deployment
`dpl_GZiSfXTxXENTfqLk6LqZmJtvC3Ud`, protected migration run `30177568806` and
accepted pooled-runtime operator commit `51757b2d` after CI run `30178177519`.
These identifiers are operational evidence, not authority to combine policy
and ACL preparation, initial activation or FORCE releases.

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
