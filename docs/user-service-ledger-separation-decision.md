# User service-ledger separation decision

## Scope

This decision covers `ClerkWebhookEvent` and
`AccountDeletionSideEffect` only as dependencies of the pending `User` table
RLS release. It does not approve either ledger's own grant change, policy,
ENABLE, FORCE, migration, or Production release.

Both tables remain `ALTERNATIVE_REVIEW` service-ledger groups. Their current
broad ordinary-runtime CRUD is debt that must be removed in their own product,
authority, retention, operations, and rollback reviews.

## Verified coupling

Neither Prisma model has a relation or foreign key to `User`.
`AccountDeletionSideEffect.userId` is a scalar retained target identifier, and
`ClerkWebhookEvent` is keyed by the Svix event id. Their application consumers
use ledger ids, lifecycle state, bounded queue fields, retention, and aggregate
operations-health counts rather than a Prisma `User` relation.

They are nevertheless trust sources for some User lifecycle work:

- account-deletion User functions validate an exact retained
  `LOCAL_ANONYMIZE` side-effect row; and
- the Clerk webhook route verifies Svix before invoking fixed User lifecycle
  operations and records the provider event for replay control.

This source binding must not be overstated. PostgreSQL does not verify a Clerk
signature. Several fixed User operations accept a server-derived Clerk subject,
so provider authenticity remains an application boundary even if the provider
ledger later becomes policyless and zero-direct. Likewise, current broad CRUD on
`AccountDeletionSideEffect` means the retained row does not establish
resistance to a fully compromised ordinary-runtime database role.

## Release boundary

The two ledgers are **separate from the `User` table activation group**. They do
not block preparation or activation of the reviewed User table boundary when
all of these conditions hold:

1. the User release changes no table or column grant, policy, RLS posture, role,
   or function ACL for either ledger;
2. the User release retains the exact application-verified Clerk and deletion
   call paths and does not claim PostgreSQL-level provider authentication;
3. User fixed operations remain the only reviewed way ordinary application
   source reaches User lifecycle data after direct User grants are retired;
4. the installed User function/grant comparison includes every function that
   reads either ledger and `User`; and
5. both ledger hardening groups remain durably tracked with their own closure
   criteria and cannot be called complete from this decision.

This is a scope decision, not a risk closure. A compromised ordinary-runtime
credential can still exercise the fixed functions granted to that role and can
still directly mutate these two predecessor ledgers until their own releases
retire broad CRUD. The User release must state that residual risk rather than
claim arbitrary-runtime or provider-signature resistance.

## Separate closure criteria

### `ClerkWebhookEvent`

Complete a bounded audit of signed reservation, retry takeover, completion,
failure, retention, and operations-health reads. Replace broad runtime table
CRUD with exact fixed operations, then prove direct runtime/PUBLIC denial,
replay behavior, retention, observability, rollback, and installed catalog
state. Provider signature verification remains in the application route.

### `AccountDeletionSideEffect`

Complete a bounded audit of enqueue, claim, retry, completion, retention,
operations health, and every User/Case function that treats a side effect as a
source. Replace broad runtime table CRUD with exact fixed operations, then prove
target derivation, deduplication, lock order, crash recovery, direct
runtime/PUBLIC denial, rollback, and installed catalog state.

## Decision

**GO** to treat the two ledgers as independently scheduled table groups while
continuing the User installed-catalog gate, guarded source-only authority
migration rollout, compatible-app promotion, and final grant/policy design.

**NO-GO** to describe either ledger as hardened, change its Production state,
or claim the User boundary authenticates Clerk signatures or resists a stolen
ordinary-runtime credential. User publication, SQL, deployment, grants,
policies, ENABLE, and FORCE remain separately authorized actions.
