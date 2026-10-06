# User staff and ban pre-RLS audit

## Scope and exact source

This audit covers the remaining staff directory, staff email, moderation ban,
manual unban, ban undo, and ban side-effect repair paths that directly read or
mutate `User`. It began from exact accepted main
`66746f47e87a73a6efce2ee6833542be5a86cc57` in isolated worktree
`.worktrees/user-staff-ban-20261005` on 2026-10-05.

The User public application package from that source is live on all five
canonical Production aliases through candidate
`dpl_BSDP31g6krQTVe1xG1V7igrFnM1w`. This audit does not authorize Production
SQL, deployment, grant changes, User policies, ENABLE RLS, or FORCE RLS.

## Intended behavior and principals

- Admin user search is available only to an active `ADMIN` after the
  session-bound Admin PIN check. Search input is bounded to 200 characters,
  exact email input to 254 characters, pages to 1,000, and results to 30 with
  deterministic `createdAt DESC, id DESC` ordering.
- The reports page is available to active `EMPLOYEE` or `ADMIN` staff after the
  same PIN boundary. It returns at most five top reporters and must redact
  deleted-user identity.
- Direct staff email requires active `ADMIN`, PIN, rate limit, and a body no
  larger than 64 KiB. Recipient state must be rechecked before delivery and a
  banned, deleted, missing, changed, or suppressed recipient must fail closed.
- Ban and manual unban require active `ADMIN`, PIN, self-target rejection, a
  bounded reason, and an account that is neither deleted nor an administrator.
- The local ban transition, seller lockdown, commission closure, Order review
  flagging, and audit snapshot must commit together. Clerk/session revocation,
  checkout expiry, notification, cache, and Stripe checks remain recoverable
  provider effects outside that transaction.
- Retrying a failed provider effect must converge the original operation; it
  must not create another local ban or erase a newer ban state.
- Automated repair is CRON-authenticated, single-run guarded, bounded to 100
  candidate logs and 20 processed candidates, and limited to modern audit rows
  from the last fourteen days.

The Admin PIN is deliberately an application/session control. Bounded reads
and capability minting run only through the separately authenticated
`grainline_staff_read_runtime` login, require its exact `SESSION_USER`, and
independently validate that the local acting User is active and has role
`ADMIN` (or `EMPLOYEE` for the bounded reports projection). The shared
`grainline_app_runtime` login receives only the two one-use ban/unban
capability consumers. Routes retain the Clerk, role and PIN requirements.

## Exact direct-call inventory

`node scripts/audit-user-direct-calls.mjs --json` reported 29 direct calls in
14 files at the audit baseline. The prepared conversion removes all seventeen
calls in the seven staff/ban files. The current source scan reports 12 direct
calls in seven files, all assigned to the remaining account-deletion,
messaging/custom-order, reporting and owner-preference families.

| Caller | Calls | Purpose |
| --- | ---: | --- |
| `src/app/admin/reports/page.tsx` | 1 read | Resolve at most five top-reporter labels with deleted-user redaction |
| `src/app/admin/users/page.tsx` | 3 reads | Count and page the bounded directory; exact-email target lookup |
| `src/app/api/admin/email/route.ts` | 3 reads | Resolve and recheck one recipient before delivery |
| `src/app/api/admin/users/[id]/ban/route.ts` | 1 read | Early admin-target rejection; database authority must repeat it |
| `src/lib/audit.ts` | 2 reads, 1 write | Retry Clerk unban, capture Clerk id, compare-and-set ban undo |
| `src/lib/ban.ts` | 3 reads, 2 writes | Review target, apply ban, and manually unban with audit snapshots |
| `src/lib/banSideEffectRepair.ts` | 1 read | Recheck exact target state before provider repair |

The other twelve calls belong to account deletion, messaging/custom-order
eligibility, reporting, and owner notification preferences. They remain in
their named successor packages.

## Authority and operation matrix

| Operation | Principal | Bounded result or mutation | Required boundary |
| --- | --- | --- | --- |
| Search staff directory | Active ADMIN plus PIN | total count and one deterministic 30-row page of reviewed directory fields and shop display name | Fixed staff operation; database validates actor and clamps query/page |
| Resolve exact staff email target | Active ADMIN plus PIN | id, name and normalized email for one exact account | Fixed staff lookup; no partial enumeration |
| Read report-user labels | Active EMPLOYEE/ADMIN plus PIN | at most five requested ids with name/email/deleted state | Bounded staff batch projection preserving deleted redaction |
| Resolve direct-email recipient | Active ADMIN plus PIN | one active recipient id/name/email, revalidated immediately before send | Fixed staff recipient operation; fail closed on state or address drift |
| Apply ban | Active ADMIN plus PIN | one unbanned, non-deleted, non-admin target transitioned once with exact audit snapshot | Isolated staff login mints a five-minute one-use capability; shared runtime consumes it under actor/target locks |
| Retry ban provider effects | Active ADMIN or CRON repair | Clerk id and seller provider identifiers only for the still-banned target tied to one audit event | Operation-bound projection; never replay local ban mutation |
| Apply manual unban | Active ADMIN plus PIN | exact currently reviewed ban cleared once with restoration/audit state | One-use capability hashes the reviewed `bannedAt`; the consumer repeats the compare-and-set and rejects drift |
| Undo ban | Different active ADMIN plus PIN | exact audited ban reverted once inside undo window | Order restoration and User capability consumption share one transaction, so failure rolls both back |

## Findings and release effect

### `FIX_BEFORE_ACTIVATION`: retrying a failed Clerk ban replays the local ban

The route tells staff to retry when Clerk session revocation fails after the
database transaction commits. The retry entered the entire local ban workflow
again: it replaced `bannedAt`, reason and actor, created another `BAN_USER`
audit row, repeated seller/commission/Order effects, and sent another set of
buyer notifications. This destroys the identity of the original operation and
can make its snapshot-based undo unsafe.

The correction short-circuits an already-banned target into provider
convergence. A modern retry is tied to the exact non-undone `BAN_USER` row
whose `appliedBannedAt` matches current state and uses the existing repair
path. Historical unmatched bans only converge Clerk/session state and record
that narrower action. The initial local update also requires `banned=false`,
`deletedAt IS NULL`, and a non-admin role, so concurrent first attempts cannot
both create ban events.

### `FIX_BEFORE_ACTIVATION`: manual unban can erase a newer concurrent ban

Manual unban reviewed the target before Stripe and capability preparation but
later used an unconditional `User.update({id})`. A new ban committed between
those phases could be cleared by stale unban work. Audit undo already uses the
correct pattern.

The correction mints a one-use unban capability through the isolated staff
login, binding it to the target and reviewed `bannedAt`. The runtime consumer
requires the same timestamp, `banned=true`, `deletedAt IS NULL`, and a
non-admin role under lock. A mismatch returns conflict and the surrounding
transaction rolls back Order restoration, both capability deletions, seller
restoration and the audit row.

### `BLOCKS_RLS_DESIGN`: application-only staff checks cannot authorize table access

Current pages and routes correctly enforce active staff role and the Admin PIN.
The prepared database design also prevents the shared runtime role from
turning a caller-selected administrator id into staff authority: eight bounded
reads/mints require the exact isolated staff session, while shared runtime can
only consume a target-bound, expiring capability once.

### `BLOCKS_RLS_DESIGN`: ban crosses User, seller, commission, Order, audit and providers

A table-local `User` UPDATE policy cannot preserve this product transaction or
the provider recovery identity. The database boundary must keep deterministic
locks, exact snapshots, Order one-use capability behavior, audit coupling, and
bounded recovery metadata. Clerk, Stripe, Redis/cache, email/notification and
checkout provider work remains outside PostgreSQL and must converge by exact
audit id.

### `PREPARED`: direct staff reads and mutations move off broad runtime table authority

All seventeen calls now use reviewed fixed operations. Staff directory search
preserves database-side filtering, counting, ordering and pagination. Ban
repair is bound to the exact non-undone modern `BAN_USER` audit id and matching
current `bannedAt`; it cannot be used as a general provider-id lookup.

The same pass closes a separate email race: if the account disappears, changes
email, or the old email is reassigned between the initial check and delivery,
the route now fails closed rather than sending to the stale address.

### `DEFERRED_PRODUCT_WORK`: dedicated staff directory read model

A separately maintained moderation-directory table could reduce joins and
remove email from the mixed User row, but it adds synchronization and deletion
semantics. It is not required for the first safe release if the fixed staff
operations expose only their reviewed bounded fields.

## Decision and ordered continuation

**GO for the two isolated correctness corrections and fixed staff/ban authority
design. NO-GO for Production SQL, deployment, User grants, policies, ENABLE, or
FORCE RLS.**

1. Re-run raw-SQL, nested-relation and installed-function inventories.
2. Continue through account deletion and messaging/custom-order successor
   packages before a complete User activation proposal.

Focused source guardrails pass 22/22. Disposable PGlite and final staff-role
catalog proofs pass 5/5, including exact role separation, one-use capability
consumption, employee/admin/deleted target rejection, and stale or undone audit
rejection. Focused ESLint and `git diff --check` also pass. No broad test suite
was repeated for this bounded package. The four cumulative User inventory
contracts were advanced to the `12/7` frontier and pass 19/19.

No Production state changed during this audit.
