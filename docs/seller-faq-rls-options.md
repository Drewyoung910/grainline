# SellerFaq RLS Options

Date: 2026-10-29

Source: `fb38730ff86f85a9b1dbd5bba39cbddd54af9108`

Decision: Option B is selected for long-term safety, scalability, and the
smallest duplicated authorization surface. This decision follows the complete
consumer and lifecycle audit in `docs/seller-faq-pre-rls-audit.md`.

## Option A: Public Read Policy And Owner Write Policies

Allow public SELECT and actor-owned INSERT/DELETE through row policies.

Advantages:

- familiar row-policy shape;
- little wrapper code for owner mutation;
- direct owner reads could replace a fixed projection.

Costs and risks:

- FAQ rows are public only when the parent seller is visible and not blocked;
- a broad public policy leaks hidden sellers' content;
- a correct public policy must duplicate the SellerProfile account, Stripe,
  viewer, and bidirectional Block rules;
- owner policies must join the already policyless-forced SellerProfile table or
  call another fixed authority;
- generic INSERT still does not atomically enforce the 20-row limit and next
  sort order;
- account deletion still needs a claim-bound operation.

This option is rejected because its apparent simplicity comes from omitting
the hard visibility and concurrency rules.

## Option B: Zero Direct Access With Purpose-Bound Operations

Keep the two current SellerProfile projections for public and owner reads. Add
actor-bound create, actor-bound remove, owner export, and claim-bound deletion
cleanup. After the compatible app is live, ENABLE plus FORCE policyless RLS and
revoke all ordinary runtime table/column authority in one activation.

Advantages:

- reuses the already-reviewed parent visibility and block rules;
- exposes no generic child-table read oracle;
- puts the 20-row limit, sort assignment, ownership, and active-account checks
  in one atomic create transition;
- gives account deletion an explicit claim-bound cleanup;
- requires only four direct caller conversions;
- future callers must choose one narrow operation instead of constructing
  arbitrary queries.

Costs and risks:

- function owners, fixed search paths, source identity, and ACLs become part of
  the security boundary;
- behavior can drift when application logic is rewritten in SQL;
- schema changes later require explicit operation and proof updates.

These costs are bounded here because the domain is small, and behavior-parity
tests can execute every path against the predecessor and candidate.

## Option C: Public Safe-Column View Plus Fixed Writes

Expose `id`, `question`, and `answer` through a security-barrier view while
using fixed create/delete operations.

Advantages:

- avoids direct base-table authority;
- presents a conventional public read surface.

Costs and risks:

- the view still needs the complete per-viewer parent visibility and Block
  contract;
- anonymous and signed-in results differ, so it is not a static public view;
- the existing public SellerProfile function already supplies the exact safe
  fields without a second query or authorization copy;
- owner, export, and deletion paths still need separate operations.

This is reasonable only if FAQs later become an independently paginated public
resource. It adds no value to today's embedded profile section.

## Option D: Column-Level Privilege Revocation

Allow direct reads of selected fields and restrict writes by columns.

This is rejected. Column grants cannot express parent ownership, seller
visibility, viewer blocks, the 20-row limit, next-order assignment, or
claim-bound deletion. Seller id and timestamps also become unnecessarily
queryable.

## Selected Design

Choose **Option B**.

The compatible preparation must:

- convert exactly four direct caller families;
- retain the public and owner SellerProfile readers unchanged;
- add a parent-row-serialized create operation with a hard limit of 20;
- preserve code-point text bounds and plain-text display behavior;
- add idempotent owner delete and stable owner export;
- make deletion cleanup claim-bound;
- inventory and pin every installed SellerFaq reader from a full migrated
  PostgreSQL catalog;
- leave RLS off and predecessor grants intact.

The later activation must:

- require the compatible preparation ledger and app deployment;
- prove zero direct application consumers;
- ENABLE and FORCE policyless RLS;
- revoke runtime, staff, and PUBLIC table and column authority;
- retain only the reviewed function ACLs;
- run direct-denial, behavior, race, grant, function-owner, and rollback proofs;
- merge only immediately before its separately approved production run.

No column deletion, data rewrite, public-copy change, or FAQ product redesign is
part of this security release.
