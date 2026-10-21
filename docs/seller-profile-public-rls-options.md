# Public SellerProfile RLS options

Date: 2026-10-18

Status: Option B approved by Drew on 2026-10-18 for isolated design and source
preparation. No Production RLS, grant, schema, or runtime behavior change is
authorized by this document.

## Decision

The selected authority boundary is **Option B: zero direct runtime
base-table authority, a bounded public projection, and fixed operations for
non-public reads and every write**. Implementation should be phased and must
not drop another column.

Approval of this document authorizes design and isolated source preparation for
Option B. It does not authorize a Production migration, grant change, ENABLE,
FORCE, or deployment. Each Production operation remains separately bound to an
exact commit, migration and successful CI run.

## Verified starting point

`SellerProfilePrivate` is complete in Production. Its policyless ENABLE was
applied by protected run `38825901687`. Its separate FORCE migration
`20261015120000_force_seller_profile_private_rls` was applied from exact main
`994fc18da95d2d896cec5baf73d3cce2227966a7` by protected run `38837514490`.
That run passed exact-source, owner-boundary, restart-safe, only-pending,
migration-ledger, forced-catalog and global-grant checks. Retained artifact
`seller-profile-private-force-production-38837514490` has GitHub artifact id
`12018968805` and digest
`sha256:c21270de58c8c7e925c4cd71878e7bd6a7d20f6a9183414bbcba720bb56a5bcb`.

The remaining public `SellerProfile` table is still RLS-disabled. Runtime role
provisioning grants broad `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the
whole table. Application checks currently limit normal behavior, but a defect
or injection running as the shared runtime role can read or modify every row
and every remaining column.

This table is mixed-purpose even after the private companion split:

- public shop presentation and public orderability state;
- owner-only exact location and settings;
- conditional public location, where every public result defaults to a
  database-derived approximation and an exact point requires separate,
  current, versioned consent stored in the private companion;
- stable ownership and relationship keys such as `userId`;
- staff or system-controlled verification, Guild, founding-maker and spotlight
  state; and
- fields written by owner settings, vacation, staff and background workflows.

RLS alone is row-scoped and cannot make one row's exact coordinates private
while exposing the same row's public profile columns. The design therefore
needs a column/projection boundary as well as row and write authority.

## Current caller inventory

The inventory below was measured on exact main
`e92b7a329cf3f7c1d45e8c2857e26b336d26ff65` with the schema-aware TypeScript
AST scanner exposed as `npm run audit:seller-profile-public-access`. It scans
`src/` and excludes migrations and installed database function bodies:

- **99 direct `SellerProfile` delegate operations in 58 files**: 12 `count`,
  1 `create`, 13 `findFirst`, 18 `findMany`, 42 `findUnique`, 1 `update`, and
  12 `updateMany`.
- Those include **14 direct writes**: the creation path, vacation update, four
  admin/founding-maker updates, and eight owner/staff access-module updates.
  Purpose-bound TypeScript wrappers do not remove the underlying base-table
  authority and still need fixed database operations before grant closure.
- **103 confirmed schema-relation accesses in 52 files**, plus five typed
  query-shape factories whose predicates traverse `SellerProfile`.
- **17 raw SQL accesses in 14 files**.
- The union of direct, relation and raw-SQL consumers is **100 source files**.
- A machine-checked manifest assigns all 100 files to bounded contracts:
  34 public-profile, 47 public-eligibility, 5 public-map, 22 owner, 15
  participant, 7 staff, 14 service and 14 transaction consumers. Contracts
  overlap where a file performs more than one role. Run it with
  `npm run audit:seller-profile-public-contracts`.
- The scan found zero direct full-row returns, zero opaque direct projections,
  and zero relation full-row returns. Existing callers already select bounded
  fields, which reduces projection design risk but does not remove shared-role
  base-table authority.
- A disposable PostgreSQL 16 build of all 350 migrations finds 130 installed
  function bodies that reference `SellerProfile`, including 91 existing
  runtime-executable fixed authorities; 24 dependent triggers, six directly on
  the table; 16 incoming foreign keys; and no existing view. Those database
  objects are now classified as 98 retained fixed authorities (91 app runtime,
  7 staff read), 32 owner/internal support functions, and six internal-support
  table triggers. No matching installed function is public-executable or
  classified for retirement merely for this RLS conversion.
- A second machine gate partitions all 55 scalar columns into 38 generic
  public-profile outputs, seven public-predicate-only columns, four raw
  public-location source columns, and six purpose-bound-only columns. Generic
  public results exclude all 17 restricted columns. Approximate directory and
  seller/listing points are separate derived contracts; neither returns raw
  coordinate or privacy-control columns.

The earlier regex estimate of 73 direct calls in 52 files counted only literal
`prisma.sellerProfile` expressions and missed `tx`, `client`, and `db`
receivers. Its 106-file relation estimate mixed real and false-positive
relations. It is retired in favor of the schema-aware inventory. The scanner's
218 opaque generic shapes and 12 typed factory shapes have also been
reconciled by the machine-checked manifest: the target-model cases are known
visibility predicates, while the remaining calls/fragments are reviewed
non-target shapes. Drift now fails the audit command.

## Required product and security invariants

Any option must preserve all of these:

1. Anonymous catalog, seller, listing, search and map pages continue to read
   active public profiles without authentication.
2. Suspended, inactive, vacation and otherwise non-orderable sellers retain the
   existing route-specific visibility behavior. A single broad view must not
   silently replace those different predicates.
3. Public coordinates leave the database boundary through one approved
   database-derived contract. Positive privacy radii use a radius-sized grid
   and null/zero radii use the coarse public grid by default. Exact output is
   allowed only when separate current versioned consent exists in the private
   companion. Existing map opt-ins are not grandfathered, and a coordinate,
   radius, or map-opt-in change revokes consent. Generic public projections
   never return raw coordinate or consent source columns.
4. Owners can read the exact settings needed to edit their own shop. Another
   seller cannot read those owner-only fields.
5. Owners can change only owner-controlled fields. Staff/system-only badge,
   verification, spotlight, account-state and snapshot fields remain behind
   named operations with actor and invariant checks.
6. Background jobs, deletion, exports, webhooks, checkout, shipping, search,
   moderation and repair paths keep the minimum fields needed for their exact
   operation.
7. The runtime role and `PUBLIC` receive no direct whole-table authority after
   conversion. No security release drops a column.
8. Existing public behavior is reproduced before the old grant is revoked.
   RLS denial is not allowed to hide a pre-existing product defect.

## Options

| Option | Shape | Caller conversion | Protection | Rollback | Main costs and limits |
|---|---|---|---|---|---|
| **A. Add another companion-table split** | Move exact coordinates and any remaining internal/control fields into another one-to-one table. Leave a physically public catalog row and add fixed writes for both sides. | Every consumer of a moved field changes. The exact queue is 99 direct calls, 103 relation accesses, and 17 raw SQL accesses across 100 files. All 14 direct writes still move behind fixed operations. | Strong physical separation for fields moved out. It can make the remaining row safe for broad public reads. | Keep old columns synchronized during compatibility, switch reads back, and revoke the new path. No old column is dropped during the security release. | Repeats the migration and synchronization risk of the private split; creates a third seller table; still needs row-bound write functions; does not by itself solve visibility-state differences. |
| **B. Zero direct base authority plus bounded projection and fixed operations** | Keep the schema intact. Add one or more security-barrier public projections containing only approved fields, with conditional location disclosure handled in a dedicated projection/function. Move owner, staff, service and repair reads to purpose-bound operations. Move every write behind fixed operations. Revoke runtime/PUBLIC access to the base table, then activate RLS in separate ENABLE and FORCE releases. | All 99 direct operations, 103 relation accesses and 17 raw SQL accesses must be classified and moved to a safe projection or purpose-bound operation. All 14 direct writes convert. | Strong default: newly added base columns are not automatically public; exact coordinates and stable identifiers stay out of generic public results; row visibility and every mutation are centrally enforced. | Before activation, restore old callers because old grants remain. After activation, database-first rollback returns FORCE to ENABLE or disables the new posture, then restores the reviewed predecessor grant only if the compatibility proof still passes. | Largest explicit caller conversion. The view/function owner and RLS policy interaction must be proven on the full PostgreSQL 16 schema; no assumption about Prisma or view-owner bypass is accepted. Multiple projections may be needed for catalog, map and owner surfaces. |
| **C. Column-level privilege revocation plus fixed writes** | Revoke whole-table grants; grant runtime `SELECT` only on a reviewed safe column set. Serve conditional coordinates through a function/view. Put all 14 direct writes and all other mutations behind fixed operations. | Explicit Prisma reads that request only granted columns may remain. Every implicit/broad read, coordinate read, relation query requesting denied columns, and every direct write must convert. | Reduces broad disclosure and closes direct writes. Column denial protects named sensitive fields. | Regrant the reviewed predecessor columns and switch converted callers back. | Shared runtime identity still cannot express per-owner reads by itself; safe-column maintenance is fragile when columns are added; Prisma relation shapes can request a denied column unexpectedly; weaker fail-closed default than Option B. |

## Recommendation

Choose **Option B**.

It addresses the actual mixed-table problem without another physical data move.
The base row can remain stable for foreign keys and existing database
functions, while every public result becomes an explicit contract. It also
fails closed when a future migration adds a field: the new column is absent
from the public projection until reviewed. Option C is a useful intermediate
hardening mechanism, but its grant list and shared runtime identity do not form
the final ownership boundary. Option A provides strong separation but repeats
the most failure-prone part of the completed private split without enough
additional benefit.

The public projection must not be a single least-common-denominator query.
At minimum, design separate contracts for general catalog/profile reads,
approximate map/location reads, and owner/staff/service operations. A
dedicated projection owner or fixed read function must be tested under the
eventual FORCE posture on PostgreSQL 16; implementation cannot assume that a
view owner bypasses RLS.

## Phased implementation and release gates

### Phase 0: exact authority inventory

- Classify all 99 direct operations, 103 confirmed relation accesses, five
  relation-bearing query factories, and 17 raw SQL accesses across 100 files.
- Record requested columns, row visibility predicate, principal, and write
  authority for each caller.
- Reconcile current Claude/audit allegations that touch seller visibility,
  location, deletion, bans, verification, Guild, checkout or staff control.
- Complete the public SellerProfile domain audit and classify findings as
  `BLOCKS_RLS_DESIGN`, `FIX_BEFORE_ACTIVATION`, or `DEFERRED_PRODUCT_WORK`.

### Phase 1: additive projection and operations

- Add the bounded read projection(s) and missing fixed operations without
  changing or dropping the predecessor runtime grants.
- Add catalog, map, owner, staff and service behavior tests on the full migrated
  PostgreSQL 16 schema.
- Prove public location is approximate without separate current versioned
  consent and exact only with it; prove that generic projections never expose
  `lat`, `lng`, consent state, `userId`, or staff/system-only state.

### Phase 2: caller conversion

- Convert callers in small, independently reviewable groups.
- Maintain a machine-checked zero-direct-access guard covering Prisma calls,
  raw SQL and relation-based base-table reads.
- Run representative anonymous, owner, staff, checkout, shipping, deletion,
  map, search and background-job flows before revocation.

### Phase 3: compatible grant closure and ENABLE

- Require zero unreviewed base-table consumers and no unresolved
  `BLOCKS_RLS_DESIGN` or `FIX_BEFORE_ACTIVATION` finding.
- Revoke runtime and `PUBLIC` base-table and column authority.
- Apply ENABLE separately from caller conversion. Read back policies, grants,
  functions/views, ownership, migration ledger and representative pooled-runtime
  behavior. Preserve sanitized evidence.

### Phase 4: FORCE

- FORCE is a posture-only successor after ENABLE evidence is accepted.
- Bind the protected run to exact main, exact migration bytes and exact
  successful CI. Require only that reviewed migration pending.
- Repeat public, owner, map, staff/service and global-grant proofs after FORCE.

## Decision record

- [x] **Approve Option B** for isolated design and source preparation — Drew,
  2026-10-18.
- [ ] Choose Option A.
- [ ] Choose Option C.
- [ ] Request a revised comparison.

Option B is selected and Phase 0 closed on 2026-10-19. The domain may proceed
to additive Phase 1 design and isolated source preparation. Public location is
approximate by default. An isolated candidate makes every predecessor map
opt-in approximate and adds a separate versioned exact-location consent in the
protected private companion, with automatic revocation when coordinates or
privacy controls change. Its first two additive
database operations convert the three directory/home map reads and bind
seller/listing detail coordinates to the visible resource, reducing the
candidate inventory from 99 to 96 direct operations, from 100 to 99 total
source consumers, and from four to two raw-coordinate source consumers. The
third additive operation owns browse-radius membership and reduces raw SQL
accesses from 17 to 16. No public route now derives from the raw seller point
in application SQL. A fourth exact projection converts both seller-name
suggestion reads, returning only seller id/name while preserving each route's
public-listing requirement and reciprocal-block behavior. The candidate now
also converts both seller sitemap counts and both bounded sitemap page reads
through two exact operations. A seventh operation returns only the active
public-seller and historical founding-maker counts used by four marketing
surfaces. An eighth returns one seller count for a major or city metro, with an
optional active-public-listing requirement and reciprocal blocks inside the
operation. It converts the three metro count callers. The candidate has 82
direct operations in 47 files, 94 total consumer files and 203 reconciled
opaque query shapes at that point. A ninth listing-bound operation now returns at most four
similar-maker cards while deriving metro-before-state scope only from a
viewer-visible source listing and owning active candidate seller/listing
predicates, reciprocal blocks and stable Guild/follower order.
It returns only rendered card fields and a public-listing cover image. With
that conversion, the candidate has 80 direct operations in 46 files, 93 total
consumer files and 199 reconciled opaque query shapes. Its candidate catalog
contains 139 matching functions: the unchanged 98 retained and 32 internal
functions plus nine converted public authorities. A tenth exact operation now
owns the homepage's maximum-two spotlight selection: current admin features,
weekly Guild rotation, then weekly rotation within the top-four reviewed
public sellers. It returns only rendered spotlight fields, with `userId`
purpose-bound to suppressing the current seller's follow control. The candidate
now has 75 direct operations in 45 files, 15 raw SQL accesses in 12 files, 93
total consumer files and 194 reconciled opaque query shapes. Its catalog has
140 matching functions: 98 retained, 32 internal and ten converted authorities.
An eleventh exact operation now serves the public map-card endpoint. It owns
active/map-opt-in eligibility and highest-quality public-listing cover
selection and returns only the rendered card fields. The candidate is now down
to 74 direct operations in 44 files, 15 raw SQL accesses in 12 files, 92 total
consumer files and 192 reconciled opaque query shapes. Its catalog has 141
matching functions: 98 retained, 32 internal and eleven converted authorities.
Three additional exact operations now serve the metro maker directory: static
route slugs, at most 24 rendered maker cards and the current metro's nearby
areas. They keep the predecessor's distinct eligibility rules while owning
active seller, public-listing, reciprocal-block and stable-order predicates.
The candidate is now down to 73 direct operations in 43 files, 99 relation
accesses in 51 files, 15 raw SQL accesses in 12 files, 91 total consumer files
and 185 reconciled opaque query shapes. Its catalog has 144 matching functions:
98 retained, 32 internal and fourteen converted authorities.
A fifteenth exact operation now returns the maximum-ten cached footer metros.
It preserves active-seller-or-public-listing eligibility and the predecessor's
all-listing popularity rank without returning that rank to the application.
The candidate remains at 73 direct operations in 43 files and 15 raw SQL
accesses in 12 files, while relation access falls to 98 operations in 50 files,
the total consumer inventory falls to 90 files, and reconciled opaque shapes
fall to 183. Its catalog has 145 matching functions: 98 retained, 32 internal
and fifteen converted authorities.
A sixteenth exact operation now returns only the owner user id of an otherwise
visible seller to suppress self-view telemetry. It intentionally keeps vacation
shops visible, and the existing fixed view-record write remains separate and
unchanged. The candidate is now down to 72 direct operations in 42 files, 98
relation accesses in 50 files, 15 raw SQL accesses in 12 files, 89 total
consumer files and 182 reconciled opaque shapes. Its catalog has 146 matching
functions: 98 retained, 32 internal and sixteen converted authorities.
The seventeenth exact operation replaces the blocking route's two seller-id
lookups and two direct Follow deletions with one actor-bound cleanup. It shares
the sorted block-pair lock, requires the exact outgoing Block and deletes only
the two reciprocal Follow rows without returning seller identities. The
candidate is now down to 70 direct operations in 41 files, 98 relation accesses
in 50 files, 15 raw SQL accesses in 12 files, 88 total consumer files and 182
reconciled opaque shapes. Its catalog has 147 matching functions: 98 retained,
32 internal and seventeen converted authorities.
An eighteenth exact operation replaces the report route's direct seller lookup
with one boolean check that the submitted seller id is publicly visible and
belongs to the submitted reported user. It preserves vacation visibility and
returns neither the seller row nor its owner id. The candidate is now down to
69 direct operations in 40 files, 98 relation accesses in 50 files, 15 raw SQL
accesses in 12 files, 88 total consumer files and 181 reconciled opaque shapes.
Its catalog has 148 matching functions: 98 retained, 32 internal and eighteen
converted authorities.
A nineteenth exact operation derives the authenticated owner only from
transaction-local context and returns the profile id, avatar and active-listing
count shared by three account surfaces. It rejects missing, banned and deleted
owner context. The candidate is now down to 66 direct operations in 37 files,
98 relation accesses in 50 files, 15 raw SQL accesses in 12 files, 85 total
consumer files and 181 reconciled opaque shapes. Its catalog has 149 matching
functions: 98 retained, 32 internal and nineteen converted authorities.
The twentieth through twenty-second operations replace the public follow
endpoint's direct seller, Follow and Block access. The read returns only the
visible seller id, follower count and optional actor-bound follow state. Create
derives the actor from transaction-local context, shares the sorted Block-pair
lock, revalidates and locks the seller, rejects self/blocked/hidden targets and
returns only the owner id needed for the post-commit notification. Delete
remains able to remove a stale follow after a seller becomes hidden. The
candidate is now down to 63 direct operations in 36 files, 98 relation accesses
in 50 files, 15 raw SQL accesses in 12 files, 84 total consumer files and 179
reconciled opaque shapes. Its catalog has 152 matching functions: 98 retained,
32 internal and 22 converted authorities.
The twenty-third operation derives the authenticated owner from
transaction-local context and returns only the profile id, display name,
UTC-normalized creation time, charges-enabled state and vacation state shared
by seller analytics, broadcast and upload gates. It rejects missing, banned or
deleted owner context. This converts seven direct lookups across five callers.
The candidate is now down to 56 direct operations in 31 files, 98 relation
accesses in 50 files, 15 raw SQL accesses in 12 files, 80 total consumer files
and 179 reconciled opaque shapes. Its catalog has 153 matching functions: 98
retained, 32 internal and 23 converted authorities.
The twenty-fourth operation derives the same active owner context for the
dashboard blog editor and returns only profile id plus active listing ids and
titles in stable editor order. A left join preserves sellers with zero active
listings, while missing, banned and deleted owners return no row. This converts
three direct lookups across the blog create and edit surfaces without changing
the existing staff-without-seller behavior. The candidate is now down to 53
direct operations in 29 files, 98 relation accesses in 50 files, 15 raw SQL
accesses in 12 files, 79 total consumer files and 179 reconciled opaque shapes.
Its catalog has 154 matching functions: 98 retained, 32 internal and 24
converted authorities.
The existing owner-core operation also replaces the two direct seller lookups
used only to gate the sales list/detail routes and bind their private seller
state. The onboarding-incomplete behavior and durable Order authorities remain
unchanged. The candidate is now down to 51 direct operations in 27 files, 98
relation accesses in 50 files, 15 raw SQL accesses in 12 files, 77 total
consumer files and 179 reconciled opaque shapes. The catalog remains 154
matching functions: 98 retained, 32 internal and 24 converted authorities.
The new-listing page also reuses the already-loaded active owner bootstrap for
its rendered payout/vacation publish gates instead of reading those same two
seller fields again. A twenty-fifth actor-bound authority returns only seller
id, display name and the all-status listing count required by new/custom
listing moderation, preserving the predecessor relation-count scope. Its
exact-location metro assignment remains later conversion work. The candidate
is now down to 48 direct operations in 26 files, 98 relation accesses in 50
files, 15 raw SQL accesses in 12 files, 76 total consumer files and 179
reconciled opaque shapes. The catalog has 155 matching functions: 98 retained,
32 internal and 25 converted authorities.
A twenty-sixth actor-and-target-bound authority returns the exact seller
coordinate pair only to the server-side post-create listing metro mapper. It
does not change public location disclosure. The candidate is now down to 47
direct operations in 25 files, 98 relation accesses in 50 files, 15 raw SQL
accesses in 12 files, 75 total consumer files and 179 reconciled opaque shapes.
Only one source consumer file still directly reads owner coordinates. The
catalog has 156 matching functions: 98 retained, 32 internal and 26 converted
authorities.
A twenty-seventh actor-and-target-bound authority replaces both direct seller
reads in listing publish/reactivation. It returns only display name,
charges/vacation readiness and the exact ACTIVE/SOLD/SOLD_OUT count used by the
predecessor moderation call. The candidate is now down to 45 direct operations
in 24 files; relation, raw SQL, total-consumer and opaque-shape counts are
unchanged. The catalog has 157 matching functions: 98 retained, 32 internal and
27 converted authorities.
The listing-edit page then reuses the existing owner-core and all-status
listing-review authorities. Its Listing queries bind directly to the returned
seller profile id, removing the page's direct SellerProfile read and all four
SellerProfile relation accesses without a new function. The candidate is now at
44 direct operations in 23 files, 94 relation accesses in 49 files, 15 raw SQL
accesses in 12 files, 74 total consumer files and 179 reconciled opaque shapes.
The workshop dashboard then uses a bounded owner-dashboard state authority and
reuses owner core plus the composite Listing owner key for its three listing
actions. This removes one direct SellerProfile read and three relation accesses,
so the file leaves the consumer ledger. The candidate is now at 43 direct
operations in 22 files, 91 relation accesses in 48 files, 15 raw SQL accesses
in 12 files, 73 total consumer files and 179 reconciled opaque shapes. The
catalog has 158 functions: 98 retained, 32 internal and 28 converted.
One actor-bound conversation participant-card authority then replaces the
message inbox's batch seller lookup and the thread's counterpart seller lookup.
It accepts no more than 51 unique target user ids and returns only the bounded
seller-card fields for users who already share a conversation with the active
actor. This removes two direct SellerProfile reads and the inbox leaves the
consumer ledger. The candidate is now at 41 direct operations in 20 files, 91
relation accesses in 48 files, 15 raw SQL accesses in 12 files, 72 total
consumer files and 179 reconciled opaque shapes. The catalog has 159 functions:
98 retained, 32 internal and 29 converted. The real PostgreSQL 16 chain then
caught a `varchar`-to-`text` table-return mismatch that the original miniature
all-text fixture concealed. The forward correction casts the four affected
seller fields explicitly, and the focused fixture now mirrors their migrated
column widths.
The owner vacation route then uses one actor-and-target-bound mutation for its
three vacation fields. It accepts the return date as epoch milliseconds and
reconstructs the UTC wall-clock timestamp in PostgreSQL, avoiding session
timezone drift while leaving cache invalidation and checkout expiry after the
committed write. The route leaves the consumer ledger. The candidate is now at
40 direct operations in 19 files, 91 relation accesses in 48 files, 15 raw SQL
accesses in 12 files, 71 total consumer files and 179 reconciled opaque shapes.
The catalog has 160 functions: 98 retained, 32 internal and 30 converted.
The public blog-author page then uses an exact seven-field projection available
only for an active seller with a currently published, active-author blog post.
The returned owner id remains purpose-bound to the existing reciprocal-block
check before canonical redirects. This removes the page's direct seller read
and its opaque target predicate, so it leaves the consumer ledger. The
candidate is now at 39 direct operations in 18 files, 91 relation accesses in
48 files, 15 raw SQL accesses in 12 files, 70 total consumer files and 178
reconciled opaque shapes. The catalog has 161 functions: 98 retained, 32
internal and 31 converted.
The authenticated account feed then uses one actor-bound followed-seller card
projection before and after its bounded listing, blog and broadcast queries.
The operation verifies the Follow edge, active-seller readiness and reciprocal
blocks and returns only id, display name and Guild level. Removing the direct
preflight and three nested seller filters makes the route leave the consumer
ledger. The candidate is now at 38 direct operations in 17 files, 85 relation
accesses in 47 files, 15 raw SQL accesses in 12 files, 69 total consumer files
and 174 reconciled opaque shapes. The catalog has 162 functions: 98 retained,
32 internal and 32 converted.
The customer-photo landing page then uses a bounded seller header projection
that preserves anonymous visible metadata and the owner's canonical path while
returning an explicit public-photo eligibility bit. Authenticated non-owners
remain block-filtered, the ReviewPhoto query predicates listing state directly,
and the route rechecks seller eligibility after the read. The page leaves the
consumer ledger. The candidate is now at 37 direct operations in 16 files, 85
relation accesses in 47 files, 15 raw SQL accesses in 12 files, 68 total
consumer files and 172 reconciled opaque shapes. The catalog has 163 functions:
98 retained, 32 internal and 33 converted.
The listing review section then reuses the seller reply name/avatar and seller
ownership result already established by the authorized listing-detail loader.
This removes the component's duplicate direct SellerProfile read and its
Listing-to-SellerProfile ownership join without adding a new database authority
or changing the review surface. The candidate is now at 36 direct operations
in 15 files, 84 relation accesses in 46 files, 15 raw SQL accesses in 12 files,
67 total consumer files and 172 reconciled opaque shapes. The catalog remains
163 functions: 98 retained, 32 internal and 33 converted.
The Founding Maker allocator then becomes one bounded service authority that
owns the public-listing eligibility recheck, advisory lock, durable grant-ledger
allocation/restoration and SellerProfile badge mirror. The application helper
executes one statement and repair consumes its boolean result instead of
rereading SellerProfile. This removes four direct operations and two opaque
factory calls across two files. The candidate is now at 32 direct operations
in 13 files, 84 relation accesses in 46 files, 15 raw SQL accesses in 12 files,
65 total consumer files and 170 reconciled opaque shapes. The catalog has 164
functions: 98 retained, 32 internal and 34 converted.
Seller metrics then replaces its direct profile identity lookup with a bounded
service authority returning only the seller user id and UTC-normalized profile
creation clock. It keeps inactive and historical seller metrics available,
matching the predecessor lookup rather than silently adding a public-visibility
rule. The candidate is now at 31 direct operations in 12 files, 84 relation
accesses in 46 files, 15 raw SQL accesses in 12 files, 64 total consumer files
and 170 reconciled opaque shapes. The catalog has 165 functions: 98 retained,
32 internal and 35 converted.
The next cohesive service-identity conversion moves the signed Clerk welcome
display-name lookup and blocked-pair checkout cleanup's user-to-seller mappings
behind two bounded operations. Both preserve hidden/inactive sellers, matching
their predecessors, and the adapter rejects any result outside the exact
requested pair or expected scalar shape. The candidate is now at 29 direct
operations in 10 files, 84 relation accesses in 46 files, 15 raw SQL accesses
in 12 files, 62 total consumer files and 170 reconciled opaque shapes. Its
versioned exact-map consent successor adds one converted owner authority and
one internal revocation trigger function. The 169-function catalog is now 98
retained, 33 internal and 38 converted.
The public maker profile and shop header now use one viewer-aware fixed
projection instead of two broad direct reads. The operation preserves public
visibility and active-owner preview, denies reciprocal blocks, returns ordered
FAQs and metro labels, and exposes only `viewerIsOwner` rather than the owner
id or account controls. The candidate is now at 27 direct operations in 8
files, 84 relation accesses in 46 files, 15 raw SQL accesses in 12 files, 60
total consumer files and 170 reconciled opaque shapes. The 170-function catalog
is 98 retained, 33 internal and 39 converted.
The Guild Member and Guild Master application gates now share an actor-bound
owner projection of seller level and current verification status. This removes
the API's broad read and the compatibility helper's direct read. The candidate
is now at 25 direct operations in 7 files, 84 relation accesses in 46 files, 15
raw SQL accesses in 12 files, 59 total consumer files and 170 reconciled opaque
shapes. The 171-function catalog is 98 retained, 33 internal and 40 converted.
Authenticated seller bootstrap now uses one idempotent database operation
instead of a direct find followed by create. It binds the active owner through
transaction-local context, preserves the existing insert-trigger initialization
of public/private state and returns only the bootstrap fields. The candidate is
now at 23 direct operations in 6 files, 84 relation accesses in 46 files, 15
raw SQL accesses in 12 files, 58 total consumer files and 170 reconciled opaque
shapes. The 172-function catalog is 98 retained, 33 internal and 41 converted.
The PIN-gated admin reports page now resolves seller report links through a
50-id bounded operation on the isolated staff role. That removes its shared
runtime direct read while the function revalidates the active staff actor and
returns only seller id/display name. The candidate is now at 22 direct
operations in 5 files, 84 relation accesses in 46 files, 15 raw SQL accesses
in 12 files, 57 total consumer files and 170 reconciled opaque shapes. The
173-function catalog is 98 retained, 33 internal and 42 converted; the new
converted authority is staff-only.
The admin verification page's self-profile check and two feature-state writes
now use one isolated ADMIN-only transition. It locks and revalidates the seller,
preserves the active/Guild/expiry and self-feature rules, and creates the audit
witness atomically. The candidate is now at 19 direct operations in 4 files,
84 relation accesses in 46 files, 15 raw SQL accesses in 12 files, 57 total
consumer files and 169 reconciled opaque shapes. The 174-function catalog is
98 retained, 33 internal and 43 converted; two converted authorities are
staff-only.
Account deletion's seller-media discovery now uses one claim-bound authority
instead of a broad SellerProfile read with nested Listing/Photo reads. The
function derives the seller from the exact active `LOCAL_ANONYMIZE` generation
and token, refreshes the claim lease and returns only public media URLs. The
candidate is now at 18 direct operations in 3 files, 84 relation accesses in
46 files, 15 raw SQL accesses in 12 files, 57 total consumer files and 169
reconciled opaque shapes. The 175-function catalog is 98 retained, 33 internal
and 44 converted; two converted authorities are staff-only.
The profile editor's featured-listing toggle now uses one actor-bound operation
instead of separate SellerProfile read/write and Listing ownership queries. It
locks the exact owner profile row, verifies Listing ownership and atomically
removes or appends the id while enforcing the six-listing cap. The candidate is
now at 16 direct operations in 3 files, 84 relation accesses in 46 files, 15 raw
SQL accesses in 12 files, 57 total consumer files, 169 reconciled opaque shapes
and 7 direct writes. The 176-function catalog is 98 retained, 33 internal and
45 converted; two converted authorities are staff-only.
Avatar removal and automatic metro assignment now use two actor-bound owner
operations. Avatar clearing and DirectUpload-reference synchronization remain
in one contextual transaction, while metro assignment remains non-fatal after
geocoding. The candidate is now at 14 direct operations in 3 files and 5 direct
writes; relation, raw SQL, consumer and opaque-shape counts are unchanged. The
178-function catalog is 98 retained, 33 internal and 47 converted; two
converted authorities are staff-only.
Onboarding page and server-action setup now share one actor-bound projection.
It optionally binds the expected seller id and owns the all-status listing
count plus deterministic latest-listing summary before the caller adds private
onboarding state. The candidate is now at 12 direct operations in 3 files and
5 direct writes; the other source counts are unchanged. The 179-function
catalog is 98 retained, 33 internal and 48 converted; two converted authorities
are staff-only.
The Guild verification and Shop Settings dashboards now use two actor-bound
public-state projections. Both bind the active owner and expected seller id;
the Guild projection owns its bounded MakerVerification join, and both callers
combine the result with private state sequentially inside the same context
transaction. The candidate is now at 10 direct operations in 3 files and 5
direct writes; the other source counts are unchanged. The 181-function catalog
is 98 retained, 33 internal and 50 converted; two converted authorities are
staff-only.
The Shop Profile editor now uses one actor-bound state projection and one
actor-bound update instead of a direct state read, separate duplicate-name
lookup and direct update. The update locks the exact owner row, returns the
advisory duplicate result, preserves untouched gallery arrays and stays in the
same context transaction as DirectUpload-reference synchronization. The
candidate is now at 7 direct operations in 3 files and 4 direct writes; the
other source counts are unchanged. The 183-function catalog is 98 retained,
33 internal and 52 converted; two converted authorities are staff-only.
The exact-map consent correction then verified three related allegations
against the candidate: moving the pin did retain the checkbox, the protected
companion retained no append-only grant/withdrawal history, and the public map
function admitted a supplied banned viewer. The correction binds consent to
the reviewed coordinate hash, records immutable grant and withdrawal events
without a foreign key so deletion evidence survives, clears active consent on
pin/privacy/account changes, and denies map rows to banned viewers. A
failing-first full-chain PostgreSQL 16 scenario proved the old shape lacked
coordinate binding; the corrected 395-migration chain passes. The separately
alleged public-Nominatim exact-address disclosure also reproduces and remains a
provider/privacy gate before the exact-pin option ships. None of these
candidate changes is merged or live.
The owner residual pass then replaces account export and the two onboarding
writes with actor-bound fixed operations. The export returns only the reviewed
portable fields; onboarding validates its public inputs and advances protected
state atomically. The candidate is now at 4 direct operations in 2 files and 2
direct writes, with 56 total consumer files. The 186-function catalog is 98
retained, 33 internal and 55 converted; two converted authorities are
staff-only. The real 396-migration PostgreSQL 16 chain proves the three new
operations and their runtime/PUBLIC grant boundary.
The final staff orderability pass replaces both transactional ban/unban reads
and both staff writes with one actor-bound compare-and-set transition. The
candidate now has zero direct operations and zero direct writes, with 54 total
consumer files. The 187-function catalog is 98 retained, 33 internal and 56
converted; two converted authorities are staff-only. A failing-first proof on
the real 396-migration predecessor failed because the transition was absent;
the complete 397-migration PostgreSQL 16 chain proves stale-state rejection,
staff authorization, prior-state return and the runtime/PUBLIC grant boundary.
Predecessor grants remain unchanged. The candidate remains unmerged, and the
real 397-migration PostgreSQL 16 chain now closes all three retained-authority
proof gaps. All 98 retained callable authorities have database behavior
evidence: 96 direct and two composed. No Production policy, grant, ENABLE,
FORCE, migration, deployment, or provider operation is authorized by this
decision.

The isolated Phase 3 database candidate adds policyless ENABLE plus zero direct
runtime/PUBLIC/staff table authority. Its failing-first proof exposes the four
predecessor runtime CRUD grants on the 397-migration schema; the complete
398-migration PostgreSQL 16 chain passes after activation, including all public,
owner, staff, service, checkout, deletion and retained-authority scenarios.
Runtime-role provisioning now preserves zero-direct posture on every replay,
and the database-first rollback was proven to disable RLS without restoring
broad grants. The source candidate now also closes the exact-address/Nominatim
boundary with authenticated, explicit-submit city/state-or-ZIP search and no
external reverse-geocoding of the dragged pin; Terms and Privacy copy describe
the versioned exact-pin consent. The later exact-head reconciliation also keeps
the Austin visual map center out of submitted state, strictly validates the
Shop Settings location/shipping boundary and narrows the ship-from client
payload. The protected ENABLE workflow and restart-safe inspector are prepared.
Independent exact-head review then found a source-activation gap: 84 Prisma
relation accesses, 15 raw-SQL accesses, five relation-bearing query factories
and eight opaque relation predicates still depend on direct base-table
authority even though direct SellerProfile delegate calls are zero. The prior
full-chain scenarios did not execute those representative application callers
after ENABLE. The Production workflow now fails before database access unless
direct, relation, raw-SQL, relation-factory and target-opaque counts are all
zero. Exact-location consent is also
bound to the transaction-local authenticated owner, with cross-owner failure
proved before any mutation. The candidate therefore still needs the residual
caller conversions, merge, compatible application deployment, exact-head CI
and a separately authorized Production ENABLE run. FORCE remains a separate
post-acceptance stage. The first residual conversion combines the bounded
seller metro-slug authority with listing-backed metros for browse static paths
and the sitemap. The next conversion moves the public map's city directory to
a viewer-aware bounded authority, preserving mutual-block filtering instead of
reusing the anonymous static-path authority. Together they reduce the live
gate to 78 relation accesses and two opaque predicates without changing either
route set or the map's blocked-maker behavior. The owner-bound following-page
conversion then removes its SellerProfile, Listing and Photo relations and the
last two opaque SellerProfile predicates. That checkpoint reached 75 relation
accesses, 11 raw-SQL accesses, five relation-bearing factories and zero opaque
SellerProfile predicates. The service aggregate conversion moves the public
marketplace rating average behind a scalar authority without changing its
active-listing or seller-orderability predicate. The same bounded aggregate
surface now owns global listing tags, per-seller listing tags and public blog
tags while retaining their visibility rules, caps and deterministic ordering.
The owner saved-listing conversion then replaces the shared Prisma predicate
and both account-page relation reads with an actor-bound count/page authority.
It owns Favorite membership, public listing visibility, seller orderability,
reciprocal-block filtering and first-photo projection. The current gate is 74
relation accesses, 11 raw-SQL accesses, four relation-bearing factories and
zero opaque SellerProfile predicates across 48 consumer files and 156 opaque
shapes. The current 196-function catalog is 98 retained, 33 internal and 65
converted authorities; two converted authorities are staff-only.
The public commission-interest conversion then replaces four caller-composed
SellerProfile predicates, two relation reads and the Near Me raw SQL seller join
with bounded count and card authorities. Those operations own open-request and
active-buyer eligibility, seller orderability, reciprocal-block filtering,
stable card ordering and fixed limits. The current gate is 72 relation accesses,
10 raw-SQL accesses, three relation-bearing factories and zero opaque
SellerProfile predicates across 46 consumer files and 148 opaque shapes. The
current 198-function catalog is 98 retained, 33 internal and 67 converted
authorities; two converted authorities are staff-only.
The residual commission-interest conversion replaces the buyer dashboard's
historical maker-card relation and both request-close notification relations
with an actor-bound summary and a bounded service target authority. It
preserves inactive historical maker cards for the buyer, counts every recorded
interest, rejects cross-owner summary reads, and sends notifications only to
active seller accounts. The current gate is 67 relation accesses, 10 raw-SQL
accesses, three relation-bearing factories and zero opaque SellerProfile
predicates across 43 consumer files and 148 opaque shapes. The current
200-function catalog is 98 retained, 33 internal and 69 converted authorities;
two converted authorities are staff-only.
The blog residual cleanup then removes an unused nested seller read from the
owner editor and reuses the purpose-bound public blog-author authority for
follower fanout. The fanout still rechecks the exact post's public state before
loading a currently orderable seller and any reciprocal-block-filtered
followers. The actor-bound saved-blog count and page authority then owns post
visibility, seller orderability and reciprocal-block filtering instead of
accepting a caller-composed SellerProfile predicate. The current gate is 64
relation accesses, 10 raw-SQL accesses, three relation-bearing factories and
zero opaque SellerProfile predicates across 40 consumer files and 145 opaque
shapes. The 202-function catalog is 98 retained, 33 internal and 71 converted
authorities; two converted authorities are staff-only.
The custom-order-ready helper then removes its redundant Listing-to-SellerProfile
lookup and accepts the already-loaded seller user id from each of its four
callers. The fixed database authority still validates that the supplied seller
owns the exact reserved listing. The current gate is 63 relation accesses, 10
raw-SQL accesses, three relation-bearing factories and zero opaque
SellerProfile predicates across 39 consumer files and 145 opaque shapes.
Seller shop actions then reuse the existing actor-bound owner-core authority
and constrain their Listing read by the returned scalar seller id. Their
downstream ownership identity and display name are reconstructed only from that
authority result. The current gate is 62 relation accesses, 10 raw-SQL
accesses, three relation-bearing factories and zero opaque SellerProfile
predicates across 38 consumer files and 145 opaque shapes.
Account-deletion media collection then reuses the already-fenced deletion
snapshot's scalar seller-profile id when selecting seller-authored blog posts.
It preserves buyer-authored and seller-authored media coverage without a
BlogPost-to-SellerProfile traversal. The current gate is 61 relation accesses,
10 raw-SQL accesses, three relation-bearing factories and zero opaque
SellerProfile predicates across 37 consumer files and 146 opaque shapes.
Deferred seller-broadcast delivery then pairs the broadcast's scalar seller id
with a fresh actor-bound owner-core result. Deleted, banned, disabled,
vacationing or mismatched sellers still stop delivery without a
SellerBroadcast-to-SellerProfile relation. The current gate is 60 relation
accesses, 10 raw-SQL accesses, three relation-bearing factories and zero opaque
SellerProfile predicates across 36 consumer files and 146 opaque shapes.
Review replies then reuse the actor-bound owner core and the review's scalar
listing seller id for their preflight. Their final conditional write retains
the existing database-side seller activity and ownership recheck. At that
checkpoint the gate was 59 relation accesses, 10 raw-SQL accesses, three relation-bearing
factories and zero opaque SellerProfile predicates across 36 consumer files
and 146 opaque shapes.
Exact-head CI then exposed a host-timezone defect in two projection timestamp
tests. A complete return-signature inventory found the same boundary in nine
SellerProfile authorities. A single
forward preparation migration now returns those stored UTC values as
`timestamp with time zone` using `AT TIME ZONE 'UTC'`, without changing row
selection or grants. The focused regressions and then-complete 402-migration
PostgreSQL 16 chain pass with the correction immediately before ENABLE. The
full-chain scenarios assert the public-profile, Guild-application and other
corrected instants rather than relying on source text alone.
Favorite creation then moves its Listing-to-SellerProfile availability check
behind an exact public favorite-target authority. The authority preserves the
ACTIVE/SOLD_OUT, public, unarchived, active-owner, charge-ready, supported and
non-vacation predicates, returns only listing id, title and owner id, and leaves
the reciprocal-block decision in the route. At that checkpoint the gate was 58 relation
accesses, 10 raw-SQL accesses, three relation-bearing factories and zero opaque
SellerProfile predicates across 35 consumer files and 145 opaque shapes. The
203-function catalog is 98 retained, 33 internal and 72 converted authorities;
two converted authorities are staff-only. The then-complete 403-migration chain
includes the exact authority scenario and remains subject to exact-head CI.
Account export then moves its Follow-to-SellerProfile shop-label join behind an
actor-bound authority. It retains inactive followed shops because an export
describes recorded user data, rejects inactive actors, returns the same nested
shape to the payload builder and normalizes the stored timestamp to a UTC
instant. At that checkpoint the gate was 57 relation accesses, 10 raw-SQL
accesses, three relation-bearing factories and zero opaque SellerProfile
predicates across 34 consumer files and 145 opaque shapes. The 204-function
catalog was 98 retained, 33 internal and 73 converted authorities; two
converted authorities were staff-only. The then-complete 404-migration chain
included its exact authority scenario and remained subject to exact-head CI.
The recently-viewed tray now uses a viewer-aware bounded authority for at most
ten listing ids. It preserves active-only public eligibility, reciprocal-block
filtering, the first photo, the seller avatar fallback, requested-id ordering
and duplicate requested ids without retaining a SellerProfile relation read.
At that checkpoint the gate was 56 relation accesses, 10 raw-SQL accesses, three
relation-bearing factories and zero opaque SellerProfile predicates across 33
consumer files and 144 opaque shapes. The 205-function catalog was 98 retained,
33 internal and 74 converted authorities; two converted authorities are
staff-only. The then-complete 405-migration chain included its exact authority
scenario and remains subject to exact-head CI.
The review-reply route now commits the final seller-ownership, active-account,
active-profile and empty-reply recheck through one actor-bound conditional
write. Its earlier preflight responses remain unchanged, while a concurrent
reply or ownership/activity change still returns the existing conflict rather
than overwriting a saved reply. At that checkpoint the gate was 55 relation accesses, 10
raw-SQL accesses, three relation-bearing factories and zero opaque
SellerProfile predicates across 32 consumer files and 144 opaque shapes. The
206-function catalog is 98 retained, 33 internal and 75 converted authorities;
two converted authorities are staff-only. The then-complete 406-migration chain
included the exact authority scenario and remained subject to exact-head CI.
Follower listing fanout now refreshes its source listing and seller through a
bounded two-id public target instead of a nested SellerProfile relation. The
authority requires the exact expected seller, active public unarchived listing,
active owner, charge-ready supported account and non-vacation shop before it
returns the seven fields already consumed by notifications and email. At that
checkpoint the gate was 54 relation accesses, 10 raw-SQL accesses, three relation-bearing
factories and zero opaque SellerProfile predicates across 31 consumer files and
143 opaque shapes. The 207-function catalog was 98 retained, 33 internal and 76
converted authorities; two converted authorities were staff-only. The
then-complete 407-migration chain included its exact authority scenario and
remained subject to exact-head CI.
The base sitemap now obtains its maker-author seeds through a bounded authority
that preserves the predecessor first-500-public-post source window, one latest
row per seller and the first-100-author output cap. It returns only seller id,
display name and the UTC-normalized latest post update. The current gate is 53
relation accesses, 10 raw-SQL accesses, three relation-bearing factories and
zero opaque SellerProfile predicates across 30 consumer files and 142 opaque
shapes. The 208-function catalog is 98 retained, 33 internal and 77 converted
authorities; two converted authorities are staff-only. The complete
408-migration chain includes its exact authority scenario and remains subject to
exact-head CI.
