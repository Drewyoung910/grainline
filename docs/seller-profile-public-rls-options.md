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
- conditional public location, where every public result is an approximate
  database-derived point and exact `lat`/`lng` remains owner or purpose bound;
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
3. Public coordinates leave the database boundary only as an approved
   database-derived approximation. Positive privacy radii use a radius-sized
   grid and null/zero radii use the coarse public grid. Raw or exact coordinates
   remain owner or purpose bound and do not cross a generic public boundary.
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
- Prove public location is always approximate and prove that generic
  projections never expose `lat`, `lng`, `userId`, or staff/system-only state.

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
approximate-only. An isolated application candidate now corrects the exact
map/JSON-LD behavior with failing-first evidence. Its first two additive
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
Predecessor grants remain unchanged. The candidate remains unmerged, and the
three retained-authority proof gaps remain
`FIX_BEFORE_ACTIVATION`. No Production policy, grant, ENABLE, FORCE, migration,
deployment, or provider operation is authorized by this decision.
