# User identity/account RLS audit

## Release state update — 2026-10-08

The source program has advanced beyond the historical audit state recorded
below. At base main `c517536b808246f4db43853ed4042390198bb139`, all 53 reviewed
User authority functions and the policyless zero-direct ENABLE candidate exist,
but the User convergence migration, ENABLE, and FORCE are not applied in
Production.

Three pre-activation defects were independently confirmed and corrected in the
isolated branch `codex/user-pre-enable-findings-20261008`:

- historical Notification and Conversation/Message proof workflows now isolate
  the complete User successor set, including the User ENABLE migration;
- runtime-role provisioning now re-closes direct `User` CRUD after policyless
  ENABLE, and both CI and the Production ENABLE workflow replay provisioning
  before accepting the postflight; and
- mixed-case Clerk IDs now receive normalized placeholder emails without
  collapsing case-distinct identities. The correction preserves the historical
  placeholder for lowercase IDs and uses a bounded lowercase prefix plus the
  hash of the original mixed-case ID otherwise.

The corrective migration is
`20261007155000_correct_user_clerk_identity_placeholder`, SHA-256
`b1968d60b24e3472c6ea7a780322f23b30a26804a93531ea9fc66b344cc69418`.
It is packaged with the existing cross-domain convergence workflow, which is
restart-safe for a fresh run, a correction-only partial run, or an already
applied package. The regenerated User ENABLE artifact has SHA-256
`628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f`.

Current decision: **GO for source integration after exact-head CI; NO-GO for
Production SQL or User RLS activation until that source is merged, merged-main
CI is green, and a newly bound Production dispatch is explicitly approved.**
FORCE remains a separate later release boundary.

Two independently confirmed lower-priority findings remain outside this
activation patch: unsigned Stripe Connect requests can create telemetry noise
before signature verification, and the provider-deletion authority can
overwrite an existing staff-ban reason. Neither changes the User RLS database
access boundary; they remain follow-up fixes rather than hidden activation
work.

## Scope and exact source

This audit covers the Prisma `User` model and every application path that can
read or mutate it. The current inventory is based on exact merged main
`d8a6d1c4b96f12015b6f329140b7e4b7a0054914` in isolated worktree
`.worktrees/user-public-identity-20261004` on 2026-10-04.

`UserEmailAddress` is a completed predecessor, not part of the remaining
activation scope. Its policyless ENABLE plus FORCE release is live from exact
main `e689e1ff1d76a65146d132ad25dc545a72b87aac`, CI `37133944427`, and guarded
Production run `37136042748`. It retains zero direct runtime/PUBLIC table CRUD
and six fixed operations.

## Historical decision at audit start

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

After the accepted Clerk, owner-private, unsubscribe, and email-delivery source
packages, the exact scanner reports 31 direct calls in 16 files: 19
`findUnique`, three `findMany`, one `findFirst`, three `count`, two `update`,
and three `updateMany` calls. No full-row direct read remains. The separate
raw-SQL scan now finds 27 `FROM`, `JOIN`, or `UPDATE` references to `"User"`
across 16 source files. Twenty-three of those references across twelve files
belong to public catalog, identity, or aggregate behavior. The retained direct
and raw operations belong to explicitly named later families rather than one
generic cleanup queue.

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

The live package and subsequent source packages reduce the real activation
surface but do not change the NO-GO decision. The email-delivery source package
is merged at exact main `d8a6d1c4...` and its additive Production migration is
accepted through guarded run `37215932608`; caller deployment remains separate.
The local first public-identity package reduces the remaining direct inventory
to 29 delegates in fourteen files. Those calls, 27 raw-SQL references, nested
relations, staff/service operations, lifecycle writes, and installed-function
dependencies still need their reviewed operation families.

## Operation and principal matrix

| Operation family | Principal | Minimum result or mutation | Required boundary |
| --- | --- | --- | --- |
| Resolve current local account | Signed Clerk request | local id, role, ban/deletion, legal gate | Fixed Clerk-id bootstrap projection; no email, shipping, preferences, or public-directory scan |
| Create or refresh identity | Signed Clerk webhook or server-resolved Clerk session | bounded Clerk id, normalized current email, name, image, and co-committed email history | Fixed identity-sync operation retaining unique-conflict and placeholder behavior |
| Read public identity | Public/catalog or relationship-authorized caller | id plus reviewed name/image fields attached to a visible artifact | Domain-bound projection that cannot enumerate unrelated users or return Clerk id, email, shipping, legal, preferences, staff role, or ban evidence |
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

The historical 144-call baseline, current 31 direct calls, current 27 raw-SQL
references, and confirmed nested relations must reach reviewed targets before
table grants change. All current mutations and private/staff reads must be
routed through bounded operations. The accepted Clerk and email families do
not close the remaining public, eligibility, staff, lifecycle, or installed
function work.

### `FIX_BEFORE_ACTIVATION`: public aggregate joins

Catalog and search queries join `User` only to filter banned or deleted actors.
They must use a domain-bound active-user projection or aggregate authority that
cannot materialize private account columns or enumerate unrelated active
buyers. Repeating this predicate across raw SQL does not constitute a reviewed
RLS boundary.

### `DEFERRED_PRODUCT_WORK`: schema normalization beyond the release need

Moving every private `User` field to new normalized tables could improve the
long-term model, but it is not required for the first safe release if public
identity and private operations receive distinct database boundaries. Any
schema split remains a separately reviewed product migration and cannot be
silently bundled into RLS activation.

## Ordered continuation

1. Deploy the merged email-delivery callers only after their separately bound
   application release; their additive database authority is live through
   guarded run `37215932608`.
2. Integrate the first package in `docs/user-public-identity-pre-rls-audit.md`,
   which corrects the three public Clerk-id dependencies and unifies the
   active-member aggregate; then prove domain-bound listing/seller, blog,
   review, and commission projections.
3. Re-run the direct, raw-SQL, nested-relation, and installed-function
   inventories after each cohesive source package without treating one scanner
   as the whole activation surface.
4. Convert the remaining eligibility/service, staff/ban, and
   lifecycle/deletion families in cohesive packages.
5. Run a read-only Production catalog inspection for table/grant/data posture
   and every dependent function.
6. Only after source access reaches the reviewed target, prepare disposable
   PostgreSQL proof, rollback proof, and a separate policyless or projected
   Phase-A decision. Keep FORCE separate.

No Production SQL, deployment, credentials, grants, policies, or RLS state are
changed by this audit.
