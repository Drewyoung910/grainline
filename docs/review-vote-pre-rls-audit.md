# ReviewVote pre-RLS domain audit

Date: 2026-10-28  
Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`  
Decision: **GO for isolated A2 preparation after the blocking correctness
findings below are fixed; NO-GO for RLS or grant activation.**

This is a product, functionality, authority, privacy, concurrency, lifecycle,
scale, recovery, and rollback audit. It is not Production authorization.

## Intended product behavior

A helpful vote is a private, one-per-account relationship to a visible review.
An active signed-in buyer may toggle a helpful vote only when the review is
currently visible to that actor. The review author cannot vote for their own
review, and the listing's maker cannot vote on reviews of their own listing.
Reciprocal blocks hide the review or listing from the actor and must also stop
direct-by-id voting.

The public product displays and sorts by only `Review.helpfulCount`. It must not
reveal who voted. Account export may show a user their own vote history.
Account deletion removes that user's votes and must reduce the affected public
counts exactly once. Review deletion removes the parent and its votes by
cascade, so no surviving count remains to repair.

No workflow updates a vote. `value` is always `1`; insert and delete are the
only valid row mutations.

## Current schema and authority

`ReviewVote` has four columns: `reviewId`, `userId`, `value`, and `createdAt`.
Its composite primary key is `(reviewId, userId)`. Both foreign keys cascade on
parent deletion. RLS is off and the ordinary runtime role receives broad CRUD
through predecessor provisioning.

The schema currently lacks:

- a check that `value = 1`;
- an index beginning with `userId`, despite owner rendering, export, and
  account deletion all filtering by `userId`; and
- a database invariant tying `Review.helpfulCount` to the number of vote rows.

## Complete current consumer inventory

Four application files issue all six direct `ReviewVote` operations:

1. `src/app/api/reviews/[id]/vote/route.ts`
   - owner-pair `findUnique`;
   - idempotent pair `deleteMany`; and
   - pair `create`.
   The same transaction increments or decrements `Review.helpfulCount`.
2. `src/components/ReviewsSection.tsx`
   - reads the signed-in viewer's vote rows for at most the 100 rendered review
     ids so buttons have correct initial state.
3. `src/app/api/account/export/route.ts`
   - exports all rows owned by the account, ordered by `createdAt DESC`, with a
     bounded parent listing id projection.
4. `src/lib/accountDeletion.ts`
   - deletes all rows owned by the account inside the local anonymization
     transaction.

There are no direct staff, seller, cron, webhook, repair-job, raw-SQL, or
analytics reads of voter identity. No Prisma query includes the `votes`
relation. Public review lists and ordering read only `Review.helpfulCount`.

The route separately calls
`grainline_seller_public_review_vote_target(text)` through
`sellerPublicReviewVoteTarget()`. That function validates the active actor and
listing/seller visibility and returns only the exact review, reviewer, current
count, listing, and seller identifiers. The visibility check and the later
vote mutation are separate transactions.

## Authority matrix

| Operation | Principal | Intended scope | Required final authority |
| --- | --- | --- | --- |
| Read initial voted state | active account | own rows among at most 100 rendered review ids | owner `SELECT` under transaction-local context |
| Toggle vote | active account | one currently visible non-self review, not own listing, no reciprocal block | atomic actor-bound fixed operation |
| Read public count/order | public or signed-in viewer | scalar aggregate only | existing `Review.helpfulCount`; no vote-row access |
| Export vote history | active account | own rows only with bounded parent projection | owner-context export/read |
| Account deletion | deletion workflow acting as target | all target-owned rows plus exact count repair | target-bound fixed deletion operation |
| Review deletion | reviewed parent lifecycle | cascade rows with deleted parent | FK cascade; prove under FORCE |
| User hard deletion | reviewed account lifecycle | cascade target-owned rows plus surviving review count repair | fixed cleanup before hard delete or trigger-backed invariant |

No seller or staff operation needs voter identities. No ordinary operation
needs direct `INSERT`, `UPDATE`, or `DELETE` after preparation.

## Findings and gates

### RV-RLS-1 / C-1196: account deletion permanently inflates helpful counts

Classification: `FIX_BEFORE_ACTIVATION`.

`accountDeletion.ts` deletes the target user's vote rows without decrementing
or recomputing the surviving reviews' `helpfulCount`. The account is retained
as an anonymized row, so the foreign-key cascade does not repair this later.
Top-review ordering can therefore remain inflated after deletion.

Preparation must replace the raw delete with one set-based, target-bound
operation that locks the affected reviews, removes only the actor's rows, and
repairs each count in the same transaction. Before migration, run a read-only
inventory comparing every stored count to `count(ReviewVote)` and repair exact
drift under review.

### RV-RLS-2: direct-by-id voting ignores reciprocal blocks

Classification: `FIX_BEFORE_ACTIVATION`.

Listing pages hide a blocked seller and filter reviews from blocked reviewers.
The current vote-target function checks actor and listing visibility but does
not inspect `Block`. A signed-in user who knows a review id can therefore vote
on a review whose author is blocked or whose listing maker is blocked.

The fixed toggle must re-check reciprocal blocks against both the review author
and listing maker under the same lock protocol as the write. Block creation
must either remove affected votes and repair counts or durably document that
past anonymous votes remain; new votes cannot be admitted across the block.

### RV-RLS-3: eligibility is check-then-write

Classification: `FIX_BEFORE_ACTIVATION`.

The target authority runs before the Prisma transaction. Review visibility,
seller availability, account state, block state, or parent deletion can change
before the row is inserted. The final operation must own the decision and the
mutation under one database transaction and one reviewed lock order.

### RV-RLS-4: the cached count has no database invariant

Classification: `BLOCKS_RLS_DESIGN`.

Only the API route maintains `Review.helpfulCount`. Direct predecessor writes,
account deletion, repairs, or future cascades can drift it. Because public
sorting depends on the scalar, activation cannot merely hide the rows; it must
prove exact backfill, atomic maintenance, non-negative counts, and a
reconciliation query before and after activation and rollback.

### RV-RLS-5: vote value is unconstrained

Classification: `FIX_BEFORE_ACTIVATION`.

Application code always writes `1`, but broad predecessor authority and future
code can write another integer. Add and preflight `CHECK (value = 1)` after a
read-only inventory. Do not silently coerce unknown historical values.

### RV-RLS-6: owner paths lack a supporting index

Classification: `FIX_BEFORE_ACTIVATION`.

The primary key begins with `reviewId`; rendering, export, and deletion begin
with `userId`, and export orders by `createdAt DESC`. Add a reviewed
`(userId, createdAt DESC, reviewId)` index and prove the intended owner queries
remain bounded as the vote table grows.

### RV-RLS-7: current tests do not execute the behavior

Classification: `FIX_BEFORE_ACTIVATION`.

`tests/review-vote-visibility.test.mjs` matches route source text. It does not
execute the route, database target, mutation, deletion repair, cross-user
denial, count maintenance, or races. RLS preparation needs failing-first
PostgreSQL 17 behavior tests on the complete migration chain.

### RV-RLS-8: banned-user vote retention is undefined

Classification: `DEFERRED_PRODUCT_WORK`.

Banning an account does not remove its earlier votes, so they continue to
affect top-review ordering. This is not an RLS bypass, but moderation should
decide whether prior votes remain. Preparation must preserve today's behavior
unless a separately reviewed product decision changes it.

## Concurrency, recovery, and scale requirements

- Toggle must serialize on the exact review and actor pair. Concurrent double
  toggles must converge without double increment/decrement.
- The count must be changed only when the row mutation actually changes one
  row. Duplicate/replayed requests return the current authoritative state.
- Block, ban/deletion, review removal, listing archive/private transition, and
  seller-availability races must be exercised in both winner orders.
- Account deletion must be set-based or bounded and must not scan the entire
  table. Its retry must not decrement a count twice.
- Owner render reads remain bounded to the rendered review ids. Export and
  deletion need the new owner-leading index.
- A reconciliation operator must report row/count drift without voter ids or
  review text in evidence.
- Rollback restores predecessor grants before disabling/removing the new
  boundary, then proves the predecessor route statements and exact counts.

## Required acceptance proof

The complete migrated PostgreSQL 17 schema must prove at least:

1. one active non-owner can toggle a visible review and receives the exact
   post-mutation count;
2. duplicate and concurrent add/remove schedules do not drift the count;
3. reviewer self-vote and listing-owner vote are denied;
4. banned/deleted/no-context actors are denied;
5. private, hidden, archived, unavailable-seller, blocked-reviewer, and
   blocked-seller targets are denied;
6. owner A cannot select owner B's vote rows;
7. direct runtime insert, update, and delete are denied after activation;
8. rendered initial state and account export return only the actor's rows;
9. account deletion removes only the target's votes and repairs every affected
   count exactly once across retry;
10. Review and User hard-delete cascades preserve the count invariant;
11. value constraint and owner index match the reviewed catalog;
12. public top-review ordering still follows the repaired scalar count;
13. the inventory/reconciliation check is empty after backfill and mutations;
14. rollback restores predecessor statements and a later reactivation passes
    the same behavior proof.

## Audit decision

Option A2 in `docs/review-vote-rls-options.md` is the correct long-term shape:
owner-only `SELECT`, fixed toggle, fixed account-deletion cleanup, and the
public scalar aggregate. The domain is small, but it is not safe to activate
until count drift, block semantics, atomic eligibility, the missing constraint,
and the owner-leading index are closed with executed full-chain behavior proof.

`GO` for an isolated compatible preparation that fixes those items without
changing RLS or predecessor grants. `NO-GO` remains for activation, merge of an
RLS migration, or any Production operation.

