# Follow Pre-RLS Domain Audit

Date: 2026-10-28

Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

Status: isolated activation candidate prepared; no Production action is authorized by this audit

## Intended Product Behavior

`Follow` records a private relationship between the signed-in follower and a
maker. A follower may follow an active, Stripe-ready maker other than
themselves when neither party has blocked the other. Follow and unfollow are
idempotent. Blocking either direction removes both possible follow
relationships and prevents a replacement relationship from being created.

The relationship row is private. Grainline intentionally publishes only an
aggregate follower count and uses eligible follower IDs for the signed-in
feed, listing/blog announcements and seller broadcasts. A maker does not get a
general list or export of follower identities.

No product workflow updates a Follow row. The only valid row mutations are
insert and delete. `createdAt` is immutable.

## Schema And Current Authority

`Follow` has a generated `id`, unique `(followerId, sellerProfileId)`, indexes
on both foreign keys, cascading foreign keys to `User` and `SellerProfile`, and
`createdAt`. RLS is off. The ordinary runtime provisioning block still gives
the table broad CRUD authority even though current writes already use fixed
database functions.

The table alone does not enforce these product invariants:

- the follower is active;
- the seller is active and Stripe-ready;
- the follower is not the seller;
- neither party has blocked the other;
- `createdAt` is immutable.

`grainline_seller_public_follow_create(text,text)` enforces those invariants in
one operation. It takes the shared sorted user-pair lock, revalidates the
seller after the lock, checks reciprocal blocks, inserts idempotently and
returns the raw current count. The block path uses the same pair lock, and
`grainline_user_block_follow_cleanup(text)` removes both reciprocal follow
directions in the same transaction that creates the durable Block. The Block
and cleanup therefore commit or roll back together. This closes the
block/follow race without leaving a post-commit repair window.

## Complete Current Consumer Inventory

Nine application files still issue direct Prisma Follow operations. The
remaining sensitive consumers already use fixed functions.

### Public count and viewer state

Direct raw counts plus an optional owner-state lookup remain on:

- seller profile;
- seller shop;
- listing detail;
- maker-authored blog detail;
- homepage maker spotlights.

The homepage also directly reads the signed-in viewer's latest 50 followed
seller IDs for "Makers You Follow" and groups public counts for the featured
makers.

The existing `grainline_seller_public_follow_state(text)` already returns one
visible seller's raw follower count and transaction-local viewer state without
exposing relationship rows. It preserves the current count contract: all
surviving Follow rows count, including a banned follower until their account is
deleted. A bounded batch form is still needed for the homepage to avoid an
N+1 query.

### Owner state and owner history

- `/account` directly counts the actor's outgoing follows.
- `/api/account/feed` directly reads up to 1,000 followed seller IDs, then
  applies reciprocal-block and seller-visibility checks through
  `grainline_seller_actor_account_feed_cards(text[])`.
- `/account/following` already uses actor-bound count/page functions.
- account export already uses `grainline_seller_owner_follow_export()` and
  intentionally includes inactive followed shops.
- follow GET/POST/DELETE already use actor-bound fixed functions. Follow and
  unfollow responses return the authoritative raw count.

The feed's current 1,000-follow ceiling is product behavior that a security
release must preserve. Replacing it with an unbounded read would create a
separate scale change.

### Seller owner state

The seller dashboard directly counts incoming followers. It must continue to
show the count to the owner when the shop is temporarily unavailable; the
public-state function is therefore not an adequate replacement because that
function deliberately hides unavailable sellers.

### Fanout and service reads

- The deployed predecessor pages listing and blog publication through
  `grainline_user_follower_notification_page(text,text,integer)`. Compatible
  preparation moves both callers to
  `grainline_follow_source_notification_page(text,text,text,integer)`, which
  first binds the page to the exact public listing or published maker post,
  then pages by Follow ID, rejects inactive followers, excludes self-follow
  data and applies reciprocal blocks. The predecessor function remains only
  until activation so the already-deployed app stays compatible.
- Seller broadcasts use the actor-bound
  `grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)`,
  including preferences and the optional sellers-only filter.
- Notification creation independently validates the source relationship and
  its current block/account state before inserting the recipient notification.
- SellerProfile account-feed card validation rechecks follow membership,
  seller visibility and reciprocal blocks before any returned feed item is
  rendered.

These operations intentionally read cross-user Follow rows. An owner-only
policy cannot be allowed to alter their result sets.

### Cleanup and lifecycle

- Account deletion directly deletes outgoing Follow rows. For a seller it also
  directly deletes all incoming rows before SellerProfile anonymization.
- Creating a Block calls the fixed reciprocal follow cleanup in the same
  transaction as the Block insert.
- Hard deletion of User or SellerProfile cascades Follow rows.
- Unblocking does not restore prior follows.

The final boundary must prove both explicit cleanup and foreign-key cascades
under ENABLE plus FORCE; it must not assume table-owner behavior represents the
runtime role.

## Authority Matrix

| Operation | Principal | Intended scope | Final authority shape |
| --- | --- | --- | --- |
| Read one public count/state | anonymous or active viewer | aggregate plus own boolean | retain single public projection |
| Read bounded public counts/states | anonymous or active viewer | requested visible seller IDs only | bounded batch projection |
| Follow | active owner | one eligible non-owned seller, no reciprocal block | retain atomic actor-bound create |
| Unfollow | active owner | own exact relationship | retain actor-bound delete |
| Read account overview count | active owner | own raw relationships | actor-bound raw aggregate |
| Read following page count/page | active owner | own visible relationships | retain actor-bound operations |
| Read feed target IDs | active owner | own latest 1,000 relationships | bounded actor operation |
| Export | active owner | complete own history plus display name | retain actor-bound export |
| Read seller follower count | verified seller | own incoming raw count | seller-owner aggregate operation |
| Listing/blog fanout | service | eligible recipients for exact public listing or published maker post | exact-source bounded service page; retire predecessor seller-id page at activation |
| Seller broadcast audience | verified seller | eligible own audience | retain actor-bound audience page |
| Block cleanup | blocker | both follow directions for locked pair | retain fixed cleanup operation |
| Account deletion | deletion worker acting as target | outgoing plus incoming seller rows | target-context cleanup operation |

No ordinary principal needs direct UPDATE. No public, seller or service
principal needs direct access to follower/seller pairs.

## Correctness, Privacy And Scale Findings

### FOLLOW-RLS-1: direct reads would silently change under owner policies

Classification: `BLOCKS_RLS_DESIGN`.

Public counts, homepage grouped counts, seller-owner incoming count and fanout
all intentionally read other users' rows. Applying `followerId = app.user_id`
before converting those paths would return plausible but wrong values rather
than an access error: counts become zero or one, and fanout reaches nobody.

### FOLLOW-RLS-2: account deletion requires two ownership directions

Classification: `FIX_BEFORE_ACTIVATION`.

A non-seller deletes rows where `followerId` is the target. A seller must also
delete every row whose `sellerProfileId` is their shop. A follower-owner policy
cannot perform the second deletion. The final cleanup operation must bind the
target to transaction-local deletion context, delete both directions in one
transaction and be proved across multiple batches or an explicitly bounded
single statement.

### FOLLOW-RLS-3: raw count and eligible audience are different contracts

Classification: `PRESERVE_DURING_SECURITY_RELEASE`.

Public counts currently include every surviving Follow row. Fanout excludes
banned/deleted followers and reciprocal blocks. This difference is deliberate:
one is a raw public popularity counter, while the other is a delivery audience.
The security release must not quietly redefine the public number. A future
product change may choose an eligible-follower count, but it needs a separate
backfill, copy review and ranking-impact decision.

### FOLLOW-RLS-4: fixed functions already cover most of the hard boundary

Classification: `DESIGN_INPUT`.

Follow creation/deletion, owner history, export, block cleanup, fanout,
broadcast audience and feed-card revalidation are already fixed operations with
tests. Replacing those operations with a new maintained counter or a broad
owner-table grant would add more failure modes than the remaining conversion
requires.

### FOLLOW-RLS-5: feed and following pages have explicit ceilings

Classification: `DEFERRED_PRODUCT_WORK`.

The account feed considers at most 1,000 followed sellers and the following
page caps offset at 19,980. These are well above current use but are not an
unbounded long-term design. Preserve them in the security release and add
monitoring before an account approaches either ceiling; cursor pagination is a
separate product/scale change.

## Concurrency And Recovery Requirements

- Follow and unfollow replay remain idempotent.
- Follow creation continues to share the sorted user-pair lock with Block and
  account lifecycle transitions.
- A committed Block can never coexist with a newly created reciprocal Follow.
- Seller/account deletion cleanup is all-or-nothing with the local deletion
  transition, and cascades still work under FORCE.
- Public counts and mutation responses use the same raw-row contract.
- Fanout pages preserve stable ID ordering so retrying after a partial page
  neither skips nor repeats eligible relationships beyond downstream source
  deduplication.
- Rollback restores predecessor runtime grants before disabling/removing the
  new boundary. No security release drops Follow columns or historical rows.

## Required Behavior Proof

The acceptance suite must run against the complete migrated PostgreSQL 17
schema and prove at least:

1. no-context and ordinary runtime direct SELECT/INSERT/UPDATE/DELETE fail;
2. active owner follow, duplicate follow, unfollow and duplicate unfollow;
3. self-follow, inactive actor, unavailable seller and reciprocal-block denial;
4. block-vs-follow races in both lock schedules, including cleanup of an
   existing relationship;
5. public single and batch counts retain raw-row semantics and disclose no
   follower IDs;
6. a viewer sees only their own follow-state boolean;
7. account page, following page, homepage, seller profile/shop, listing detail
   and maker-blog detail retain correct counts and viewer state;
8. feed target selection preserves the 1,000 cap, order and reciprocal-block
   behavior, with feed-card revalidation after seller state changes;
9. listing/blog fanout and seller broadcasts reach all eligible followers,
   exclude inactive/blocked/self rows, and page without gaps;
10. seller dashboard reads its own incoming raw count even while the public
    shop is unavailable;
11. account export includes the actor's inactive-shop history but never another
    user's history;
12. target account deletion removes outgoing and incoming seller rows without
    touching unrelated relationships;
13. User and SellerProfile foreign-key cascades work under ENABLE plus FORCE;
14. function owner, SECURITY DEFINER, fixed search path, signature and ACL
    checks pass, and no unreviewed function can read Follow;
15. emergency rollback restores the exact predecessor app statements.

## Audit Decision

`GO` for isolated review of the policyless activation candidate, and `NO-GO`
for Production activation until the preparation/app release, deployment-skew
drain, exact-head review, protected release wiring and explicit Production
approval are complete.

The compatible preparation closes FOLLOW-RLS-1 by converting all nine direct
application consumers to fixed operations. It closes FOLLOW-RLS-2 with the
target-context account-deletion cleanup covering both outgoing and incoming
seller relationships. The preparation proof covers the shared Block/follow
lock order in both two-session schedules, atomic Block cleanup, actor rechecks,
raw-count semantics and prepared cleanup behavior.

The isolated `20261028060000_activate_follow_rls` candidate then revokes all
ordinary runtime and PUBLIC table authority and applies policyless ENABLE plus
FORCE. Its full-chain PostgreSQL 17 proof applies all 439 migrations and proves
direct SELECT/INSERT/UPDATE/DELETE denial, fixed create/delete/read behavior,
account-deletion cleanup, User and SellerProfile cascades, database-first
rollback, and a second activation after rollback. The migration preflight pins
the exact table shape and all 18 functions whose bodies reference `Follow`,
including owner, mode, volatility, search path and ACL posture, and rejects an
unreviewed reader. No table, column, function, trigger or row is dropped.

This evidence is source readiness only. Production remains unchanged.
