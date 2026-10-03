# User identity/account RLS audit

## Scope and exact source

This audit covers the Prisma `User` model and every application path that can
read or mutate it. The refreshed inventory is based on exact main
`e689e1ff1d76a65146d132ad25dc545a72b87aac` in isolated worktree
`.worktrees/user-identity-rls-20261003` on 2026-10-03.

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
modules or credentials. On the exact source above it reports 144 calls in 90
files:

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
2. Design and prove the Clerk bootstrap and identity-sync functions, including
   unique email/clerk races, placeholder email, ban/deletion denial,
   `UserEmailAddress` co-commit, and bounded return fields.
3. Convert the bootstrap/identity callers as one source package; do not deploy
   application code before its additive database functions exist.
4. Define and convert the public identity/active-user projection, including
   nested Prisma and raw aggregate joins.
5. Convert self-private, eligibility/service, staff/ban, and lifecycle/deletion
   families in cohesive packages.
6. Run a read-only Production catalog inspection for table/grant/data posture
   and every dependent function.
7. Only after source access reaches the reviewed target, prepare disposable
   PostgreSQL proof, rollback proof, and a separate policyless or projected
   Phase-A decision. Keep FORCE separate.

No Production SQL, deployment, credentials, grants, policies, or RLS state are
changed by this audit.
