# User seller relation reuse pre-RLS audit

## Source boundary and intended behavior

This isolated successor starts at `0947d9ca`, whose publication is tracked in
PR #525. Do not amend or publish this successor under that PR's exact-head
approval. Source preparation here is reversible and has no Production effect.

Seller avatar fallbacks in review reply cards and commission interests should
match the current SellerProfile avatar override, then the User profile image.
The installed `ownerImageUrl` trigger-maintained field already represents that
same fallback; reuse it without extra User relations or per-row lookups.
Reviewer/buyer labels themselves remain separate unresolved User dependencies.

Review creation must reject self-review and inactive seller targets, retain the
fixed delivered/picked-up Order eligibility check and its lock, and notify only
an active target using the existing Notification and email authorities. Reuse
the trigger-bound `ownerAccountActive` fact for those preliminary target reads.
The outward unavailable response stays generic; security telemetry uses
"review target seller inactive" rather than fetching private lifecycle reasons.

Review replies require the authenticated active Clerk owner of the current
listing's SellerProfile. Resolve its local id through the existing Clerk gate;
compare SellerProfile.userId instead of fetching another User.clerkId. Reject
an inactive owner snapshot. Ownership/activity and an empty reply must be in
the final mutation predicate, so stale preflight reads cannot authorize a reply
after target changes. No staff impersonation or public identity lookup is needed.

## Operation/principal matrix

| Operation | Principal | Bounded authority |
| --- | --- | --- |
| Review seller reply-card avatar | Public viewer of the review surface | SellerProfile avatar and ownerImageUrl only |
| Commission interest avatar | Authorized owner or public open-request viewer | Existing interest visibility and seller public fields |
| Review creation target availability | Authenticated active buyer | Current seller id and ownerAccountActive; existing locked Order eligibility |
| Post-review notification | Valid created Review source | Current active seller target plus existing fixed Notification/email operations |
| Review reply | Signed-in active current seller owner | Existing Clerk actor gate and atomic Review predicate bound to actor id |

## Verified finding

`USR-SELLER-REL-01`, **FIX_BEFORE_ACTIVATION**: the predecessor reply route reads
sellerReply, then performs an unconditional update by Review id. Two submissions
can both see NULL and the second overwrite the first, violating the route's
single-reply contract. A listing's owner can also change between that ownership
read and write. Fix with one `updateMany` constrained by unique Review id,
sellerReply=NULL, current SellerProfile.userId=actor id, and ownerAccountActive=true.
An affected-row count of zero returns a conflict without writing another reply.

This preparation does not establish a general User-row lock protocol for all UGC
mutations. Snapshot facts co-commit with User lifecycle changes, while the
statement retains the current source ownership predicate. Later Review RLS
design must separately audit creation, editing, votes, replies and rating summary
serialization. Do not infer strict lifecycle linearization from preflight alone.

## Decision and focused validation

GO for avatar/activity reuse and the atomic reply correction in this isolated
source successor. NO-GO for publishing a changed #525 head, SQL installation,
deployment, User grant revocation, policies, ENABLE or FORCE.

Use focused route tests for missing/banned/deleted/foreign ownership, inactive
seller state and concurrent empty-reply submissions. Type-check changed query
shapes against the current schema. Run no broad or repeat database release proof
unless a new failure requires it.

### Completed local validation

The actual reply route is exercised with isolated framework/database ports in
`tests/user-seller-relation-reuse.test.mjs`: unavailable actor denial before
data access, current-owner/activity denial, competing admitted submissions,
post-read ownership/activity/reply changes, and private response headers.
These are route/conditional-write contract tests; they do not prove PostgreSQL
lock scheduling or strict User lifecycle linearization.

One focused batch passed 40/40 cases across the reply regression, existing
observability, public visibility/determinism, and locked Order review eligibility
guards. Targeted ESLint and a current-schema TypeScript check passed, using the
already-generated isolated client rather than modifying shared dependencies.
No broad database replay, provider call, or Production proof was repeated.

The schema-aware inventory drops from 77 visible relation edges in 37 caller
files to 71 in 34. Six edges are removed across five files. Remaining reviewer
and commission buyer relations, two typed filter definitions, ten static raw User
SQL calls, opaque compositions and service-ledger/catalog requirements still
block User activation. This change introduces no new operation, migration,
grant, policy, RLS enablement, external mutation, or deployment.
