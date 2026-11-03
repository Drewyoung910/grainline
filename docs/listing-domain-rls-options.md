# Listing, Photo and variant RLS options

Date: 2026-11-02

Status: **Phase 0 comparison complete. Option A selected for isolated
preparation only; activation remains NO-GO.** This document does not authorize
a merge, deployment, Production action or catalog RLS activation.

## Isolated activation-candidate evidence (2026-11-02)

The selected hybrid was implemented as one four-table forward migration on
`codex/listing-domain-rls-activation-20261102`. This changes the candidate from
design-only to locally proven, but does not authorize a PR, merge, deployment
or Production migration.

- PostgreSQL 17 applied all 468 migrations from zero, including the exact
  activation migration.
- Direct `grainline_app_runtime` and `grainline_staff_read_runtime` sessions
  proved public-only rows, exact safe columns, denial of `SELECT *`, denial of
  `Photo.originalUrl`/`Listing.priceVersion`, denial of all direct writes and
  denial of staff direct table reads.
- The bounded owner editor continued to return an owned private listing.
- The public-reservation constraint rejected a non-private row carrying a
  reservation id.
- The database-first rollback restored predecessor rows, restricted columns
  and CRUD, and reapplying the exact activation bytes restored the boundary.
- Runtime-role provisioning initially re-granted predecessor CRUD. The direct
  login proof caught this real defect; provisioning and the global grant audit
  now preserve exact Listing-family column grants and reject policy-expression
  drift.
- The exact migration was exercised with 50,000 synthetic listings. Public
  category, seller and exact-id reads were required to avoid a Listing
  sequential scan and finish below 500 ms; bounded selective search was
  required below 1 second. The scale fixture then deletes itself and vacuums so
  it does not distort later full-chain scenarios.
- The complete final run passed in 34.3 seconds. Focused migration/grant tests,
  TypeScript, touched-file ESLint, dependency audit and diff checks also pass.

Remaining work is release integration and independent review, not another
Listing access-layer redesign. The release path should be the smallest reusable
public-catalog adapter that can bind this coupled four-table migration; it must
not copy the historical per-table workflow machinery.

## Domain boundary

Treat these four tables as one catalog domain:

- `Listing`
- `Photo`
- `ListingVariantGroup`
- `ListingVariantOption`

The child rows have no safe visibility rule independent of their parent.
Photos also contain the owner-only pre-crop `originalUrl`, while the displayed
`url` is public only when the parent listing is public. Variant option labels,
price adjustments and stock are public only through a visible listing, and
all child mutations belong to the listing owner or a fixed service operation.

## Measured starting point

The generic schema-aware source scanner was run on exact source
`7060b504a9f4503af26dd11a14e316fa89ed93b8`.

| Model | Direct operations | Relation traversals | Raw SQL sites | Source files | Full-row direct reads/writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `Listing` | 100 | 35 | 11 | 56 | 14 |
| `Photo` | 9 | 29 | 0 | 24 | 2 |
| `ListingVariantGroup` | 3 | 9 | 0 | 7 | 1 |
| `ListingVariantOption` | 0 | 9 | 0 | 5 | 0 |

The union is 57 source files. The Listing operations include 28 `findMany`,
22 `updateMany`, 19 `count`, 12 `findUnique`, seven `groupBy`, six
`findFirst`, three `update`, two `create` and one `deleteMany`. Source
inventory was followed by the full-chain PostgreSQL 17 catalog pass summarized
below; source counts are not used as a substitute for installed definitions.

The full 466-migration PostgreSQL 17 chain adds important context. There are
123 live functions which reference this domain, but 121 are already
security-definer authorities for other locked domains; 94 are executable by
the ordinary runtime and only two by the protected staff role. There are no
dependent views. The four tables have 33 indexes, three direct triggers and 12
inbound foreign keys. This favors preserving reviewed installed authorities
and applying one direct, planner-visible public policy over creating another
function for every query shape.

## Required behavior

Any selected design must preserve these distinct principals and row shapes:

1. Anonymous and signed-in visitors can search, sort, filter, group, count,
   paginate and render public listings. Browse/search rows are active,
   non-private, unarchived and seller-orderable. Public detail additionally
   permits ordinary sold-out rows.
2. An active owner can read every retained state of their own unarchived
   listing, including drafts, review metadata, package dimensions, pre-crop
   photo sources and variant stock, and can perform only reviewed state
   transitions and mutations.
3. An active reserved buyer can read the bounded private custom-listing detail
   for exactly their reservation while it is in an allowed state. It must not
   become generally searchable or indexable.
4. PIN-authorized staff can read moderation fields and perform reviewed
   moderation transitions through the protected staff authority.
5. Checkout, cart, shipping, stock restore, account deletion, upload lifecycle,
   analytics, AI review, sitemap, notification and repair work retain only the
   fields and mutations required for their exact operation.
6. Public photo results never expose `Photo.originalUrl`. A future base-table
   column is not public until separately reviewed.
7. Listing, photo and variant writes preserve the current state machine,
   upload claims, price-version behavior, stock locks, checkout invalidation,
   moderation evidence and child-row atomicity.
8. Public catalog query plans remain set-based and index-backed. RLS must not
   turn browse/search into one function call or one database round trip per
   card.
9. No security release drops a column or silently changes product behavior.

## Option A: standard RLS plus safe-column grants and fixed mutations

Shape:

- keep flexible Prisma reads on the base tables for a reviewed safe column
  set;
- grant no `Photo.originalUrl`, moderation fields, reservation routing or
  other purpose-bound fields through the generic read surface;
- use a planner-visible Listing SELECT policy only for `ACTIVE`, non-private,
  unarchived, seller-orderable public rows;
- derive generic child-table visibility only through that active-public parent
  policy and grant only displayed photo and variant columns;
- serve sold-out detail, owner/editor rows, exact reserved-buyer rows, staff
  rows and retained history through bounded fixed authorities rather than
  adding mixed-principal `OR` branches to the generic policy;
- move owner-only full-row reads, staff reads, service reads and every mutation
  behind actor-bound fixed operations;
- use the existing transaction-local `app.user_id` inside bounded owner and
  reserved-buyer authorities, and the protected staff role/capability for
  moderation.

Strengths:

- preserves flexible indexed search, sorting, grouping and pagination without
  a function per public page;
- future columns fail closed because PostgreSQL column grants are explicit;
- the database independently rejects private/draft rows and unsafe columns;
- substantially less conversion and maintenance than a fixed read function for
  every public query shape.

Risks and required proof:

- sold-out public detail is intentionally not part of the generic policy and
  must remain available through the actor-aware detail authority;
- owner/reserved authorities must run on the same transaction that sets
  `app.user_id`;
- Prisma relation queries must request only granted columns;
- a compromised runtime credential can still assert another `app.user_id`,
  the accepted limitation of the current identity design;
- all direct mutations and implicit full-row reads must be removed before
  grant closure.

The public-search proof found one important exception to the direct-read
default. PostgreSQL does not push non-leakproof operators such as `ILIKE`,
trigram similarity, enum equality or array containment through a row-security
barrier. A mixed public/owner/reserved policy also hid otherwise fast public
ordering paths. Restricting the generic policy to active-public rows restored
text/id/order-by paths, but selective title/tag filters and enum counts still
scanned the visible set. Those query shapes therefore need a small bounded
public catalog filter authority which applies the public visibility predicate
and the selective operator together as the bypass owner, then returns only a
pinned safe row shape (plus an exact count where requested). Ordinary home,
seller-id, exact-id and unfiltered newest-list reads can stay direct.

Rollback is database-first: restore the exact predecessor privileges required
by the compatible application, disable the four-table policy posture as one
coupled unit, then prove predecessor statements before reconciling the
migration ledger.

## Option B: zero direct base authority plus public views and fixed operations

Shape:

- revoke every ordinary runtime base-table privilege;
- expose one or more security-barrier public projections;
- put owner, reserved-buyer, staff, transaction and service work behind fixed
  functions.

Strengths:

- strongest fail-closed projection boundary;
- public and purpose-bound result shapes are explicit;
- new base columns never appear automatically.

Costs and limits:

- the current Prisma schema has no mapped database views;
- flexible search, ranking, grouping and pagination would need a new mapped
  view layer or many raw/function query contracts;
- a function per page would reproduce the release and maintenance overhead the
  lighter RLS program is intended to remove;
- caller conversion is close to the full 57-file source inventory even though
  most public reads already select safe fields.

This remains appropriate for narrow mixed tables such as SellerProfile, but is
not automatically the best fit for a public-read-heavy catalog table.

A non-security-barrier view is not an acceptable shortcut. It restored the
trigram plan in the disposable proof, but permits caller-supplied leaky
predicates to execute before the view filter and is therefore not a durable
privacy boundary. A security-barrier view retained the same index-loss problem
as RLS.

## Option C: split private/control fields into companion tables

Shape:

- move reservation routing, AI/staff review state, internal analytics and the
  pre-crop photo source into private companion rows;
- leave a physically public catalog row and displayed media/variants behind;
- add owner/staff/service operations across both sides.

Strengths:

- strong physical separation;
- could make broad catalog reads easier to reason about.

Costs and limits:

- introduces dual-row creation, synchronization, child lifecycle, foreign-key
  and rollback failure modes;
- touches checkout, moderation, editing, deletion and historical order paths;
- repeats the riskiest part of the SellerProfile split for fields whose
  confidentiality can be enforced by explicit grants;
- still needs policies and fixed mutations.

No column may be dropped during a security release, so this would require a
long compatibility period and is not the provisional choice.

## Option D: column-level revocation without RLS

Shape: retain direct reads of safe columns, revoke sensitive columns and move
writes behind fixed operations, but do not add row policies.

This is materially weaker. It cannot independently prevent drafts, rejected
content, archived listings or private custom orders from appearing when a
query omits one predicate. It is rejected as the final boundary.

## Executed plan and projection evidence

The full-chain disposable PostgreSQL 17 database was extended with 50,000
synthetic listings and one Photo, variant group and variant option per listing.
The probe uses an ordinary non-bypass login, real RLS policies and explicit
column grants.

| Query/proof | Candidate RLS result | Owner/no-RLS baseline or bounded result |
| --- | ---: | ---: |
| Public category newest 24, mixed-principal policy | 11.33 ms | 0.153 ms without RLS |
| Public category newest 24, active-public-only policy | 0.109 ms | 0.153 ms without RLS |
| Public seller page, active-public-only policy | 1.07 ms for 24 | seller index used |
| Exact three public ids, active-public-only policy | 0.067 ms | primary-key path used |
| Public title substring, five matches | 21.47 ms; scans about 44,000 visible rows | 0.19 ms via active-title trigram index |
| Rare exact tag, 50 matches | 10.56 ms; scans about 44,000 visible rows | 0.11 ms via tag GIN index |
| Public title substring, active-public-only policy | 20.59 ms | non-leakproof `ILIKE` still fenced |
| Rare exact tag, active-public-only policy | 9.06 ms | non-leakproof array operator still fenced |
| Bounded title-search ids plus RLS-safe row fetch | — | 0.74 ms |
| Bounded rare-tag ids plus RLS-safe row fetch | — | 0.59 ms |
| Common tag page (25,000 matching rows), bounded to 24 ids plus safe fetch | — | 6.55 ms warm |
| Common tag count | — | 5.80 ms warm |
| Four displayed Photo rows through parent policy | 0.08 ms | parent and child indexes used |
| Four variant options through group and parent policies | 0.09 ms | all three indexes used |

An exact Prisma query selecting public Listing fields plus displayed Photos,
variant groups and options succeeded under the limited role. Owner actor
context exposed an owned draft; exact reserved-buyer context exposed the
private reserved listing; an unrelated or banned actor saw neither. Prisma
queries for `Photo.originalUrl`, package dimensions and moderation fields each
failed with a database permission error. The exploratory grant originally
included package dimensions, contradicting the reviewed classification; it
was corrected before the proof. The production grant must be generated from a
pinned reviewed column manifest so that hand-maintained drift cannot recur.

PostgreSQL marks `texteq` leakproof, but not `enum_eq`, `texticlike` or
`arraycontains`. This explains both the restored exact-id/seller/order plans
and the remaining filter/count scans. The migration proof must pin the
specific direct and bounded query shapes, not infer performance from one
successful page.

## Selected recommendation

Choose **hybrid Option A with a public-only generic policy**:

- use direct RLS plus explicit safe-column grants only for active-public home,
  seller, exact-id and unfiltered listing reads and their displayed children;
- use one bounded, fixed public catalog filter contract for query/tag/category/
  facet/count shapes whose non-leakproof operators RLS fences, and a narrow
  suggestion contract for trigram suggestions;
- use one actor-aware detail contract for active/sold-out public detail, owner
  preview and the exact reserved buyer, returning a principal-specific pinned
  shape;
- retain or add bounded owner, staff, retained-history, checkout and service
  operations for purpose-bound columns and mutations;
- do not create a function per page, and do not introduce a non-security-
  barrier public view.

This is the safest scalable option presently supported by executed evidence.
It avoids both the performance failure of pure Option A and the hundreds of
bespoke contracts implied by pure Option B.

Pure Option B is the fallback only if implementation proof finds that Prisma
cannot reliably keep restricted columns out of the generic public relation
queries or the pinned public manifest cannot support the direct shapes above.

The installed-catalog pass defines one required conversion under Option A.
The runtime-executable security-invoker `grainline_message_list(...)` currently
joins Listing for retained conversation context and would lose the title after
the listing becomes non-public. The inbox's inner invoker function is reached
through a security-definer bypass-owner wrapper and is not affected in the
same way. An existing bounded authority,
`grainline_seller_actor_conversation_context_listing(text)`, already returns
the participant-safe title/photo projection and should be reused rather than
adding another layer. Owner resolution and reserved-buyer access still need
the final exact policy and migration proof.
