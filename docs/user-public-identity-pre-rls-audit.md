# User public-identity pre-RLS audit

## Scope and exact source

This audit covers the public and relationship-authorized application paths that
read `User` display identity or use `User` account state to decide whether
marketplace content is visible. It is based on exact merged main
`d8a6d1c4b96f12015b6f329140b7e4b7a0054914` in isolated worktree
`.worktrees/user-public-identity-20261004` on 2026-10-04.

The audit is a bounded part of the wider `User` identity/account audit in
[`docs/user-identity-rls-audit.md`](user-identity-rls-audit.md). It does not
authorize a public identity design, source conversion, Production SQL,
deployment, table grants, policies, or User ENABLE/FORCE RLS. Merged-main CI
`37190758630` completed successfully on this exact source before implementation
continued.

## Intended behavior

Public and relationship-authorized reads must:

- expose a person's name or image only through a visible marketplace artifact
  or relationship that already needs that identity, such as a published blog
  post, approved public comment, visible review, open commission request, or
  active seller profile;
- never expose Clerk id, email, role, shipping address, legal acceptance,
  notification preferences, ban reason, deletion evidence, or provider state;
- hide content from banned or deleted authors, buyers, reviewers, and sellers;
- preserve the stricter domain state that accompanies active account state;
- preserve viewer block filters on authenticated public and owner pages;
- perform visibility filtering before count, ordering, ranking, pagination, or
  bounded selection;
- keep anonymous reads anonymous and derive authenticated viewer identity only
  from the server-verified Clerk subject;
- fail closed when an authority result is missing, malformed, or ambiguous;
  and
- remain bounded at launch scale without loading the `User` table or an
  unbounded id set into application memory.

An active account means `banned = false AND deletedAt IS NULL`. That predicate
is necessary but not sufficient for public content:

- listing grids require `ACTIVE`, non-private listings and an active, payable,
  supported-version, non-vacation seller;
- listing detail additionally permits public `SOLD_OUT` listings, while private
  custom listings retain their owner/reserved-buyer/staff rules;
- seller pages require an active, payable, supported-version seller, with
  vacation mode excluded on surfaces that promise current availability;
- blog results require `PUBLISHED`, a non-future publication time, an active
  author, and an active seller when the post is seller-linked;
- public reviews require an active reviewer plus the current listing/seller and
  viewer-block rules; and
- public commissions require `OPEN`, non-expired requests from an active buyer,
  while visible interest counts include only active public sellers.

## Exact current-source inventory

`node scripts/audit-user-direct-calls.mjs --json` reports 31 direct delegates in
16 files: 19 `findUnique`, three `findMany`, one `findFirst`, three `count`, two
`update`, and three `updateMany` calls. Only two belong to this public family:

| Caller | Operation | Current rule |
| --- | --- | --- |
| `src/app/about/page.tsx` | member count | `banned = false` |
| `src/lib/homepageStats.ts` | cached member count | `banned = false AND deletedAt IS NULL` |

The other 29 direct delegates belong to staff/admin, message and custom-order
eligibility, seller-owner preferences, ban/repair, or account-deletion
families. They must remain in those separately reviewed packages.

The exact raw-SQL scan reports 27 `FROM`, `JOIN`, or `UPDATE` references to
`"User"` across 16 source files. Twenty-three references across twelve files
belong to public catalog, identity, or aggregate behavior:

| Family | Files | Raw references | Purpose |
| --- | ---: | ---: | --- |
| Listing/seller discovery | `src/app/page.tsx`, `src/app/browse/page.tsx`, `src/app/api/listings/[id]/similar/route.ts`, `src/app/api/search/suggestions/route.ts`, `src/lib/popularTags.ts`, `src/lib/quality-score.ts`, `src/lib/site-metrics-snapshot.ts` | 10 | active-seller filtering before selection, ranking, count, or suggestion limits |
| Blog discovery | `src/app/blog/page.tsx`, `src/app/api/blog/search/route.ts`, `src/app/api/blog/search/suggestions/route.ts`, `src/app/api/search/suggestions/route.ts`, `src/lib/popularBlogTags.ts` | 10 | active-author and seller-linked visibility before search, tag aggregation, ordering, and limits |
| Commission discovery | `src/app/commission/page.tsx` | 3 | active buyer identity and active public-seller interest counts |

The four remaining references are intentionally outside this family:
`src/app/api/listings/[id]/stock/route.ts`, `src/lib/accountDeletion.ts`,
`src/lib/blockMutationAccess.ts`, and `src/lib/userEmailAddresses.ts`.

### Relation-backed public and relationship reads

The public family also reaches `User` through Prisma relations. The reviewed
clusters are:

- seller and listing discovery: home, tag, browse, metro/category browse,
  listing detail, seller profile/shop/customer photos, maker pages and map
  cards, recently viewed listings, similar makers, account following, saved
  listings, and commission cards;
- blog discovery: blog index/detail/author, comment trees, blog search and
  suggestions, saved posts, and the mixed account feed;
- review display: listing and seller review aggregates/pages, reviewer public
  identity, photos, viewer votes, and seller-reply identity;
- commission discovery: open commission index/detail/API results and active
  interested-seller counts; and
- shared predicates in `listingVisibility.ts`, `sellerVisibility.ts`,
  `blogVisibility.ts`, `commissionState.ts`, `commissionInterestCount.ts`, and
  `savedListingVisibility.ts`.

The identity fields actually needed by these paths are bounded:

- sellers: local User id for relationship/block checks and `imageUrl` only as a
  fallback when `SellerProfile.avatarImageUrl` is absent;
- blog authors and approved commenters: local User id, `name`, and `imageUrl`;
- reviewers: local User id, `name`, and `imageUrl`;
- commission buyers: local User id, `name`, and `imageUrl`; and
- visibility-only joins: active/inactive outcome without any returned User
  identity.

An active User row alone is not a public profile. A buyer who has never
published a blog post, approved comment, review, commission request, or seller
profile must not become enumerable merely because runtime needs to evaluate
other users' visible content.

## Current boundedness and ordering

The reviewed callers already apply material bounds that the authority design
must retain:

- customer photos use a 24-row page and cap the requested page at 500;
- similar listings filter active users inside SQL before ordering and
  `LIMIT 24`, then return at most twelve scored results;
- listing and blog suggestion SQL applies active-user and block predicates
  before its two- or three-row limits;
- visible review aggregation and bounded review selection apply active reviewer
  and block filters before counting or ordering;
- account feed caps followed sellers at 1,000 and each page at 50 while applying
  seller/author visibility before merging the feed; and
- quality scoring cursor-pages public listings in batches of 200 and excludes
  inactive or blocked favorite actors before calculating popularity.

Fetching domain rows first and filtering User state in TypeScript would change
counts, ranking, page density, cursor behavior, and potentially which rows are
returned. That is not an acceptable conversion.

## Authority and operation matrix

| Operation | Principal | Required result | Required boundary |
| --- | --- | --- | --- |
| Count active members | Anonymous/public system | one non-negative count | Fixed aggregate; no User row or identity fields |
| Filter public seller/listing content | Anonymous or active viewer | domain rows whose seller account is active, plus optional seller avatar fallback | Domain-bound projection/query that filters before count/order/page and cannot enumerate unrelated users |
| Filter published blog content | Anonymous or active viewer | published rows with active author and active seller when linked, plus public author identity | Domain-bound projection/query preserving publish time, seller state, block filtering, order, and limit |
| Read visible review identity | Anonymous or active viewer | visible review plus active reviewer's id/name/image | Review-bound projection preserving block filters and aggregate/page semantics |
| Read visible commission identity | Anonymous or active viewer | open request plus active buyer identity; active-public-seller interest count | Commission-bound projection preserving expiry, block, order, and count semantics |
| Exclude owner analytics | Authenticated viewer | boolean owner/non-owner decision bound to a public listing | Server-derived Clerk subject resolved to local id, then listing-seller comparison; no relation lookup by Clerk id |
| Render owner/relationship pages | Authenticated active owner | public artifact identity plus owner/block state | Existing actor-bound owner operation combined with the same domain-bound public projection |

## Findings and release effect

### `BLOCKS_RLS_DESIGN`: a generic active-user projection widens privacy

A table-wide active-row policy or generic `User` lookup by arbitrary id would
make every active buyer's public-looking columns enumerable, even when that
buyer has no public artifact. Full-table SELECT would also expose private
account columns. Column grants could reduce the selected fields, but do not
bind identity disclosure to a visible domain relationship.

The accepted design must use a fixed active-member aggregate and
domain/relationship-bound identity operations. A generic public identity RPC
whose only input is a caller-selected User id is rejected.

### `BLOCKS_RLS_DESIGN`: visibility must precede pagination and ranking

The current Prisma nested predicates and raw joins filter active User state
inside the database before counting, ordering, ranking, cursor advancement, or
limiting. A batch identity lookup applied after those operations would silently
change marketplace results. Each replacement must preserve the complete domain
predicate and database-side ordering contract, either in a fixed operation or
a narrowly reviewed domain projection.

### `FIX_BEFORE_ACTIVATION`: inconsistent public member count

`/about` counts non-banned users but includes deleted accounts. Cached homepage
stats require both non-banned and non-deleted users. Both public counters must
use one fixed active-member aggregate so the same account cannot be counted on
one public page and excluded on another.

### `FIX_BEFORE_ACTIVATION`: public customer photos read Clerk id

`src/app/seller/[id]/customer-photos/page.tsx` already resolves the current
Clerk subject to local `meId`, but also selects the seller's `User.clerkId` and
compares it to the provider subject for ownership. It must compare
`seller.user.id` with `meId` and stop projecting Clerk id. Public visibility,
blocked-user checks, 24-row pagination, and owner access to a non-public seller
must remain unchanged.

### `FIX_BEFORE_ACTIVATION`: click/view telemetry filters by Clerk relation

The listing click and view routes exclude the seller through
`seller.user.clerkId != currentClerkId`. They must derive the local actor id
from the server-authenticated Clerk subject and compare `seller.userId` to that
local id inside the existing atomic `updateMany`. Anonymous requests, bot/rate
limit/dedup behavior, daily caps, public listing visibility, and silent skip
semantics must remain unchanged.

### `FIX_BEFORE_ACTIVATION`: seller review rendering re-enters by Clerk id

`src/components/ReviewsSection.tsx` receives `sellerUserId` as a Clerk id, then
finds `SellerProfile` through `User.clerkId` to render a seller reply. The
listing caller already has durable seller identity. It must pass the local
seller-profile or User id instead, while preserving display-name and avatar
fallback behavior. Authenticated reply/vote mutation routes are separate
relationship-authority callers and remain in a later package.

### `FIX_BEFORE_ACTIVATION`: 23 public raw User references and retained nested relations

Every listed raw join and every public relation predicate will fail after a
policyless User activation and currently relies on broad runtime table access.
They must reach reviewed fixed operations or domain projections before table
grants change. The direct-delegate scanner reaching zero would not close this
finding.

### `DEFERRED_PRODUCT_WORK`: normalized public identity records

A separately maintained `PublicUserProfile`/identity snapshot could eventually
make public identity simpler and more explicit. It introduces synchronization,
rename/image lifecycle, deletion, moderation, and historical-content product
decisions. It is not required for the first safe User release if fixed domain
operations preserve current live identity semantics, and it must not be bundled
silently into RLS activation.

## Design direction after this audit

Use additive `SECURITY DEFINER` operations with `search_path=pg_catalog`, no
dynamic SQL, PUBLIC execution revoked, runtime-only execution grants, strict
input/result validation, and database-side limits. The first source candidate
should be cohesive rather than generic:

1. one fixed active-member count shared by `/about` and homepage stats;
2. local-id ownership corrections for customer photos and listing telemetry;
3. durable seller identity passed into review rendering instead of Clerk id;
4. domain-bound seller/listing catalog operations that preserve the existing
   active seller, Stripe, vacation, listing, block, ordering, and pagination
   predicates;
5. domain-bound blog, review, and commission projections preserving their
   respective visibility and boundedness rules; and
6. exact source scanners and disposable PostgreSQL proofs showing that no
   operation returns private columns or identity unrelated to a visible domain
   row.

If a view is considered for a domain projection, it must expose only rows and
columns already public through that domain, must not grant runtime any base
`User` SELECT, and must be accessed through an explicitly tested raw boundary;
the current Prisma schema has no view models. This is a design choice to prove,
not permission to create a generic active-user view.

## Go/no-go and ordered continuation

**GO for isolated source design and the three Clerk-id/local-id corrections.
NO-GO for Production SQL, deployment, User table grants, policies, ENABLE, or
FORCE RLS.**

1. Treat email-delivery database preparation as accepted through guarded run
   `37215932608`; keep its caller deployment separately bound.
2. Add focused regression coverage for the active-member definition,
   customer-photo ownership, telemetry owner exclusion, and review seller
   identity handoff.
3. Implement the small source corrections and active-member authority first;
   then re-run the direct/raw/nested inventory.
4. Design and prove seller/listing, blog, review, and commission domain
   projections without post-pagination filtering or unrelated-user identity
   enumeration.
5. Convert the remaining public raw SQL and relation-backed callers in cohesive
   packages, using focused tests during development and one full exact-head CI
   before merge.
6. Continue with eligibility/service, staff/ban, deletion, and installed
   function families. Re-run the complete User inventory before any activation
   proposal.
7. Keep Production migration, application deployment, table grant revocation,
   ENABLE RLS, and FORCE RLS as separate exact decisions with rollback and live
   catalog evidence.

## First implementation checkpoint

The first cohesive correction package is implemented in this isolated
worktree, still based on exact merged main `d8a6d1c4...`:

- `/about` and cached homepage statistics now call one fixed active-member
  aggregate, so both exclude banned and deleted accounts;
- customer-photo ownership uses the already resolved local User id and no
  longer selects Clerk id;
- listing click/view telemetry resolves the signed Clerk subject to a local id,
  fails closed when that mapping is absent, and performs the seller exclusion
  against `SellerProfile.userId` inside the existing atomic update;
- review rendering receives the durable seller User id, looks up the seller
  profile by its unique `userId`, and shows the reply control only after the
  existing local-id seller check; and
- additive migration
  `20261004040000_prepare_user_public_member_aggregate` creates only the fixed
  count function, revokes PUBLIC execution and grants execution to
  `grainline_app_runtime`. It does not change User rows, grants, policies, RLS,
  or existing functions.

The exact direct-delegate inventory is now 29 calls in fourteen files: nineteen
`findUnique`, three `findMany`, one `findFirst`, one `count`, two `update`, and
three `updateMany` calls. The two public direct counts are gone; every remaining
direct call belongs to a later named family. The 27-reference raw-SQL inventory
and the retained domain relations remain open and continue to block User RLS.

Focused verification is complete: the 26/26 exact public-identity source,
state, inspector, workflow and disposable PostgreSQL checks pass; the 19/19
cumulative User predecessor and inventory checks also pass; focused ESLint
passes; TypeScript passes; both changed workflow YAML files parse; and
`git diff --check` passes. No broad local suite was repeated. The protected
aggregate workflow is hard-bound to accepted email-delivery run `37215932608`.
This is still source preparation only. The aggregate migration has not been
published, merged, applied, or deployed, and User RLS remains off.
