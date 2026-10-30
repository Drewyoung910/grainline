# SellerFaq Pre-RLS Domain Audit

Date: 2026-10-29

Source: `fb38730ff86f85a9b1dbd5bba39cbddd54af9108`

Status: functional and authority audit complete. Option B in
`docs/seller-faq-rls-options.md` is selected for long-term safety and
scalability. No migration, grant, RLS, Production, or product behavior change
is authorized by this audit alone.

## Intended Product Behavior

`SellerFaq` is public shop content owned by one seller. A current, active maker
may add up to 20 question/answer pairs to their own profile and may delete only
their own pairs. There is no update or reorder operation. Newly added rows sort
after the seller's existing rows; ties are deterministically ordered by id.

Anonymous and signed-in visitors see FAQs only as part of the bounded public
seller-profile projection. That projection already hides a seller whose owner
is inactive, whose Stripe account is not orderable, or whose relationship with
the signed-in viewer is blocked. The owner editor may read its own FAQs even
when the public shop is not orderable.

Account export includes the maker's FAQ rows. Account deletion deletes the
maker's FAQ rows before the parent seller profile is anonymized/deleted. No
other user, staff, cron, webhook, import, or background-job workflow owns a
direct FAQ mutation.

## Schema And Current Authority

The table contains:

- a client-generated text primary key;
- a required `sellerProfileId` foreign key with `ON DELETE CASCADE`;
- required question and answer text bounded to `varchar(200)` and
  `varchar(2000)`;
- required integer `sortOrder`, defaulting to zero;
- required creation time;
- an index on `(sellerProfileId, sortOrder)`.

There is no row-level security, no row policy, no database owner constraint,
no database 20-row limit, and no uniqueness constraint on sort order. The
ordinary application runtime retains predecessor CRUD authority.

The public table does not itself prove that:

- the caller owns the parent seller profile;
- the owner is active and not deleted or banned;
- the question and answer are nonblank after cleaning;
- one seller has no more than 20 rows;
- a newly assigned sort order is serialized with another add;
- account deletion is acting under the current deletion claim.

Those properties currently live in application code and the parent
SellerProfile authorities.

## Complete Consumer Inventory

### Direct application operations

Four application operations use Prisma directly:

1. `addFaq` counts the owner's rows, reads the greatest sort order and creates
   one row inside a serializable transaction with retry;
2. `deleteFaq` deletes one row only when both its id and the active seller id
   match;
3. account export reads the active seller's rows ordered by sort order;
4. account deletion deletes the seller's rows before parent anonymization.

No direct application read supplies the public seller page or the owner editor.
Repository search at the audited source found no other direct `SellerFaq` ORM
or raw SQL application consumer.

### Retained fixed readers

Exactly two installed function families read the table in their current
definitions:

- `grainline_seller_public_profile(text)` returns only `id`, `question`, and
  `answer`, ordered by sort order and id, after the complete public seller and
  viewer/block checks;
- `grainline_seller_owner_profile_editor_state(text)` returns the same three
  fields only after binding the seller to the active owner.

Both are fixed-search-path `SECURITY DEFINER` functions already required by
the policyless, forced SellerProfile boundary. Activation must still derive
their exact installed identities, owners, modes, source hashes, search paths,
and ACLs from the complete migrated PostgreSQL catalog rather than trusting a
historical migration search.

### Display and text boundary

The profile and owner pages render FAQ question and answer values as React text,
not live markup. The writer cleans and bounds both values before storage. The
database boundary must preserve code-point length limits and nonblank values,
but the RLS release must not silently introduce a new rich-text product format.

## Authority Matrix

| Operation | Principal | Scope | Final boundary |
|---|---|---|---|
| Public profile read | anonymous or active viewer | rows belonging to one currently visible seller | retain parent public-profile function |
| Owner editor read | active seller owner | rows belonging to the actor's seller profile | retain parent owner-editor function |
| Add | active seller owner | one bounded row, maximum 20, serialized next sort order | actor-bound fixed transition |
| Delete | active seller owner | exact actor-owned row | actor-bound fixed transition |
| Export | active seller owner | all actor-owned rows, stable order | actor-bound fixed projection |
| Account deletion | current deletion worker | rows belonging to the claimed seller account | claim-bound fixed cleanup |

No ordinary principal needs direct `UPDATE`. No staff principal needs a broad
read or mutation. Public callers do not need direct table access because the
parent seller projection already returns the reviewed public fields.

## Correctness And Security Findings

### SELLERFAQ-RLS-1: generic public SELECT would weaken seller visibility

Classification: `BLOCKS_PUBLIC_POLICY_DESIGN`.

FAQ text is public only when its parent seller is visible to that viewer. A
simple `USING (true)` public policy would expose rows belonging to inactive,
non-orderable, blocked, or deleted sellers. Repeating the entire SellerProfile
visibility and Block predicate inside a child-table policy would duplicate a
security contract that is already centralized and proven in the parent fixed
projection.

### SELLERFAQ-RLS-2: current direct writes rely on application ownership

Classification: `FIX_BEFORE_ACTIVATION`.

The application checks ownership correctly, but the broad runtime table grant
could write another seller's FAQ if a future caller omitted that predicate.
The compatible release should replace create and delete with actor-bound fixed
operations before direct grants are revoked.

### SELLERFAQ-RLS-3: the 20-row limit and sort assignment must be atomic

Classification: `PRESERVE_IN_FIXED_CREATE`.

The current serializable application transaction protects the count/max/create
sequence. A replacement that separately counts and inserts would admit two
concurrent 20th rows or duplicate next positions. The database transition must
lock the exact parent seller row first, then validate the count and assign the
next order in the same transaction. The lock order must match seller-account
and deletion operations.

### SELLERFAQ-RLS-4: account deletion must remain claim-bound

Classification: `FIX_BEFORE_ACTIVATION`.

Once direct deletes are revoked, deletion needs a fixed cleanup. It must bind
the requested seller to the active account-deletion claim and must not become a
generic runtime function that accepts any seller id. The parent cascade remains
defense in depth, not the only reviewed cleanup path.

### SELLERFAQ-RLS-5: public and owner projections already minimize fields

Classification: `PRESERVE_DURING_SECURITY_RELEASE`.

The retained readers omit seller id, sort order, and creation time from public
and owner page JSON. Export separately returns the full reviewed owner record.
Do not replace these projections with broad direct SELECT merely because the
question and answer are public on an eligible seller page.

## Concurrency And Recovery Requirements

- create locks the actor's parent SellerProfile before count/max/insert;
- two concurrent creates cannot exceed 20 rows and receive deterministic
  replay outcomes;
- delete is idempotent and cannot remove another seller's row;
- create racing seller deletion either commits before claimed cleanup or fails
  closed on the parent/claim boundary;
- public and owner readers keep working after direct table grants are revoked;
- the activation migration changes no row data or columns;
- rollback restores predecessor runtime CRUD before disabling/removing the new
  boundary, so the predecessor app never runs against revoked authority;
- no FAQ content is dropped or rewritten by the security release.

## Required Behavior Proof

The acceptance suite must use the complete migrated PostgreSQL 17 schema and
prove at least:

1. current active owner create, 20-row bound, and stable next order;
2. concurrent create winner order and serializable retry behavior;
3. forged seller id, banned/deleted actor, missing seller, blank input, and
   over-bound code-point input denial;
4. owner delete, cross-owner delete denial, and delete replay;
5. anonymous public profile visibility, owner visibility, inactive seller
   denial, and both block directions through the retained parent projection;
6. owner editor reads only the actor's rows;
7. export returns only the actor's rows in stable order;
8. claim-bound account deletion removes only the claimed seller's rows;
9. ordinary runtime and no-context direct SELECT/INSERT/UPDATE/DELETE fail
   after activation;
10. every installed function referencing SellerFaq has an accepted owner,
    security mode, fixed search path, source identity, and ACL;
11. full-chain grant audit and the predecessor app statements pass after the
    reviewed emergency rollback.

## Audit Decision

`GO` for an isolated compatible preparation implementing the four missing
fixed operations under Option B. `NO-GO` for RLS or grant activation until the
complete PostgreSQL behavior, concurrency, function-catalog, direct-denial,
deployment-order, and rollback proofs pass. Preparation and activation remain
separately approved production actions; the activation itself may combine
ENABLE and FORCE because the compatible app will have zero direct consumers.
