# SupportRequest RLS options

Date: 2026-10-23

Status: Option B approved for isolated implementation on 2026-10-23. The
decision authorizes candidate source preparation only; it does not authorize a
Production migration, grant change, RLS activation, or deployment. The required domain audit is
`docs/support-request-pre-rls-audit.md`.

## Verified starting point

The approved implementation inventory is based on main
`6be29e5bdf4e401598e902aa6520c67cff741205`.
`SupportRequest` contains private support and legal-request data: contact details,
free-text messages, order and listing references, delivery errors, closure evidence,
and staff attribution. The current runtime-role provisioning contract grants
broad `SELECT`, `INSERT`, `UPDATE`, and `DELETE` authority, and the migration
history contains no SupportRequest RLS activation. Production catalog state must
be inspected read-only before release preparation treats either fact as live.

Eight source files access the table directly, plus one retention helper:

- two anonymous or authenticated submission routes create a request and record
  whether the staff email was delivered;
- the admin layout, support queue, and status action count, list, and transition
  requests after staff and PIN checks;
- account export returns requests associated with the user id or current and
  historical email addresses;
- account deletion redacts requester data and staff closure evidence, and may
  create or refresh a legal request when provider deletion must be deferred;
- ops health counts overdue requests; and
- the retention job deletes closed requests after the approved retention period.

Anonymous intake, authenticated ownership, staff review, scheduled maintenance,
and account deletion therefore share the table. A single owner-only policy does
not cover the real domain.

## Required invariants

Every option must preserve these behaviors:

1. Signed-out visitors can submit a support or legal request without gaining any
   read authority.
2. A signed-in request is linked only to the server-resolved local user. Request
   data cannot choose another user id.
3. A requester can obtain their requests through account export, including
   requests linked by retained address history, without reading another person's
   request.
4. Staff queue reads and transitions require the existing staff role and admin
   PIN boundary. Data-request closure still requires evidence, remains terminal,
   and records the staff actor and audit event atomically.
5. Email-delivery result updates can affect only the exact newly submitted row
   and only the allowed pending-to-sent-or-error transition.
6. Account deletion retains the existing redaction, deferred-provider-deletion,
   and transaction behavior. It must not rewrite unrelated people's text.
7. Health and retention operations return only aggregates or bounded deletion
   results and cannot enumerate request contents.
8. No security release drops a column or rewrites retained Production data.

## Options

| Option | Shape | Caller conversion | Protection | Rollback | Main limits |
| --- | --- | --- | --- | --- | --- |
| **A. Direct RLS policies plus service functions** | Keep direct runtime `SELECT` and `INSERT` behind owner/anonymous policies. Revoke direct update/delete. Use fixed functions for staff, delivery results, deletion, health, and retention. | All nine source consumers are reviewed; submission and export move into `app.user_id` transactions, while at least five service/staff operations become functions. | Database row filtering protects owner reads and links authenticated inserts to the current actor. Direct updates/deletes close. | Disable RLS and restore the predecessor grant after switching callers back. | Anonymous insert policy and nullable `userId` are easy to weaken accidentally. Staff and service traffic still need functions, so the policy does not remove much conversion work. New direct owner queries could expose staff-only fields on the same row. |
| **B. Policyless RLS with zero direct runtime authority and fixed operations** | Keep the table intact. Add purpose-bound submission, delivery-result, owner-export, staff-queue/transition, deletion, health, and retention operations. Convert all direct callers, revoke runtime/PUBLIC table and column authority, then ENABLE and FORCE policyless RLS in one activation. | All nine source consumers convert. Repeated submission logic is consolidated. The expected operation set is approximately eight contracts, with exact signatures fixed after the full-chain inventory. | Strong fail-closed boundary: ordinary application code cannot enumerate or mutate the table. Each operation returns or changes only its reviewed shape. New columns do not become readable automatically. | Before activation, deploy the predecessor app because grants remain. After activation, restore the reviewed predecessor grant and disable FORCE/RLS, then roll back callers. No data move is required. | More database operations than Option A. The staff transition must include its audit write atomically, and account-deletion operations need full-chain and concurrency tests. The shared runtime credential can still invoke granted functions, so this limits capabilities rather than replacing credential security. |
| **C. Split private content into a companion table** | Move email, message, evidence, and delivery-error fields into a one-to-one private table; leave workflow metadata in `SupportRequest`. Use functions to write and join both. | Every read and write changes, account deletion spans two tables, and historical rows need a compatibility backfill. | Strong physical separation between workflow metadata and request content. | Maintain both layouts during compatibility and switch reads back. Do not drop old columns in the security release. | Nearly all request data is private, so the remaining table has little useful public surface. The split adds synchronization and migration risk without avoiding fixed operations. |

## Recommendation

Choose **Option B**.

`SupportRequest` has no genuinely public read surface. Anonymous users need one
bounded submit operation, not table access. Owner export is already a specialized
projection, while staff, deletion, health, and retention are service operations.
Policyless RLS and zero direct grants therefore match the domain more clearly
than a nullable-user policy and avoid another physical data split.

This should use a lighter release pattern than SellerProfile:

1. One additive preparation migration installs the fixed operations while the
   predecessor grants remain.
2. Convert callers and deploy the compatible application after failing-first
   behavior tests on the complete PostgreSQL 16 migration chain.
3. One protected activation migration verifies the fixed-operation boundary,
   revokes runtime/PUBLIC authority, and applies policyless ENABLE with explicit
   `NO FORCE`. A later posture-only FORCE migration remains separate so ENABLE
   can be accepted and rolled back before owner bypass changes.
4. Use reusable private-table ENABLE and FORCE workflows plus generic
   catalog/grant proofs. Do not create a new family of one-time per-table
   scripts.

Production activation remains a separate exact-commit operation even after the
design and source are approved.

## Acceptance evidence for Option B

The implementation is accepted only when behavior tests first fail on current
main and then pass on the complete PostgreSQL 16 migration chain for these
boundaries:

- anonymous and authenticated submission, including server-owned user linkage;
- no request enumeration or mutation through direct runtime/PUBLIC table access;
- owner export through user-id and retained-address matches, with a non-owner
  denial case;
- staff queue pagination and terminal status transitions, including required
  legal closure evidence and the matching atomic audit record;
- compare-and-set delivery-result recording for the exact submitted request;
- account-deletion redaction over more than one batch, including unrelated-row
  and unrelated-text preservation;
- deferred provider deletion creating or refreshing only its exact legal request;
- overdue health aggregation without content disclosure; and
- bounded retention deleting only sufficiently old closed requests.

Source-text checks may guard the zero-direct-caller manifest, but they do not
count as proof of these behaviors.

## Decision record

- [x] Approve Option B for isolated implementation (Drew, 2026-10-23).
- [ ] Choose Option A.
- [ ] Choose Option C.
- [ ] Request a revised comparison.
