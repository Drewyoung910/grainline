# User account-deletion pre-RLS audit

## Scope and exact source

This audit covers the five ordinary application `User` calls and the raw User
row lock in `src/lib/accountDeletion.ts`. The isolated package starts from
local staff/ban preparation commit
`8668c53cc98e7fde7c72c214d81fd45d6342dea4`, itself based on exact accepted
main `66746f47e87a73a6efce2ee6833542be5a86cc57`. Work is isolated in
`.worktrees/user-account-deletion-20261006` on branch
`codex/user-account-deletion-20261006`.

This is compatible source preparation only. It does not authorize or perform
Production SQL, deployment, credential or grant changes, User policies,
ENABLE RLS, or FORCE RLS.

## Required behavior and principals

- A self-service deletion starts only after same-origin validation, a current
  Clerk session, Clerk reverification, literal `DELETE`, rate limiting, and a
  fresh blocker check. Clerk deletion must succeed before local anonymization
  becomes claimable.
- A signed Clerk `user.deleted` webhook may request the same local workflow.
  If legal or transactional blockers remain, the account is banned, seller
  orderability is disabled, and a durable support data request is created or
  refreshed rather than erasing retained obligations.
- Local anonymization is retryable through one exact
  `LOCAL_ANONYMIZE` `AccountDeletionSideEffect`. Stripe rejection and checkout
  reservation repair happen before the large database transaction. The
  transaction locks the User before message redaction and all final account
  mutation.
- The retained side effect must match exact id, target-derived dedup key, empty
  payload, operation kind, and a retryable lifecycle state. The runtime cannot
  supply a free target to snapshot or finalization operations.
- The final User mutation derives deleted Clerk id, deleted email, timestamp,
  role, ban state, and cleared private fields inside PostgreSQL.

## Exact source inventory

The predecessor frontier had 12 direct calls across seven files. Account
deletion contained five of them plus one raw User lock:

| Location | Prior access | Purpose |
| --- | --- | --- |
| Provider-blocked deferral | `tx.user.findUnique` | Read support contact fields |
| Provider-blocked deferral | `tx.user.updateMany` | Ban the retained local account |
| Deletion preflight | `prisma.user.findUnique` | Read lifecycle and seller-provider state |
| Deletion transaction | raw `SELECT ... FROM "User" ... FOR UPDATE` | Serialize against sends and lifecycle changes |
| Deletion transaction | `tx.user.findUnique` | Read the exact private redaction snapshot |
| Deletion transaction | `tx.user.update` | Apply final retained-row anonymization |

The prepared source removes all six direct/raw references. The exact scanner
now reports seven direct read calls across six files, all in the separate
messaging, custom-order, report-target, and owner-preference successor package:

| Remaining family | Calls |
| --- | ---: |
| Custom-order seller and reserved-buyer eligibility | 2 |
| User-report target state | 1 |
| Seller notification preference | 1 |
| Messaging participant and target state | 3 |

There are no ordinary application `User` writes left in the direct scanner.

## Prepared authorities

| Operation | Source binding | Result or mutation |
| --- | --- | --- |
| Provider-deleted deferral | Exact validated Clerk id supplied only after signed webhook verification | Derive one active User, apply the required ban, and return only id/email/name for the support request |
| Deletion preflight | Exact retryable `LOCAL_ANONYMIZE` side-effect id | User lifecycle plus seller id and Stripe connection fields needed before provider work |
| Locked deletion snapshot | Exact side effect; function discovers User, locks User first, then locks and revalidates side effect | Exact User and seller private values needed for redaction and cleanup |
| Final anonymization | Same locked and revalidated exact side effect | Database-derived retained User anonymization; no caller-selected replacement values |

The route passes the exact side-effect id it just retained. The retry worker
passes the exact claimed row id. Completion now updates only that exact id,
user, kind, and dedup tuple.

The canonical runtime-role provisioning script also converges all four exact
function signatures. A later role reprovision therefore revokes ambient and
runtime execution before restoring non-grantable runtime `EXECUTE`; it cannot
silently remove these required calls or reopen table access.

## Validation

- The exact direct-access scanner reports seven calls across six files, all
  reads, with zero ordinary application `User` writes.
- The focused account-deletion and User authority suite passes 65/65 tests,
  including disposable PostgreSQL-compatible execution of preflight, locked
  snapshot, finalization, forged-source rejection, and provider-deleted
  target derivation.
- Targeted lint and diff checks pass; the package diff contains no credential
  patterns.
- The repository-wide database grant-inventory test has an inherited mainline
  expectation gap: its unchanged expected catalog omits the already-landed
  recent User authority family. This package does not treat that unrelated
  baseline failure as proof for or against these four functions; the focused
  test separately pins their role-provisioning convergence.

## Findings and boundaries

### `FIX_BEFORE_ACTIVATION`: enqueue failure could retain the deletion lock

After Clerk deletion, the route enqueues local anonymization before calling the
worker that normally releases the Redis lock. If enqueue itself failed, the
route returned an error without releasing that lock and the user had to wait
for its TTL. The correction runs the owner-token release in the route failure
path. A second release after the worker is harmless because the Lua script
deletes only when the owner token still matches.

### `BLOCKS_RLS_DESIGN`: the side-effect ledger still has broad runtime DML

The snapshot and finalizer reject caller-selected User ids and validate the
exact durable source. This is the correct operation boundary, but
`AccountDeletionSideEffect` remains its own `ALTERNATIVE_REVIEW` service-ledger
group. Until ordinary runtime DML is removed from that table, the durable row
alone is not proof against an arbitrary compromised runtime. This is the same
explicit dependency retained by the accepted Case account-deletion authority.

### `BLOCKS_RLS_DESIGN`: provider authenticity remains outside PostgreSQL

The provider-deleted deferral derives the User from a Clerk id rather than a
local id. Its caller remains the route that verifies the Svix signature and
reserves the exact webhook event before dispatch. PostgreSQL does not attest a
Clerk signature. `ClerkWebhookEvent` is a separate service-ledger hardening
group and must not be described as database-level provider proof yet.

### `PREPARED`: User lifecycle access is fixed and target-derived

The compatible migration adds four narrow `SECURITY DEFINER` operations and
grants only their execution to shared runtime. It does not change User table
grants or RLS state. All snapshot/finalization functions validate the exact
side-effect shape, retain User-first lock ordering, and reject caller-provided
target or replacement values.

## Decision and continuation

**GO for isolated compatible source preparation. NO-GO for Production SQL,
deployment, User grants, policies, ENABLE, or FORCE RLS.**

The subsequent stacked relationship candidate closes item 1 below and moves
the direct-call scanner to zero. The retained list remains the accumulated
activation frontier:

1. preserve the zero-direct frontier established by the relationship package;
2. repeat the raw-SQL and nested-relation inventory across exact accumulated
   source;
3. review and harden the `AccountDeletionSideEffect` and Clerk webhook ledgers
   before claiming arbitrary-runtime resistance;
4. inspect the installed Production function/grant catalog only after all
   source families are closed;
5. prepare separate User ENABLE and FORCE decisions with distinct proofs.

No Production state changed during this audit.
