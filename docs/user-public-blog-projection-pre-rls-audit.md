# User public blog projection pre-RLS audit

## Scope and exact source

This audit covers the public and authenticated-viewer blog paths that currently
reach `User` through `BlogPost.author` or `BlogComment.author`, plus the raw SQL
blog search, suggestion, and tag-aggregation paths. It is based on stacked local
source `971d42d3d2f591d45b765ef4889db755ead14a47`, whose accepted-main parent is
`b8db7552a9c8a01037d4214aa476008ac12437fc`.

The package is intentionally limited to public blog visibility and public
author labels. Staff moderation still needs private author email, owner editing
still uses the authenticated local User id, and follower delivery remains a
separate service family. This audit does not authorize publication, Production
SQL, deployment, User grants, User policies, ENABLE RLS, or FORCE RLS.

## Intended behavior

- A post is public only when it is `PUBLISHED`, has a non-future
  `publishedAt`, and its author account is active.
- A seller-linked post additionally requires an active, payable,
  supported-version, non-vacation seller.
- An approved comment is public only when its author account remains active.
- Viewer block filters apply before blog count, ranking, pagination, suggestion
  limits, comment limits, and related-post selection.
- Public post author output is limited to the local author id, public name,
  public image fallback, and the already public seller label/avatar when one
  exists.
- Public comment author output is limited to the local author id, public name,
  and the seller avatar or public image fallback. It retains the id needed for
  block/report actions.
- Banning or deleting an author removes their posts and comments from public
  reads in the same database transaction. Account deletion also keeps its
  existing post archival and comment redaction behavior.
- Clerk name/image updates and seller display/avatar updates continue to appear
  on visible blog content without application-side joins to `User`.
- Draft posts, future posts, archived posts, pending comments, moderation
  email, private account fields, and unrelated users do not become public.

## Current operation inventory

The schema-aware indirect inventory at this source reports 64 visible User
relation edges in 30 files. The public blog portion includes:

- `publicBlogPostWhere`, used by homepage, blog index/detail/author pages,
  sitemap, saved posts, reports, follower fanout, and API reads;
- raw User joins in both ranked blog searches, both fuzzy suggestion paths, and
  popular blog tag aggregation;
- public post-author labels on the homepage, blog pages, APIs, and saved posts;
- public approved-comment trees in the blog detail page and comments API; and
- parent-comment lifecycle checks before a new reply is accepted.

The current raw queries correctly filter author lifecycle before ranking or
limits. The replacement must preserve that ordering. Filtering snapshots after
the query would change result density, pagination, tag counts, and suggestions.

The same relations also appear in staff moderation. Those staff queries select
email and are outside this public package; they remain explicit blockers for
the later isolated staff projection.

## Authority matrix

| Operation | Principal | Required result | Boundary |
| --- | --- | --- | --- |
| Read/search/count a public post | Anonymous or active viewer | Visible blog row plus bounded public author label | `BlogPost` lifecycle/identity snapshot filtered in the database before order/count/page/limit |
| Read approved comment tree | Anonymous or active viewer | Approved visible comments plus bounded public author label | `BlogComment` lifecycle/identity snapshot filtered before each depth limit |
| Create a pending comment | Active authenticated user | Pending comment bound to the authenticated local User id | Existing `userClerkGate`; database trigger derives snapshots and rejects a missing author |
| Reply to an approved comment | Active authenticated user | Parent in the same visible post and active parent author | Snapshot lifecycle check on the parent/grandparent; existing depth flattening retained |
| Create/edit/archive a post | Active owner or staff under existing product rules | Owned post mutation | Existing local-id owner checks; database trigger derives author snapshots |
| Moderate posts/comments | PIN-authorized staff | Private author name/email and moderation state | Separate staff package; no public snapshot substitutes for private email |
| Change User or seller public identity | Identity webhook, account lifecycle, or seller owner | All affected blog snapshots become current atomically | Fixed definer triggers; no runtime-callable generic User lookup |

## Concurrency and lifecycle review

The accepted design stores only blog-bound public facts on the artifact row:

- `BlogPost`: author active state, User name/image, and current seller
  display/avatar fallbacks;
- `BlogComment`: author active state, User name/image, and current seller avatar
  fallback.

Binding triggers re-read and share-lock the source User and seller rows when a
post or comment is inserted. Existing artifacts cannot be rebound to a
different non-null author; account deletion can still clear a nullable post
author. Separate User-snapshot and seller-snapshot bind triggers prevent the
two lifecycle synchronizers from taking cross-source locks. User lifecycle and
identity updates synchronize authored posts and comments in the same
transaction. Seller insert/rebind/display/avatar/delete changes synchronize the
seller fallback fields in the same transaction. Trigger-owned fields cannot be
forged by ordinary writes.

This preserves the current live-label behavior. It also avoids a generic active
User projection, per-row application lookups, and post-pagination filtering.
The cost is bounded write amplification on rare identity/lifecycle changes.
Blog author content is already bounded by product rate limits, and the sync
updates use indexed `authorId` columns. If author fanout grows materially, the
future normalized public identity record remains the scale successor; it is not
needed for this release.

Account deletion archives authored posts, clears nullable post authors, and
marks comments unapproved/redacted. Snapshot triggers therefore fail closed
even before those product mutations complete, and nullable post authors retain
no public identity snapshot.

## Findings and decision

### `BLOCKS_RLS_DESIGN`: public blog reads still depend on User

The current nested relations and raw joins require broad runtime visibility of
`User`. They would fail under policyless User RLS and cannot be replaced by a
generic public User lookup without making unrelated active buyers enumerable.

### `FIX_BEFORE_ACTIVATION`: public comment reply checks re-enter User

Parent and grandparent validation reads `author.banned/deletedAt`. It must use
the same trigger-owned active snapshot as public comment rendering so reply
eligibility remains transactionally aligned with public visibility.

### `FIX_BEFORE_ACTIVATION`: public APIs must retain their response contract

The blog APIs currently return nested `author` objects. Source conversion may
query scalar snapshots, but it must map them back to the existing public JSON
shape so clients do not break.

### `DEFERRED_PRODUCT_WORK`: normalized cross-domain public identity

A single public identity table could reduce repeated snapshots across blog,
review, and commission domains. It would require its own visibility, pruning,
rename/image lifecycle, RLS, and enumeration design. This package keeps the
smaller domain-bound design and does not introduce that broader surface.

**GO for an isolated additive blog snapshot migration and source conversion.
NO-GO for publication, Production SQL, deployment, User grant revocation,
policies, ENABLE RLS, or FORCE RLS.**

The implementation gate is: preserve public filters before all counts/orders/
limits, preserve API shapes, retain staff email relations for the later staff
package, prove trigger convergence and tamper resistance in disposable
PostgreSQL, and re-run the exact indirect/raw inventories before proposing any
User activation.

## Local implementation checkpoint

The isolated successor now implements the accepted design on top of frozen
seller commit `971d42d3d2f591d45b765ef4889db755ead14a47`:

- migration `20261007010000_prepare_user_public_blog_state` adds ten bounded
  snapshot columns, four fixed runtime-private definer functions, and eight
  narrowly scoped triggers;
- public blog visibility, ranked search, suggestions, popular tags, homepage,
  saved posts, account feed and comment trees use those snapshots;
- API routes map scalar snapshots back to the existing nested author response;
- staff blog moderation retains its private name/email relation for its later
  isolated staff package; and
- visible comment counts now apply approved, active-author and viewer-block
  predicates consistently with comment rendering.

The schema-aware scanner reports zero direct User calls, 46 relation edges in
22 files, and five raw User SQL calls in four files. This package therefore
removes 18 relation edges across eight files and five raw calls across five
files from the seller-stack frontier. The remaining raw calls are commission,
block mutation, quality scoring and email-address service paths.

Validation completed locally on 2026-10-07:

- Prisma format and validation pass;
- targeted ESLint passes for every changed TypeScript/TSX file;
- 63 focused checks across the affected source, inventory and PostgreSQL suites
  pass; and
- disposable PostgreSQL proves backfill, User/seller synchronization, snapshot
  tamper resistance, nullable-author cleanup and PUBLIC privilege denial.

The CI workflow prepares, isolates, restores, applies and catalogs the blog
package after the seller snapshot predecessor. Publication, merge, Production
SQL, deployment, User grant changes, ENABLE and FORCE remain unapproved.
