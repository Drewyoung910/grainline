# Follow RLS Options

Date: 2026-10-28

Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

This comparison follows `docs/follow-pre-rls-audit.md`. Follow is mixed
private/aggregate data: the row identifies a user's private relationship, while
the marketplace intentionally exposes counts and performs cross-user fanout.

## Option A: Owner Policies Plus Fixed Cross-User Functions

Grant owner SELECT/INSERT/DELETE through policies on
`followerId = app.user_id`. Convert public counts, seller-owner incoming counts,
fanout and deletion of incoming seller rows to fixed functions.

Advantages:

- conventional row ownership is visible in the database policy;
- owner reads can remain relational when wrapped in transaction-local context;
- no denormalized counter can drift.

Costs and risks:

- every direct owner read still needs transaction-local context, including
  server components that currently run queries in parallel;
- public and seller counts still require functions, so the policy saves little
  conversion work;
- granting direct INSERT/DELETE duplicates product checks already enforced by
  the atomic create/delete functions;
- account deletion and fanout still need privileged fixed paths;
- a missing context fails closed as an apparently empty following state.

Conversion scope: nine direct application files, plus policy/grant and cleanup
proofs. Rollback restores predecessor CRUD and original direct reads.

## Option B: Zero Direct Runtime Authority With Existing Fixed Functions

Revoke direct runtime access, ENABLE and FORCE RLS without an ordinary table
policy, and keep all access behind the reviewed operation-specific functions.
Reuse the existing create/delete, public state, owner page/count/export,
fanout, broadcast and block-cleanup operations. Add only:

- a bounded public state batch for homepage counts/viewer state;
- a bounded actor follow-ID page for homepage/feed selection;
- an actor-bound raw outgoing count for the account overview;
- a seller-owner incoming follower count;
- a target-context account-deletion cleanup.

Advantages:

- smallest exposed SQL surface and no direct relationship-row disclosure;
- most complex operations already exist and have behavior tests;
- product predicates stay atomic with writes;
- public counts and delivery audiences remain distinct, explicit contracts;
- no counter, trigger or reconciliation job can drift;
- future callers fail clearly until they choose a reviewed operation.

Costs and risks:

- five purpose-bound operations must be added and maintained;
- function ownership, fixed search paths and ACLs are security-critical;
- a new product query needs a reviewed operation instead of arbitrary Prisma;
- indexed `COUNT(*)` work grows with a maker's follower count.

The count cost is acceptable for the present boundary: all count predicates use
`Follow_sellerProfileId_idx`, single-detail pages request one seller, and the
homepage can request a small bounded batch. If measured production scale later
justifies a cached counter, it can be added as a separate performance change
with reconciliation rather than embedded in this security release.

Rollback restores predecessor CRUD before disabling/removing the new boundary.
No columns or rows are dropped.

## Option C: Private Rows Plus A Maintained Public Counter

Keep relationship rows private and add a non-negative follower count to the
public seller projection. Update it transactionally on follow/unfollow, block
cleanup, account deletion and foreign-key cascades.

Advantages:

- constant-time public counts;
- public pages can sort/filter by count without touching private rows;
- clear scale characteristics for very large follower sets.

Costs and risks:

- triggers or every delete path must correctly cover block cleanup, account
  deletion, seller deletion and cascades;
- drift becomes possible and requires a reconciliation check and repair tool;
- one popular seller's counter row becomes a write hotspot;
- it changes the schema and write path even though no current page orders or
  filters sellers by follower count;
- fanout and owner state still require the same fixed functions.

This is a reasonable later performance option, not the safest activation
default without evidence that indexed counts are a bottleneck.

## Option D: Column-Level Privileges

Expose only `sellerProfileId` for aggregate reads while hiding `followerId`,
and serve owner state through functions.

This is not recommended. `COUNT(*)`, uniqueness and Prisma relation behavior
under column grants are brittle; unrestricted seller-ID scans still expose
relationship distribution beyond the intended bounded projections; writes and
fanout still need separate authority. It is neither a clean privacy boundary
nor simpler than Option B.

## Recommendation

Choose **Option B**.

Unlike Favorite, Follow has no public sort or pagination coupled to relation
counts, and its difficult cross-user operations are already behind fixed
functions. A maintained counter would therefore add consistency risk without
removing the fanout/owner-function work. Owner policies would still require
most direct callers to move while re-exposing a generic table interface the app
does not need.

Required safeguards:

- preserve the shared Block/follow lock order and atomic create predicate;
- add only the five bounded operations listed above;
- exact function-owner, SECURITY DEFINER, search-path and ACL checks;
- full-chain PostgreSQL 17 behavior, race, cascade and rollback proofs;
- a source inventory that rejects any remaining direct runtime Follow access;
- an emergency rollback that restores predecessor CRUD first;
- no counter, column drop or count-semantics change in the security release.

Option B was accepted for isolated compatible preparation on 2026-10-28. The
preparation may add the five bounded operations and convert callers, but it
does not authorize RLS activation, grant revocation, merge order changes or any
Production action. Favorite preparation releases first; Follow activation
still requires its own exact approval and evidence.
