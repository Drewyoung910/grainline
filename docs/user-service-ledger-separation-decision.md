# User service-ledger separation decision

## Scope

This decision covers `ClerkWebhookEvent` and
`AccountDeletionSideEffect` as dependencies of the `User` table RLS release.
User policyless ENABLE plus FORCE is live and accepted. This record does not
approve either service ledger's own grant change, policy, ENABLE, FORCE,
migration, or Production release.

`AccountDeletionSideEffect` remains an `ALTERNATIVE_REVIEW` service-ledger
group. `ClerkWebhookEvent` is `COMPATIBLE_PREPARATION_LIVE`: its exact fixed
operations and compatible app are live, while broad predecessor runtime CRUD
remains until its own policyless Phase A. That remaining authority must be
removed through the ledger's separate activation review and release.

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

The 2026-10-08 preparation completed the source audit and produced five fixed
operations, generation-fenced finalization, current-provider identity reads,
bounded session revocation, and focused disposable PostgreSQL proof. Exact
source `948945e1a5604232e90116e2d489fc335d458527`, its additive authority
migration, compatible deployment, signed delivery, duplicate retry, retention,
and zero-issue health proof are accepted in Production. See
`docs/clerk-webhook-event-rls-audit.md`.

The separate policyless Phase A package is prepared locally. Its reviewed target
revokes runtime/PUBLIC direct table and column authority, enables RLS without
FORCE, retains only the five fixed operations, and proves rollback and installed
state. Publication, merge, Production inspection, ENABLE, and later FORCE remain
separate release boundaries.

### `AccountDeletionSideEffect`

Complete a bounded audit of enqueue, claim, retry, completion, retention,
operations health, and every User/Case function that treats a side effect as a
source. Replace broad runtime table CRUD with exact fixed operations, then prove
target derivation, deduplication, lock order, crash recovery, direct
runtime/PUBLIC denial, rollback, and installed catalog state.

## Decision

**GO** to treat the two ledgers as independently scheduled table groups. User
policyless ENABLE plus FORCE is accepted independently; ClerkWebhookEvent may
continue through its own prepared Phase A gate, and AccountDeletionSideEffect
retains its own audit and closure criteria.

**NO-GO** to describe either ledger as hardened, change its Production state,
or claim the User boundary authenticates Clerk signatures or resists a stolen
ordinary-runtime credential. User publication, SQL, deployment, grants,
policies, ENABLE, and FORCE remain separately authorized actions.
