# User public review and commission pre-RLS audit

## Scope and exact source

This audit covers public `Review` reviewer identity/lifecycle reads and public
`CommissionRequest` buyer identity/lifecycle/location reads. It is based on
stacked local source `d9f3ebd2b2df66de99e50796d289955859841509`, whose
parent is the frozen seller package
`971d42d3d2f591d45b765ef4889db755ead14a47`.

The scope includes review aggregates, rendered review cards, customer-photo
visibility, commission browse/detail/API reads, the distance-ranked commission
query, and commission-interest admission. It excludes staff review views,
block/email service paths, follower jobs, installed database catalog
reconciliation, grants, policies, and User RLS activation.

## Intended behavior

- Public review aggregates, lists, structured data, and customer photos include
  only reviews whose reviewer account is active and is not blocked by the
  current viewer.
- Review cards expose only the retained reviewer id, public name/image, rating,
  review content, photos, helpful state, and seller reply.
- A signed-in buyer can still see and edit their own retained review under the
  existing owner and 90-day rules.
- Public commission lists, detail pages, APIs, distance counts, ranking, and
  pagination include only open, unexpired requests from active buyers who are
  not blocked by the current viewer.
- Commission buyer output remains limited to the local buyer id plus public
  name/image. The existing non-national location label remains the buyer's
  seller-profile city/state when available; otherwise it retains the current
  fallback.
- Commission-interest admission rechecks the buyer account lifecycle before
  any block check or durable interest/message operation.
- User name/image, ban, deletion, and seller city/state lifecycle changes
  update artifact-bound public snapshots in the same database transaction.
- Account deletion continues to close and redact commission requests, remove
  review photos/comments as currently defined, and replace public identity
  snapshots through the existing User/seller lifecycle updates.

## Current measured boundary

The schema-aware indirect inventory on the exact source reports zero direct
User delegate calls, 46 visible User relation edges in 22 files, and five raw
User SQL calls in four files.

This package owns 18 of those relation edges:

- seven commission edges across five public commission callers;
- eleven review edges across four public review/customer-photo callers; and
- the typed `openCommissionBaseWhere` buyer lifecycle relation.

It also owns both remaining raw User joins in
`src/app/commission/page.tsx`. The target frontier after conversion is 28
relation edges in 13 files and three raw calls in three files, with the typed
commission relation removed. The exact post-change scanner result remains a
release gate rather than an assumption.

## Authority matrix

| Operation | Principal | Required result | Boundary |
| --- | --- | --- | --- |
| Read/count public reviews | Anonymous or active viewer | Visible review rows and bounded reviewer labels | `Review` lifecycle snapshot filtered before aggregate/order/limit; viewer block filter remains on `reviewerId` |
| Read customer photos | Anonymous or active viewer | Photos only from visible reviews/listings | Review lifecycle snapshot remains inside the nested photo predicate before count/page/limit |
| View or edit own review | Active reviewer | The review owned by the current local User id | Existing `reviewerId` owner predicate; bounded snapshot supplies display only |
| Create a review | Eligible active buyer | One verified review bound to the locked eligible Order item | Existing actor gate and Order lock; insert trigger derives reviewer snapshots |
| Read/search/count commissions | Anonymous or active viewer | Open, unexpired visible requests and bounded buyer labels | `CommissionRequest` lifecycle snapshot filtered before count/rank/page/limit |
| Read non-national location label | Anonymous or active viewer | Existing seller-profile city/state fallback | Commission-bound city/state snapshot synchronized from the buyer's seller profile |
| Express commission interest | Active eligible seller | Interest only for an active buyer and unblocked pair | Buyer lifecycle snapshot checked before existing block and fixed interest/message authority |
| Change User or seller public identity | Identity/account lifecycle or seller owner | Affected snapshots converge atomically | Fixed definer triggers; no generic runtime User lookup |
| Staff review moderation | PIN-authorized staff | Private reviewer name/email and moderation context | Separate staff package; no public snapshot substitutes for private fields |

## Concurrency and lifecycle design

`Review` needs three trigger-owned fields: reviewer account-active state, public
name, and public image. `CommissionRequest` needs five: buyer account-active
state, public name/image, and buyer-seller city/state.

Artifact inserts bind snapshots from their immutable actor id. Rebinding an
existing review or commission to another actor is rejected. User lifecycle and
identity updates synchronize both artifact families. Seller create/rebind,
city/state update, and delete events synchronize only commission location
snapshots. Separate User-field and seller-field bind triggers avoid
cross-source lock order in the ordinary lifecycle paths.

Public filters must use account-active snapshots inside the database query.
Filtering rows after count, aggregate, distance rank, or pagination would
change product behavior and can expose inactive-author density. Viewer block
filters stay on retained actor ids and therefore do not require User reads.

The snapshots are display and eligibility facts, not a generic public identity
directory. They are reachable only through an existing review or commission
artifact. Fixed trigger functions must be `SECURITY DEFINER`, use
`search_path = pg_catalog`, have PUBLIC execute revoked, and remain in the
runtime-private grant inventory.

## Findings and decision

### `BLOCKS_RLS_DESIGN`: public review reads still traverse User

Review lifecycle filters and public reviewer labels currently require nested
`Review.reviewer` reads. A broad User SELECT policy would expose unrelated
account rows and is rejected.

### `BLOCKS_RLS_DESIGN`: commission visibility and distance search still use User

The shared open-commission filter, five public callers, and both distance-query
User joins depend on buyer lifecycle/name/image. They must move to bounded
CommissionRequest snapshots without changing pre-limit filtering.

### `FIX_BEFORE_ACTIVATION`: commission location must retain current lifecycle

Non-national detail metadata currently reads seller city/state through the
buyer relation. The replacement must synchronize seller creation, ownership
rebind, city/state updates, and deletion; a one-time backfill alone would go
stale.

### `FIX_BEFORE_ACTIVATION`: public API shapes must remain stable

Commission APIs currently return nested `buyer` objects. Scalar snapshots may
replace the query relation, but responses must map back to the same nested
shape.

**GO for one isolated additive review/commission snapshot migration and source
conversion. NO-GO for publication, Production SQL, deployment, User grant
revocation, policies, ENABLE RLS, or FORCE RLS.**

The implementation gate is: preserve every lifecycle/block predicate before
aggregate/count/order/page/limit, preserve public API shapes, retain owner and
staff authority boundaries, prove backfill/synchronization/tamper resistance
in disposable PostgreSQL, register all fixed functions as runtime-private, and
re-run the exact indirect/raw inventories.

## Local implementation checkpoint (2026-10-07)

The scoped conversion is implemented in this isolated worktree. The exact
schema-aware inventory now reports zero direct delegates, 28 relation edges in
13 files, and three raw User SQL calls in three files. Both public commission
raw joins and the typed buyer lifecycle relation are gone. Prisma format and
validation pass. Ten focused source/PostgreSQL checks pass, including backfill,
same-transaction User and seller synchronization, forged-snapshot overwrite,
actor-rebind rejection, and PUBLIC execute denial. CI restore/apply/catalog and
grant-audit stages are ordered after the public-blog predecessor. Publication,
Production SQL, deployment, grants, ENABLE, and FORCE remain unapproved.
