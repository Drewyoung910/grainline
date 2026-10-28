# MakerVerification pre-RLS domain audit

Date: 2026-10-28

Decision: **The Option B compatible preparation candidate is implemented and
proven on the complete PostgreSQL 17 chain; NO-GO remains for RLS or grant
activation.**

Reviewed source baseline:
`857bc94706913a4d5c4368afa99de0a55bb2437c`.

This is a product, privacy, authority, state-machine, concurrency, service,
scalability, recovery, account-lifecycle, test, and rollback audit. It does not
authorize a Production migration, deployment, grant change, or RLS activation.
See `docs/maker-verification-rls-options.md` for the design comparison.

## Product and data contract

`MakerVerification` is the private lifecycle record behind the Guild Member and
Guild Master badges. It contains:

- seller-authored craft and business narratives;
- years of experience and an optional external portfolio URL;
- the current Guild application/review state;
- the staff reviewer identity and seller-visible review notes; and
- application, review, creation, and update timestamps.

The row is not public catalog data. Public pages consume only the resulting
badge state from `SellerProfile`. The applicant may see their own application
and seller-visible decision notes. PIN-verified active staff may see bounded
review queues and perform fixed state transitions. Cron and notification
services may touch the row only as part of an exact Guild lifecycle event.
Account export and deletion need owner-specific access without exposing another
seller's narrative or an internal reviewer identity.

The table is coupled to `SellerProfile`, `SellerProfilePrivate`,
`SellerMetrics`, `Listing`, `Case`, `AdminAuditLog`, `SystemAuditLog`,
`Notification`, and email delivery. RLS on this table must not turn a
multi-table Guild transition into several independently committed writes.

## Schema and current database posture

The table has one row per seller through unique `sellerProfileId`. Both foreign
keys have explicit retention behavior: deleting a seller cascades the
verification row; deleting a reviewer sets `reviewedById` to null. The
`(status, appliedAt, id)` index supports the oldest-first staff queues, and
`reviewedById` has a separate index.

RLS is off on the reviewed source baseline. Runtime provisioning grants broad
`SELECT`, `INSERT`, `UPDATE`, and `DELETE` table authority. There is no public
product need for that broad authority.

The database does not currently encode the full state machine. It has varchar
caps and the enum, but no table checks for:

- `yearsExperience` remaining between 0 and 100;
- review attribution and timestamps matching a reviewed status;
- a pending state clearing stale review metadata;
- the matching `SellerProfile.guildLevel`; or
- the account-deletion sentinel (`REJECTED`, redacted narrative,
  `reviewedAt = NULL`).

Those relationships are currently maintained by application and fixed-function
code. The RLS release must not add a simplistic constraint that rejects the
intentional deletion sentinel or historical valid rows.

## Complete source inventory

### Direct application table operations

| Consumer | Current operation | Principal | Target operation |
| --- | --- | --- | --- |
| `src/app/api/verification/apply/route.ts` | owner Guild Member upsert | active seller | one owner application transition |
| `src/app/dashboard/verification/page.tsx` | duplicate owner Guild Member upsert | active seller | same owner application transition |
| same dashboard page | Guild Master guarded update | active Guild Member | one owner master-application transition |
| `src/app/dashboard/page.tsx` | read status | current seller | owner summary projection |
| `src/app/admin/layout.tsx` | count pending Member applications | PIN-verified staff | staff aggregate |
| `src/app/admin/verification/page.tsx` | list oldest pending Member applications | PIN-verified staff | paged staff queue |
| `src/app/api/account/export/route.ts` | read owner export fields | freshly reverified owner | owner export projection |
| `src/lib/accountDeletion.ts` | redact/reset the seller's row | exact deletion transaction | owner-bound deletion operation |

There are seven direct source files and eight direct operations. The two Guild
Member submission paths currently duplicate validation and persistence logic.
No public page directly reads this table.

### Existing fixed database operations that join or mutate the table

The current migrated schema already has a substantial bounded authority layer:

| Operation | Use |
| --- | --- |
| `grainline_seller_owner_guild_application_state` | owner cooldown/status read |
| `grainline_seller_owner_guild_dashboard_state` | owner application and decision projection |
| `grainline_seller_staff_verification_target` | exact staff decision target and cached metrics |
| `grainline_seller_guild_staff_master_pending` | oldest pending Guild Master queue |
| `grainline_seller_guild_staff_transition` | seven atomic staff transitions plus audit |
| `grainline_seller_guild_member_revoke` | system Guild Member revocation |
| `grainline_seller_guild_metrics_apply` | Guild Master warning/downgrade lifecycle |
| `grainline_notification_create_core` | source-bound Guild notification validation |

The staff operations require the isolated staff database session plus an active
EMPLOYEE or ADMIN actor. The owner projections derive the actor from
transaction-local `app.user_id`. Service transitions validate their source
state and co-commit the related SellerProfile/private/audit changes.

A source-inventory guard must cover both direct Prisma access and SQL function
bodies before activation. Merely removing the seven Prisma delegate files is
not enough: the retained service functions must remain owned by an approved
BYPASSRLS/superuser role and keep exact EXECUTE grants.

## Authority matrix

| Operation | Applicant | EMPLOYEE | ADMIN | Cron/service | Anonymous/other user |
| --- | --- | --- | --- | --- | --- |
| Read application narrative/status | own projection only | review queue/target | review queue/target | exact lifecycle checks only | deny |
| Read reviewer id | no product need | no ordinary need | no ordinary need | exact audit validation only | deny |
| Submit/re-submit Guild Member | own eligible seller only | no | no | no | deny |
| Submit Guild Master | own active Guild Member only | no | no | no | deny |
| Approve/reject applications | no | fixed staff transition | fixed staff transition | no | deny |
| Revoke Guild Member/Master | no | fixed transition | fixed transition | exact reviewed cron transition | deny |
| Reinstate Guild Member | no | deny | fixed admin transition | no | deny |
| Feature/unfeature seller | no | deny | separate SellerProfile operation | no | deny |
| Export | own projection after fresh re-verification | no | no | no | deny |
| Deletion redaction | own exact deletion transaction | no | no | provider-deletion worker for exact user | deny |
| Pending counts/queues | no | bounded | bounded | no | deny |

Direct owner table `SELECT` would expose columns the owner UI does not need,
including `reviewedById`. Direct owner `UPDATE` cannot safely express the
cross-table state machine. Direct staff access is unnecessary because bounded
staff operations already exist.

## State machine that must remain explicit

The supported applicant/reviewer progression is:

1. no row or eligible `REJECTED` row -> `PENDING` Guild Member application;
2. `PENDING` -> `APPROVED` or `REJECTED` by staff;
3. active Guild Member with `APPROVED` or `GUILD_MASTER_REJECTED` ->
   `GUILD_MASTER_PENDING`;
4. `GUILD_MASTER_PENDING` -> `GUILD_MASTER_APPROVED` or
   `GUILD_MASTER_REJECTED` by staff;
5. fixed staff or system transitions revoke/downgrade/reinstate only from their
   named predecessor states; and
6. account deletion redacts the row and leaves a non-active `REJECTED` sentinel.

A Guild Member application also carries the seller's explicit confirmation
that the items they list are handmade by them. The rendered dashboard requires
that attestation, but the separately live JSON application endpoint currently
does not accept or verify it.

Every transition that changes a badge must preserve the matching public
`SellerProfile.guildLevel`, private lifecycle timestamps, and audit evidence in
one transaction. Notification and email are post-commit side effects derived
from the committed transition evidence; failure must not roll back the badge
decision.

## Compatible preparation evidence

The isolated candidate now:

- replaces all eight direct application operations with actor-bound owner,
  deletion/export, and isolated-staff operations while leaving RLS off and the
  predecessor table grants unchanged;
- requires explicit handmade/standards attestations, non-empty sanitized
  evidence, bounded inputs, an active owner, the exact Guild predecessor state,
  and the 30-day reapplication cooldown inside the database transition;
- keeps Guild Master application changes to `MakerVerification` and
  `SellerProfilePrivate` in one fixed operation;
- adds a true Member-pending count plus stable `(appliedAt,id)` cursor page;
- wraps staff transition, Member revocation, and Guild metrics application in
  the shared SellerProfile -> MakerVerification -> SellerProfilePrivate lock
  order while leaving the predecessor implementation private;
- pins owners, security mode, search path, PUBLIC/runtime/staff ACLs and the
  retained wrapper/private-implementation catalog in migration postflight and
  the global grant audit; and
- passes the full migrated PostgreSQL 17 behavior proof for Member apply,
  duplicate conflict, cross-owner export denial, staff count/page and approval,
  Guild Master apply, account-deletion redaction, plus owner/staff and
  owner/cron contention in both winner orders without deadlock.

Status: `COMPATIBLE_CANDIDATE`. The conversion closes gates 1, 2, 4, 7, 9 and
10 for preparation. Gate 3 retains the documented split: the app computes the
eligibility snapshot and the database rechecks actor/account/Guild state under
lock; staff approval remains the final eligibility authority. Activation still
requires executed coverage of all seven staff transitions and both service
transition families, pagination/true totals for the Master and roster views,
the complete inactive/bounds matrix, direct-table denial after ENABLE+FORCE,
and predecessor rollback proof. No Production authorization is implied.

## Findings and activation gates

### `FIX_BEFORE_ACTIVATION`

1. **Guild Member reapplication is an unfenced read-then-upsert transition.**
   Both owner submission paths first read the current state, run eligibility
   queries, then unconditionally upsert the row to `PENDING` and clear review
   metadata. If an ADMIN reinstates the same rejected seller after the owner
   read but before the upsert, reinstatement commits `APPROVED` and
   `GUILD_MEMBER`, then the owner write overwrites the verification row back to
   `PENDING`. The public badge and verification state diverge. Replace both
   paths with one row-locked, actor-derived compare-and-set operation that
   locks the seller and verification row in the canonical order and accepts
   only the exact allowed predecessor state.
2. **Eight direct operations remain.** Policyless activation would break the
   dashboard, both application paths, staff count/queue, export, and deletion.
   Convert them before any grant change. Consolidate the two Guild Member
   submission paths rather than implementing two SQL contracts.
3. **Eligibility and application intent need a deliberate atomicity contract.**
   The current Member application checks listings, sales, account age, and old
   cases before writing; final staff approval checks again. Preserve that
   review-time safety. The fixed submit operation must at minimum recheck actor,
   account, badge, cooldown, and predecessor state under lock. If listing/sales/
   case eligibility remains a pre-submit snapshot, document that staff approval
   is the final authority rather than implying the application row certifies
   continuing eligibility.
4. **Guild Master submission must remain one atomic paired transition.** The
   direct verification update and fixed SellerProfile/private update currently
   share one transaction. The successor should own the whole transition and
   keep its status compare-and-set. Do not keep a direct table update merely to
   call the existing partial helper afterward.
5. **Staff queues are capped at 50 without pagination or true totals (known
   C-941/CASEADM-15).** Member pending, Master pending, active Member, active
   Master, and revoked Member views can hide older rows. The new staff queue
   operation must accept a bounded cursor, return a stable `(appliedAt,id)` or
   approval-time cursor, and expose a separate true count. Featured sellers
   must be queried independently rather than inferred from a capped roster.
6. **Existing lifecycle edge cases must not be silently frozen into the new
   functions.** In particular, a pending Guild Master application currently
   blocks Member revocation (known C-320), and revoked members who reapply can
   remain in the reinstatement roster (known C-1203). Resolve or explicitly
   preserve each behavior with a named test before claiming the root cause is
   closed.
7. **Account export and deletion require dedicated behavior parity.** Export
   includes seller-authored evidence, seller-visible decision notes, and
   timestamps but intentionally excludes `reviewedById`. Deletion scrubs the
   narrative, URL, review attribution and notes and leaves a rejected sentinel.
   The replacement operations must execute inside the existing transaction,
   derive the exact owner from `app.user_id`, and preserve more-than-one-run
   idempotency without granting a generic target id.
8. **Current tests do not prove the complete lifecycle on the real schema.**
   Full-chain tests exercise the owner state projection and exact staff target,
   but staff-transition tests build miniature tables and the application-route
   tests are mostly source guards. Add failing-first PostgreSQL tests on the
   complete migrated schema for owner apply/reapply, Member/Master decisions,
   system revocation, export, deletion, queues, and concurrent owner/staff
   transitions before activation.
9. **Activation must pin all retained function owners and grants.** Every
   installed function whose body references `MakerVerification` must be
   inventory-derived, SECURITY DEFINER where required, owned by an approved
   BYPASSRLS/superuser role, fixed-search-path, PUBLIC-revoked, and granted only
   to its reviewed role. This includes notification and cron functions, not
   only the new MakerVerification helpers.
10. **The two Guild Member submission paths do not enforce the same input
    contract.** The dashboard server action requires `confirmHandmade`, rejects
    a craft description that becomes empty after sanitization, and then writes.
    `POST /api/verification/apply` has no attestation field and checks only the
    pre-sanitized description, so a direct caller can bypass the handmade
    confirmation or persist an empty sanitized description. Consolidation must
    not choose the weaker path. Remove the unused duplicate endpoint or require
    an explicit true attestation and reject empty post-sanitization evidence in
    the single actor-derived operation. Prove both former entry points cannot
    bypass the contract.

### `BEHAVIOR_DECISIONS_OR_DEFERRED_PRODUCT_WORK`

These are real Guild-product issues already recorded in the audit backlog.
They should not be hidden by the RLS work, but they do not justify retaining
broad table authority:

1. Badge rejection/revocation reasons and confirmation are incomplete (known
   C-940/CASEADM-14). The data model can hold bounded notes; product/UI work
   should require and present the approved reason contract separately.
2. Guild Master rejection lacks the rejection email sent for other decisions
   (known CASEADM-16). The conversion must preserve the existing notification,
   and the email consistency fix can land independently.
3. A first-time rejected applicant and a previously approved revoked member
   share `REJECTED`, so current seller copy can call the first rejection a
   revocation (known C-443). A future explicit lifecycle/reason field would be
   cleaner than inferring history from timestamps.
4. System revocation may retain the original human reviewer id even though the
   latest transition was automatic. Keep immutable audit evidence authoritative
   and decide whether `reviewedById` means original reviewer or last human
   reviewer before tightening a constraint.
5. The stored-text sanitizer is a broader fidelity project. Current renderers
   escape the narratives; RLS must not reinterpret or backfill text.

## Recommended fixed-operation surface

The compatible candidate should add or converge these operations:

1. owner Guild Member apply/reapply, including actor, cooldown, state, input,
   and canonical locking;
2. owner Guild Master apply, atomically changing verification and private/public
   application state;
3. owner dashboard/summary projection (existing functions may be retained);
4. owner export projection;
5. owner-bound deletion redaction;
6. staff pending count and cursor-paged Member/Master queues;
7. cursor-paged active/revoked rosters plus a separate featured projection;
8. exact staff target and seven state transitions (retained/converged);
9. retained system revocation/metrics transitions; and
10. retained notification source validation.

Do not create a generic `get_by_id`, `update_status`, or caller-selected
transition function. Operations should derive the applicant from the database
actor context and derive staff/service targets from exact reviewed state.

## Concurrency and lock order

The candidate must publish and test one canonical order. The safe starting
point is:

1. actor `User` row when actor activity is relevant;
2. target `SellerProfile`;
3. `MakerVerification`;
4. `SellerProfilePrivate` and `SellerMetrics` as needed;
5. Case/Listing/Order aggregates through their established authorities; and
6. Admin/System audit evidence and notification source state.

Current verification-id staff transitions lock MakerVerification before
SellerProfile, while profile-id transitions lock SellerProfile first. That
known inversion (C-633) must be removed or wrapped in reviewed transient retry;
the new owner operations must not add a third order. Two-session PostgreSQL
tests must cover owner reapply versus staff reinstate, owner Master apply versus
staff revoke, and cron revoke versus staff decision in both winner orders.

## Privacy and scale

- Owners receive only their own narrative, status, seller-visible review notes,
  and timestamps. They do not receive another seller's row or reviewer id.
- Staff queues are bounded and cursor-paged. Narratives are returned only for
  pending review targets, not the entire historical table.
- Public and anonymous roles receive no table or operation access.
- Cron and notification operations validate exact source evidence and return no
  general-purpose narrative projection.
- The unique seller-profile key supports owner lookup. The existing
  `(status,appliedAt,id)` index supports pending cursor pagination. Roster
  queries need their SellerProfile/private indexes checked with production-like
  data before the hard cap is removed.
- Portfolio links remain HTTPS/public-host normalized and are rendered to staff
  with `noopener noreferrer`; the database operation must retain the 500-code-
  point application limit rather than only the wider varchar limit.

## Failure and recovery

- Duplicate owner submissions converge on one row; a stale predecessor state
  returns a typed conflict without overwriting a staff decision.
- A failed applicant write changes none of the three Guild state stores.
- Staff/system transitions co-commit MakerVerification, public/private badge
  state, and audit evidence. Notification/email failure remains observable but
  does not revert the decision.
- Export is read-only. Deletion redaction is idempotent and can be retried after
  the account provider has already deleted the identity.
- A queue page can be retried from its stable cursor without skipping or
  duplicating a decision target.
- Activation performs no row rewrite and drops no column.

## Acceptance evidence required

Behavior tests must fail on the baseline where applicable and pass against the
complete migration chain on PostgreSQL 16 and the production-major PostgreSQL
job for:

- owner create, rejection cooldown, eligible reapply, duplicate submission,
  inactive/deleted/banned denial, and cross-owner/no-context denial;
- handmade attestation, non-empty post-sanitization evidence, and exact input
  bounds for narrative, experience, and portfolio URL;
- atomic Guild Master application and all seven staff transitions;
- system Member revocation and Master warning/downgrade;
- owner reapply versus staff reinstate in both winner orders;
- owner Master apply versus staff revoke in both winner orders;
- staff queue cursor pagination and true counts beyond 50 rows;
- owner dashboard, export, and account-deletion redaction, including a retry;
- notification source validation after every decision family;
- direct runtime/PUBLIC table and column denial after ENABLE plus FORCE;
- exact retained function owner, ACL, security mode, search path, and source
  catalog; and
- a tested predecessor rollback restoring the prior application statements.

Source-text tests may guard caller and function inventories, but do not count as
behavior evidence.

## Release and rollback shape

1. Add fixed operations while broad predecessor grants remain.
2. Convert every direct caller and deploy the compatible application.
3. Run the full-chain lifecycle and concurrency suite, then inspect Production
   read-only for rows, enum/state combinations, function owners, ACLs, indexes,
   and pending migrations.
4. After the compatible deployment is pinned and predecessor traffic is
   drained, use one reusable private-table activation to revoke direct runtime
   and PUBLIC authority and apply ENABLE plus FORCE together.
5. Production activation requires a separate exact request naming the workflow,
   commit, CI run, migration, and expected effect.

Rollback first restores the reviewed predecessor grants and disables FORCE/RLS,
then restores the predecessor application. Preparation functions may remain.
Rollback must be executed against a disposable full-chain database and prove
the predecessor Member/Master, staff, export, and deletion statements work.
No rollback deletes rows or drops a column.
