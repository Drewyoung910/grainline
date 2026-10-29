# Block Pre-RLS Domain Audit

Date: 2026-10-28

Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

Reverified against exact main `fb38730ff86f85a9b1dbd5bba39cbddd54af9108`
on 2026-10-29. No Block runtime consumer changed between those sources.

Status: Option B design accepted; compatible preparation remains unimplemented,
and no Block RLS, grant, data, or production change is authorized by this audit

## Intended Product Behavior

`Block` is a private, asymmetric safety relationship. An active user may block
another non-deleted user and later remove only the block they created. The
current product deliberately still permits blocking a suspended target, so a
security release must not silently change that behavior. Either
direction makes the pair unavailable to each other across discovery,
messaging, commissions, favorites, follows, stock notifications, notifications
and checkout.

Only the blocker may manage and view the explicit block record in account
settings. Other product surfaces need only the answer "this pair is
unavailable"; they must not reveal who initiated the block, its timestamp or
its database identity. Unblocking does not restore follows, subscriptions or
checkout sessions that were removed while the block was active.

No product workflow updates a Block row. The only valid row mutations are
insert and delete. `createdAt` is immutable.

## Schema And Current Authority

`Block` has a generated `id`, unique `(blockerId, blockedId)`, an index for each
direction, `createdAt`, and restrictive foreign keys to both User columns. RLS
is off and the ordinary runtime role retains broad predecessor CRUD.

The table alone does not enforce:

- the blocker is the authenticated actor;
- both users are active and distinct;
- only the blocker can remove the row;
- dependent Follow and StockNotification rows are removed;
- the sorted user-pair lock is held while the relationship changes.

Current creation and removal run in transaction-local user context.
`createUserBlock()` takes the shared sorted pair lock, validates both accounts,
upserts the actor-owned row and deletes the pair's stock notifications in the
same transaction. `deleteUserBlock()` takes the same lock and deletes only the
actor-owned direction. The block/follow and notification protocols use this
same pair-lock order.

## Complete Current Consumer Inventory

### Direct application operations

Nine application modules still issue direct Prisma Block operations:

- block creation/removal in `blockMutationAccess.ts`;
- pair checks in checkout preflight, commission interest, favorite creation,
  custom-order requests, message send and message start;
- account export;
- account deletion.

The shared `checkoutPairIsBlocked()` direct query is called by cart add, cart
quantity update, seller-group checkout, Buy Now, Buy Now resume and both
shipping-quote paths. The signed checkout/order authorities revalidate the pair
inside the database before committing paid-order state; these route checks are
early UX denials, not the final money invariant.

Commission, conversation and notification database authorities also recheck
the current relationship before committing their sensitive operation. Favorite
creation does not yet have an atomic database boundary; that separate gap is
recorded in the Favorite pre-RLS audit.

### Actor visibility filters

`grainline_user_block_targets()` returns only counterpart user IDs and optional
seller IDs for both directions. It deliberately hides direction, block ID and
timestamp. `blocks.ts` uses that operation across 23 application consumers,
including homepage, browse, tags, seller/listing/blog pages, search, commission
discovery and the account feed.

`grainline_user_blocked_account_page()` returns only outgoing blocks for the
authenticated blocker's account-management page, limited to 50 newest rows.
This is the only ordinary UI that may reveal block metadata and permit
unblocking.

### Service and cross-domain consumers

Current fixed database authorities read Block to enforce safety in these
families:

- Notification source creation and follower/listing/blog/broadcast fanout;
- Conversation creation, message send/read/inbox/unread state and custom-order
  messaging;
- checkout reservation, paid checkout completion, blocked-checkout refund and
  order eligibility;
- SellerProfile public cards, search, browse, map, recently viewed, feed,
  commission and participant projections;
- Follow creation/fanout and reciprocal cleanup;
- Favorite public counts and notification source validation;
- StockNotification creation, dispatch and block cleanup;
- commission interest/discovery and review/comment visibility.

Those functions must remain able to evaluate both directions after FORCE. The
activation package must derive an exact current `pg_proc` catalog of every
function whose body references `Block`, pin each signature/source/owner/mode/
search path/ACL, and fail closed if any current function is unclassified. A
historical migration text search is not a substitute because many functions
have later replacements.

The full 437-migration PostgreSQL 17 schema at the audited source contains
exactly 45 functions whose installed body directly references `Block`. All 45
deny `PUBLIC` execution. Forty-three are `SECURITY DEFINER` (including two
owner-private core functions) with the reviewed fixed-owner posture. Two
runtime-executable messaging projections are still `SECURITY INVOKER`:

- `grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)`;
- `grainline_message_unread_count(text)`.

Those two projections currently depend on the runtime role's direct `SELECT`
grant on `Block`. They cannot survive policyless FORCE unchanged; see
BLOCK-RLS-6.

### Mutation side effects

On block creation:

- the Block row and pair StockNotification cleanup commit together;
- checkout-session expiry runs after the response and is retryable through the
  signed checkout writer's final pair check/refund path;
- reciprocal Follow cleanup runs after the Block commit as a separate,
  best-effort transaction;
- all other discovery, message, fanout and checkout reads treat the durable
  Block row itself as authoritative immediately.

On unblock, removed relationships and checkout sessions are not restored.

### Export, deletion and retention

Account export currently includes both outgoing and incoming Block rows with
both user IDs and the timestamp. Account settings show only outgoing rows.

Account deletion deletes only rows the target created (`blockerId = target`).
Incoming rows are intentionally retained so another user's safety preference
is not erased when the blocked account is anonymized. Block target helpers hide
deleted counterparts, so retained rows do not make a deleted profile visible.
This matches the prior verified deletion-policy decision.

## Authority Matrix

| Operation | Principal | Intended scope | Final authority shape |
| --- | --- | --- | --- |
| Pair unavailable check | active actor | actor plus one target, boolean only | actor-bound fixed operation |
| Discovery filter targets | active actor | both directions, counterpart IDs only | retain actor-bound target operation |
| Blocked-account page | active blocker | outgoing newest 50 plus safe card fields | retain actor-bound page |
| Create block | active blocker | one distinct non-deleted target, including a suspended target | atomic actor-bound transition |
| Unblock | active blocker | exact actor-created direction | actor-bound delete transition |
| Notification/fanout filter | source-bound service | exact recipient/related pair | retain source-bound fixed functions |
| Checkout/order filter | current buyer or signed source event | exact buyer/seller pair | actor-bound preflight plus retained signed final authorities |
| Conversation/message filter | participant | exact participant pair | retain participant-bound authorities |
| Export | active owner | reviewed outgoing/incoming representation | actor-bound export operation |
| Account deletion | deletion worker acting as target | outgoing rows only | target-context delete-owned operation |

No ordinary principal needs direct UPDATE. No public principal needs any Block
row, and a blocked user must not receive the incoming row's direction or
metadata merely because they are one endpoint.

## Correctness, Privacy And Scale Findings

### BLOCK-RLS-1: a bidirectional SELECT policy reveals safety decisions

Classification: `BLOCKS_RLS_DESIGN`.

A policy such as `blockerId = app.user_id OR blockedId = app.user_id` is enough
to make filtering work, but it also lets an ordinary caller select the complete
incoming row and learn exactly who blocked them, when, and in which direction.
The current filtering helper deliberately returns an undirected counterpart
set instead. RLS must not weaken that privacy boundary.

### BLOCK-RLS-2: Follow cleanup is best effort and can resurrect on unblock

Classification: `FIX_BEFORE_ACTIVATION`.

Follow cleanup runs after the Block commits and its failure is logged but not
retried. While the Block remains, all reviewed fanout/feed paths exclude the
pair, so the failure is not an immediate communication bypass. It does leave a
stale Follow row in raw public counts. If the blocker later unblocks the other
user, that old relationship becomes active again even though neither person
chose to restore it.

The final block-create operation should delete both reciprocal Follow rows in
the same locked transaction as the Block and StockNotification cleanup, or
enqueue a durable idempotent cleanup that remains a prerequisite to unblock.
The single-transaction design is simpler and matches the current pair-lock
order.

### BLOCK-RLS-3: export exposes incoming blocker identity

Classification: `PRESERVE_PENDING_LEGAL_REVIEW`.

The current data export contains both directions, including the other user's
ID and timestamp, while the product UI intentionally hides incoming direction.
Changing a statutory/privacy export is outside a security activation. The
actor-bound replacement must preserve today's export until privacy counsel
decides whether incoming rows are the requester's personal data, third-party
safety data that should be withheld, or should be represented without the
other user's identity.

### BLOCK-RLS-4: incoming retention is intentional

Classification: `PRESERVE_DURING_SECURITY_RELEASE`.

Deletion removes outgoing rows and retains rows created by other users. A
generic `DELETE WHERE blockerId = target OR blockedId = target` cleanup would
erase another person's safety decision and regress the recorded deletion
policy. The target-context deletion operation must delete only outgoing rows.

### BLOCK-RLS-5: account-management pagination is bounded

Classification: `DEFERRED_PRODUCT_WORK`.

The blocked-account page shows only the newest 50 outgoing rows and has no next
page. This does not weaken enforcement or prevent unblocking by direct target,
but a user with more than 50 blocks cannot manage older entries in the UI.
Preserve the current cap in the security release; cursor pagination is a
separate UX change.

### BLOCK-RLS-6: two messaging projections break under policyless FORCE

Classification: `FIX_BEFORE_ACTIVATION`.

`grainline_conversation_inbox(...)` and
`grainline_message_unread_count(text)` are runtime-executable `SECURITY
INVOKER` functions. Each reads `Block` directly to hide blocked conversations.
After runtime table authority is revoked, the first such read raises
`permission denied for table Block`; policyless RLS cannot provide an
alternative row path.

This is execution-proven, not inferred: inside a rolled-back transaction on the
full-chain PostgreSQL 17 schema, enabling and forcing `Block` RLS, revoking the
runtime grant, setting `app.user_id`, and calling the unread projection failed
at its reciprocal `Block` predicate. The transaction rollback restored the
predecessor posture.

Before activation, replace the two direct reads with a bounded fixed-owner
boolean operation or convert the projections themselves to fixed-owner
operations with their existing participant and actor checks preserved. Do not
grant generic runtime `SELECT`, add a bidirectional disclosure policy, or
expose an arbitrary two-user block oracle merely to keep these projections
working.

## Concurrency And Recovery Requirements

- Create/delete replay remains idempotent.
- All mutations retain the sorted User-pair lock shared with Follow,
  Notification, Conversation and account lifecycle work.
- The durable Block becomes authoritative in the same transaction that removes
  pair Follow and StockNotification state.
- Paid checkout finalization continues to revalidate Block independently of
  app preflight and refunds a paid race winner rather than creating a normal
  order.
- After-response checkout-session expiry may fail without weakening the final
  database pair check; failure remains observable and retryable.
- Account deletion removes only outgoing rows and cannot erase incoming rows.
- Rollback restores predecessor runtime grants and direct application behavior
  before disabling/removing the new boundary.
- No security release drops columns, relationships or retained safety rows.

## Required Behavior Proof

The acceptance suite must run against the complete migrated PostgreSQL 17
schema and prove at least:

1. ordinary runtime and no-context direct SELECT/INSERT/UPDATE/DELETE fail;
2. active actor create, duplicate create, unblock and duplicate unblock;
3. self-block, missing target, deleted target, suspended actor and forged
   blocker rejection, while preserving the current ability to block a
   suspended non-deleted target;
4. outgoing account page never returns incoming rows and enforces its reviewed
   bound;
5. general target filtering returns both directions without revealing
   direction, block ID or timestamp;
6. actor pair-state returns only a boolean for one actor/target pair;
7. create serializes with Follow creation, Notification creation,
   Conversation/message creation and checkout in both lock schedules;
8. one committed create removes both reciprocal Follows and pair stock
   notifications atomically;
9. unblock never restores removed follows, subscriptions or sessions;
10. final checkout/order authority rejects or refunds a block that races app
    preflight;
11. every public/search/feed/message/commission/favorite/follow/stock service
    family retains its exact reciprocal-block filtering;
12. account deletion removes outgoing blocks, retains incoming blocks and hides
    deleted counterparts;
13. export preserves the reviewed current representation until legal review;
14. every installed function referencing Block has an accepted owner,
    SECURITY mode, search path, source identity and ACL;
15. inbox and unread projections still exclude blocked pairs under the runtime
    role after direct `Block` authority is revoked;
16. emergency rollback restores the exact predecessor application statements.

## Audit Decision

`GO` for isolated compatible preparation using accepted Option B, but `NO-GO`
for policy or grant activation. BLOCK-RLS-1 determines the privacy shape,
BLOCK-RLS-2 requires atomic dependent cleanup, and BLOCK-RLS-6 requires
replacing two invoker-mode messaging reads before activation. Preparation must
prove those fixes without changing predecessor grants or enabling RLS. See
`docs/block-rls-options.md` for the accepted boundary.
