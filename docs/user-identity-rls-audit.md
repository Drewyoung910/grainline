# User identity/account RLS audit

## Scope and exact source

This audit covers the Prisma `User` model and every application path that can
read or mutate it. The refreshed inventory is based on source work in isolated
worktree `.worktrees/user-clerk-account-state-callers-20261003`, whose parent is
the exact Clerk-gate caller commit
`1d57b6c859d33c6062a3636f14527260d4c6e878`, on 2026-10-03.

`UserEmailAddress` is a completed predecessor, not part of the remaining
activation scope. Its policyless ENABLE plus FORCE release is live from exact
main `e689e1ff1d76a65146d132ad25dc545a72b87aac`, CI `37133944427`, and guarded
Production run `37136042748`. It retains zero direct runtime/PUBLIC table CRUD
and six fixed operations.

## Current decision

`User` remains **NO-GO for RLS migration, grant revocation, deployment, or
Production activation**. One row combines:

- Clerk identity (`clerkId`, email, name, and image);
- public/cross-user display identity;
- role, ban, deletion, and account-eligibility state;
- legal acceptance and age-attestation evidence;
- buyer shipping address and phone;
- notification preferences and email opt-in epoch; and
- welcome-email lifecycle state.

A broad active-user SELECT policy would make the private fields available on
every active row to the shared runtime role. PostgreSQL column grants cannot
make one set of columns public for all active rows and a larger set private
only for the current user's row. That design is rejected.

Source-only conversion may proceed one operation family at a time after each
family has a bounded return contract. The first family is the Clerk-to-local
bootstrap and identity-sync boundary. It removes the cycle where
`withDbUserContext(...)` needs a local `User.id` that callers currently obtain
through a direct `User` query. This is not permission to prepare or activate
RLS.

## Exact current-source inventory

`scripts/audit-user-direct-calls.mjs` inventories direct
`prisma.user.*(...)` and `tx.user.*(...)` calls without loading application
modules or credentials. The initial audit baseline at
`e689e1ff1d76a65146d132ad25dc545a72b87aac` reported 144 calls in 90 files:

| Delegate method | Calls | Authority class |
| --- | ---: | --- |
| `findUnique` | 122 | read |
| `findMany` | 5 | read |
| `findFirst` | 1 | read |
| `count` | 3 | aggregate read |
| `create` | 2 | identity lifecycle write |
| `update` | 7 | owner, identity, unsubscribe, ban, or deletion write |
| `updateMany` | 4 | welcome, ban, unban, or provider-deletion write |
| **Total** | **144** | **131 reads / 13 writes** |

The most commonly selected fields are `id` (79 direct projections),
`deletedAt` (62), `banned` (59), `role` (26), `name` (25), and `email` (22).
Seven projections read `clerkId`; private shipping fields appear in one direct
projection. Thirteen reads in nine files omit both `select` and `include` and
therefore materialize the full mixed-sensitivity row. Those broad reads occur
in dashboard/order/message identity lookup, `ensureSeller.ts`, and
`ensureUser.ts`.

The separate raw-SQL scan finds 32 `FROM`, `JOIN`, or `UPDATE` references to
`"User"` across 18 source files. Most are public/catalog eligibility joins;
two are owner notification-preference updates. The scan also finds 61
`ensureUserByClerkId(...)` call expressions in 57 files, excluding its
declaration. These callers depend on the full inferred Prisma return type even
when most consume only `id` and account-gate state.

Direct delegates and raw SQL are not the complete surface. Prisma relations
reach `User` through seller profiles, reserved listings, reviews,
conversations, messages, orders, cases, case messages and attachments,
verification, blog authors, notifications, support, follows, commissions,
audit logs, blocks, and reports. A source candidate scan finds 99 inline
nested `select`/`include` candidates in 63 files; this is a lower-bound review
queue, not an assertion that every similarly named relation targets `User`.
Activation requires review of the relation model for each candidate rather
than relying on the name alone.

## First source conversion and live compatibility package

The first bounded conversion is live in Production from main
`f156dd9b28e80e98ec1f5ec422f95eda4a0e0d0f`, CI `37150764030`, guarded
migration run `37152569812`, and deployment
`dpl_5415ejcep8tkBTBENn9nByYrxEGy`. The deployment carries marker
`user-identity-staged-f156dd9b-20261003-01`. This package did not enable User
RLS or revoke a User table grant.

The package adds three `SECURITY DEFINER`, `search_path=pg_catalog`,
runtime-only operations in migration
`20261003100000_prepare_user_clerk_identity_authority`, SHA-256
`1aaebc3f8ef52af7692a4f3701ba39549d3a285e8245976876a16d3cf0bc6bf9`:

- `grainline_user_clerk_gate(text)` returns only local id, role, ban/deletion,
  and legal-gate fields for middleware;
- `grainline_user_clerk_identity_ensure(...)` serializes a Clerk identity,
  creates or refreshes its local row, preserves placeholder and unique-email
  behavior, and co-commits `UserEmailAddress` history; and
- `grainline_user_clerk_account(text)` is a temporary private one-row
  compatibility projection used by `ensureUserByClerkId(...)` and
  `ensureSeller(...)`. It returns the mixed account row, so it is deliberately
  not a public identity projection and cannot be treated as the final User RLS
  boundary. Its argument must remain a server-derived Clerk subject.

`ensureUser.ts`, `ensureSeller.ts`, and the middleware fallback now use those
operations instead of direct `prisma.user` or `tx.user` access. The two
source-only caller packages route 43 Clerk-id account-gate reads in
31 files through `userClerkGate(...)`. The second package also routes 28
id-only lookups in 28 files through `userIdByClerkId(...)`, which selects only
`id` from that same fixed database function. Together the packages replace 71
direct reads across 57 unique files. The resulting direct-delegate inventory
is 65 calls in 37 files: 56 reads and nine writes. It has 47 `findUnique`, five
`findMany`, one `findFirst`, three `count`, five
`update`, and four `updateMany` calls. One full-row read remains, and
the remaining direct writes are confined to seven reviewed files for terms,
shipping, Clerk welcome reservation, deletion, audit, ban/unban, and
unsubscribe behavior. The second caller package has 116 passing focused
source-contract and regression tests. Three additional local test modules
cannot load after the application restart because this isolated worktree has
no installed `marked`, `@prisma/client`, or `sanitize-html`; exact-head CI
must install dependencies and run the complete ordered suite. `git diff
--check` passes.

A disposable PostgreSQL proof applies the existing email-history authority
and this candidate against representative `User` and `UserEmailAddress`
schemas. It proves create, update, duplicate-email fallback, history
co-commit, profile preservation after conflict, blocked-account immutability,
idempotent competing retries, exact function ACLs, and denial of direct
runtime `User` table access. The focused source and regression sets pass
71/71, targeted ESLint passes, and `git diff --check` passes. A local full
TypeScript result is unavailable because the reusable dependency tree has no
generated Prisma client; exact-head CI must regenerate Prisma before the
candidate can be accepted for integration.

The live package and source-only follow-ups reduce the real activation surface
but do not change the NO-GO decision. The remaining 65 delegates, 32 raw-SQL references, nested
relations, public identity reads, owner-private operations, staff/service
operations, and lifecycle writes still need their reviewed operation families.

## Operation and principal matrix

| Operation family | Principal | Minimum result or mutation | Required boundary |
| --- | --- | --- | --- |
| Resolve current local account | Signed Clerk request | local id, role, ban/deletion, legal gate | Fixed Clerk-id bootstrap projection; no email, shipping, preferences, or public-directory scan |
| Create or refresh identity | Signed Clerk webhook or server-resolved Clerk session | bounded Clerk id, normalized current email, name, image, and co-committed email history | Fixed identity-sync operation retaining unique-conflict and placeholder behavior |
| Read public identity | Public/catalog or relationship-authorized caller | id plus reviewed name/image/availability fields | Public-safe projection or view that cannot return Clerk id, email, shipping, legal, preferences, staff role, or ban evidence |
| Read private account | Current owner | own contact, legal, shipping, and preference state | Context-bound fixed owner projections by purpose |
| Accept legal terms | Current owner | terms version and acceptance/age timestamps plus audit row | One atomic owner operation |
| Update shipping | Current owner | seven validated shipping fields | One bounded owner mutation |
| Change notification preferences | Current owner or valid signed unsubscribe token | one validated preference key and opt-in epoch | Separate owner and signed-service operations |
| Check eligibility/recipient state | Named application workflow | only id, role, active state, and email when delivery requires it | Operation-local service projection; no generic directory read |
| Staff search/support | EMPLOYEE/ADMIN plus required PIN | reviewed directory/support fields | Bounded staff projections; PIN remains enforced in the application/session boundary |
| Ban/unban | ADMIN plus required PIN | exact ban transition and audit/side effects | Fixed staff mutations preserving capability, audit, and restoration contracts |
| Delete/anonymize | Reverified owner or signed Clerk lifecycle event | lock, blocker check, redaction, tombstone, and side-effect ledger | Fixed lifecycle operations preserving transaction and recovery order |
| Public aggregates | Public/system aggregate | counts/ranking after active-user filtering | Aggregate functions or public projection joins that return no account row |

## Findings and release effect

### `BLOCKS_RLS_DESIGN`: mixed public/private row

The table cannot safely use one broad owner-or-public row policy. Public reads
must move to a safe projection or explicitly bounded function, while private
owner, staff, provider, and lifecycle access use separate operations.

### `BLOCKS_RLS_DESIGN`: Clerk bootstrap cycle

Database user context needs local `User.id`; current request code usually
looks that id up by `clerkId` before context exists. The bootstrap operation
must accept only a server-derived Clerk identifier and return the minimum gate
state. A route parameter, request body value, or client-selected local id must
never establish database user context.

### `BLOCKS_RLS_DESIGN`: installed function dependencies

Order, Case, Conversation/Message, Notification, DirectUpload, checkout,
payment, shipping, and account-deletion functions already consult `User`.
Before any ENABLE design is accepted, a read-only live catalog must enumerate
every installed function whose body references `User`, with its exact body,
owner, security mode, `proconfig`, ACL, and runtime reachability. FORCE remains
a later decision because owner-executed functions can change behavior when the
table owner becomes subject to RLS.

### `FIX_BEFORE_ACTIVATION`: direct and indirect runtime access

The 144 direct delegate calls, 32 raw-SQL references, and confirmed nested
relations must reach reviewed targets before table grants change. In
particular, all 13 full-row reads and all 15 direct/raw mutation statements
must be removed or routed through bounded operations. Converting only the
Clerk bootstrap family does not close this finding.

### `FIX_BEFORE_ACTIVATION`: public aggregate joins

Catalog and search queries join `User` only to filter banned or deleted actors.
They must use an active-user projection or aggregate authority that cannot
materialize private account columns. Repeating this predicate across raw SQL
does not constitute a reviewed RLS boundary.

### `DEFERRED_PRODUCT_WORK`: schema normalization beyond the release need

Moving every private `User` field to new normalized tables could improve the
long-term model, but it is not required for the first safe release if public
identity and private operations receive distinct database boundaries. Any
schema split remains a separately reviewed product migration and cannot be
silently bundled into RLS activation.

## Ordered continuation

1. Preserve this exact inventory and add focused tests for the scanner's
   direct-call contract.
2. Review and integrate the prepared Clerk bootstrap and identity-sync source
   package. Apply its additive database functions before moving any canonical
   application alias to source that calls them.
3. Confirm the first candidate through exact-head CI and a deployment-disabled
   build; retain the predecessor alias until the additive migration and its
   catalog readback succeed.
4. Complete the outbound email-delivery family in
   `docs/user-email-delivery-pre-rls-audit.md`: fixed recipient/state
   operations, seventeen direct-read conversions, queued-address continuity and
   an explicit relation-backed inventory.
5. Define and convert the public identity/active-user projection, including
   nested Prisma and raw aggregate joins.
6. Convert the remaining eligibility/service, staff/ban and lifecycle/deletion
   families in cohesive packages.
7. Run a read-only Production catalog inspection for table/grant/data posture
   and every dependent function.
8. Only after source access reaches the reviewed target, prepare disposable
   PostgreSQL proof, rollback proof, and a separate policyless or projected
   Phase-A decision. Keep FORCE separate.

No Production SQL, deployment, credentials, grants, policies, or RLS state are
changed by this audit.
