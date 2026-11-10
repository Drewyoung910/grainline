# CommissionRequest and CommissionInterest RLS options

## Decision

Choose **Option B: zero ordinary runtime table authority, a bounded public
projection, and fixed owner/participant/service operations** for the coupled
CommissionRequest/CommissionInterest domain.

Preparation and activation stay separate. Preparation adds/converts the fixed
operations while RLS remains off and predecessor grants remain. After the
compatible app is live and drained, one activation covers both tables with
policyless ENABLE plus FORCE and revokes direct runtime/staff-read table and
column privileges. This is one domain release pair, not two per-table release
frameworks.

## Current conversion size

- 35 direct Prisma Commission delegate operations across 14 source files.
- Two raw public CommissionRequest queries in the commission board.
- Existing fixed authorities already cover atomic interest creation, public
  interest cards/counts, buyer interest summaries, service notification
  targets, direct-upload reference sync and public identity/location snapshots.
- The main work is converting request public/owner/cron/export/deletion paths
  and the remaining interest cleanup/export/owner-state reads, not inventing a
  new function for every field.

## Option A: owner and public RLS policies on the base tables

Possible shape:

- public SELECT policy for open active requests;
- buyer SELECT/INSERT/UPDATE policies for owned requests;
- seller SELECT policy for own interests and buyer SELECT through the parent;
- fixed functions for cron, ban, deletion, counts and notification.

Why it is not selected:

- RLS controls rows, not columns. Anonymous SELECT on CommissionRequest would
  expose internal `buyerId`, future moderation fields and any later private
  column unless every caller used column grants perfectly.
- CommissionInterest combines a public maker-card projection with private
  conversation routing. No safe whole-row public policy exists.
- owner policies cannot enforce the state machine, content bounds, upload sync,
  privacy-safe location derivation, atomic notification targets or count repair.
- most cross-user/service operations still need fixed functions, so the policy
  version saves little code while creating two permission systems to reason
  about.
- rollback would have to restore both row policies and partial column grants.

Caller conversion remains close to Option B because only the simplest owner
reads could stay direct.

## Option B: bounded public projection plus fixed operations

Selected shape:

- owner-owned security-barrier public projection containing only reviewed safe
  CommissionRequest columns and only discoverable rows;
- bounded reader operations for paging, distance/metro search, detail, sitemap,
  viewer block filtering and retained participant detail;
- actor-bound owner create/list/export/status operations;
- retain and harden the existing atomic maker-interest operation;
- fixed cron expiry, staff ban/undo, account-deletion, media and interest-cleanup
  operations;
- existing trigger-owned identity/location snapshots and upload-reference
  lifecycle;
- no direct ordinary runtime or generic staff-read access to either base table
  after activation;
- policyless ENABLE plus FORCE because row policies are not the authority.

Safety:

- public and participant shapes are column-sealed;
- request transitions and interest admission share one lock order;
- no caller-provided user id is authority; owner context, staff capability or
  deletion claim supplies the principal;
- future columns fail closed because neither the view nor return types expand
  automatically.

Scalability:

- one public projection can serve board, API, metro, metadata and sitemap
  readers;
- paging/filter functions remain set-based and index-backed;
- service transitions return bounded recipient ids instead of causing N+1
  table reads;
- one preparation and one activation use the shared catalog-driven workflow.

Rollback:

- preparation is additive and leaves predecessor grants unchanged;
- activation rollback is database-first: restore the exact predecessor table
  privileges required by the compatible app, `NO FORCE`, disable RLS, and
  verify predecessor statements before rolling back the migration ledger;
- fixed functions remain compatible throughout rollback and can be retired in
  a later cleanup, not during the emergency.

## Option C: split public and private companion tables

Possible shape:

- move public request content and approximate location to a public table;
- retain buyer linkage, status/ownership and moderation state privately;
- split public interest maker cards from private interest/conversation rows.

Why it is not selected now:

- almost all request content is intentionally public while OPEN; the sensitive
  boundary is lifecycle/principal and future columns, not a large stable group
  of private fields.
- a split introduces dual-row creation, synchronization, cascade, retention and
  rollback failure modes for every request and interest.
- public buyer snapshots and privacy-safe coordinates already exist on the
  artifact and are trigger-maintained.
- CommissionInterest's public card is derived from SellerProfile eligibility,
  so persisting a duplicate public interest row would create staleness.

Reconsider only if material private moderation/evidence fields are later added
to CommissionRequest or if public request retention diverges from legal/account
retention.

## Option D: column-level privilege revocation only

Possible shape: keep broad public/owner table reads while revoking selected
columns and mutations.

Why it is rejected:

- it cannot express open-versus-terminal visibility, buyer ownership, seller
  participation, reciprocal blocks, bans or expiry;
- future columns are easy to expose accidentally;
- direct UPDATE still cannot enforce atomic status/notification, location or
  count invariants;
- CommissionInterest conversation ids cannot safely coexist with public rows
  under a simple grant model.

It is weaker and not materially cheaper than the selected projection.

## Activation boundary

Option B authorizes compatible preparation only. Activation remains blocked
until `docs/commission-domain-pre-rls-audit.md` has no open
`FIX_BEFORE_ACTIVATION` items and the exact PostgreSQL 17, deployment-skew,
catalog, denial, concurrency, cascade and rollback proofs pass. No statement in
this document is standing permission to merge, deploy, inspect production, or
run a production migration.

