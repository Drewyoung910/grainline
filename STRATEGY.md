# Grainline Strategy and Roadmap

Operational notes and strategic direction. AGENTS.md is the codebase contract (what is built, how it works, what must be preserved). This file is for what hasn't been built yet, why, and in what order. Update at the end of any session that produces strategic decisions.

## Immediate priorities

### SavedSearch Phase-B and runtime-separation completion (2026-07-21)

Bucket A is complete in production. Deployment
`dpl_6nVQx5HBmurzH9iU1vwQLjA6gy2N` promoted exact commit
`17bf93dc8837fd6c5e6988569f993781800b6318`; migration
`20260720060000_force_saved_search_rls` is complete, `SavedSearch` has exact
`ENABLE` plus `FORCE` and three policies, and the accepted private postflight has
SHA-256
`768096b53662ec9e8deaf8a3a63e6021ad755464f48b4b01c02fb339f1c78ea4`.

Runtime database credential separation is also complete. Production source
`b4f14beaff06831ed2e8d7a35578226b756c1a61` passed exact clean postflight
operator `8438ece93ff93572a015dd674f152c830cb5a52e`; the canonical record is
`docs/runtime-db-credential-separation.md`. Production Functions retain only
the constrained `grainline_app_runtime`; the rotated `NOSUPERUSER BYPASSRLS`
owner remains outside Vercel. This prerequisite subsequently enabled the
separately proven Notification rollout, which is now complete through FORCE.
It does not authorize bundling later sensitive tables or putting an owner
credential back into an application environment.

### Site-wide RLS expansion decision (2026-07-19)

SavedSearch is the first production RLS pattern, not the final scope. Its Phase-B
FORCE release and runtime credential separation are complete. Continue expanding
RLS across user-owned and sensitive data
in the reviewed sequence documented in the RLS feasibility and defense-in-depth
plans, with priority on notifications, carts, conversations and messages,
orders and payment/shipping records, and cases. Each table or tightly coupled
table group requires its own actor/read/write/cleanup inventory,
service/admin/cron/webhook design, staging proof, phased production activation,
rollback proof, and monitoring. Do not enable broad RLS mechanically or copy the
SavedSearch policy/RPC pattern onto tables with asymmetric, participant,
aggregate, public-read, or system-write behavior. Application authorization
remains primary; RLS is required defense in depth for the eventual sensitive
data posture.

Treat this as one site-wide sensitive-data RLS program for planning and status,
but not as one migration or production activation. Preserve the established
meaning of Bucket B as `Notification` so historical rollout evidence stays
unambiguous. Prepare shared inventories and infrastructure across later tables
where useful, then activate independently reviewed, tightly coupled groups.
`Notification` and `Conversation` + `Message` are complete in production
through FORCE and actual pooled-runtime proof. `Case` + `CaseMessage` +
`CaseMessageAttachment` is the active tightly coupled group. Its protected
Phase 2 aggregate-only production inspection completed with zero Cases,
CaseMessages, attachments or anomaly counts, so no legacy cleanup/backfill is
needed; Phase 3 invariant and authority-catalog proof is complete and Phase 4
compatible schema/application conversion is active while production RLS
remains off. The catalog pins the 80-reference Phase 4 baseline across 29
sources to 26 fixed operations. Its first two compatible app conversions move
all three Stripe dispute webhook references and both seller-refund Case
references to fixed database functions, so 75 direct/nested/raw references
across 27 sources remain; all five removed references stay in a
machine-checked conversion ledger. It rejects caller-asserted staff-PIN flags,
generic provider results, free account-deletion targets and caller-selected
cron rows; application PIN/provider verification remain explicit external
trust boundaries. External refund resolution will use a private, FORCE-RLS,
zero-policy `CaseResolutionClaim` service ledger so provider idempotency,
recovery and finalization are database-bound rather than caller-asserted. An
audited administrator finding of no provider effect uses a distinct
`RELEASED_NO_PROVIDER_EFFECT` terminal state instead of falsely recording the
claim as finalized. Stripe-dispute-created Cases record their exact durable
payment-event source rather than fabricating a buyer-authored message, and
dispute reopen clears the complete stale Case-level resolution/refund snapshot
while retaining the Order payment/audit history. Its replay identity belongs
in a separate private, FORCE-RLS, zero-policy
`CaseStripeDisputeApplication` ledger because broadly writable
`SystemAuditLog` is evidence/observability rather than security authority.
The fixed operation must also reject valid but superseded Stripe events; signed
delivery does not imply event ordering.
The seller-refund application slice uses a fixed operation that accepts only
the authenticated seller actor and one exact committed local refund event,
derives the Case resolution and stores immutable replay authority in a private
zero-policy `CaseSellerRefundApplication` ledger. The compatible app
conversion preserves the shared User then Order then Case lock order, validates
the complete database-derived result and leaves no direct Case access in that
route. This does not pull Order/payment into the Case activation:
`Order`/`OrderPaymentEvent` direct-write hardening remains a named dependency
of that later independent sensitive group.
`Cart` + `CartItem`;
`SavedBlogPost`; aggregate/fanout tables; and the order/payment/shipping group
remain later independent groups. Each group must be independently deployable,
observable, and reversible before the next group begins. Never combine
notification fanout, messaging, checkout/payment, fulfillment, and dispute
policy activation into a single release.

Conversation and Message may be designed and activated together because
Message visibility and write validity depend on its parent Conversation. Pin
the complete participant, unresolved-report staff, structured system-message,
custom-order, commission, export, deletion and seller-metrics surface before
drafting authority SQL. The baseline and rollout contract live in
`docs/conversation-message-authority-inventory.md` and
`docs/rls-conversation-message-plan.md`. Direct runtime DML must not survive
activation; user-authored content may be caller input, but recipient, structured
kind, system status and thread side effects must be derived from validated
state.

This program scope is approved, not a menu to narrow silently. Every sensitive
or user-owned table discovered by the coverage inventory must end in one of
three explicit states: production RLS with retained proof; a reviewed database
isolation alternative with rationale; or a named, blocking deferral with owner
and prerequisites. Public catalog data, cross-user aggregates, and internal
service ledgers still require review and may need different database controls;
do not force an owner-policy shape where it is incorrect. Maintain the
schema-complete [`docs/rls-coverage-matrix.md`](docs/rls-coverage-matrix.md)
and never claim that all user data is protected by RLS until every table has an
evidenced disposition.

Before drafting RLS for each sensitive group, complete a table-specific
behavior and security audit. Confirm current product semantics, actor
authorization, integrity constraints, provider/background operations,
retention/export/deletion, concurrency, indexes and test coverage; fix
load-bearing defects first so policies do not encode them. Conversation and
Message are complete; their retained record is
`docs/conversation-message-pre-rls-audit.md`. The active
Case/CaseMessage/CaseMessageAttachment record is
`docs/case-case-message-pre-rls-audit.md`.

Case message/upload preflight must remain a narrow source-validating database
operation rather than depend on broad runtime visibility of the
counterparty's `User` row. A self-only User RLS rollout would otherwise hide
the suspended/deleted state that Case messaging must derive. Keep the fixed
preflight output free of User profile/contact data, retain route-side Clerk and
staff-PIN verification, and keep the final locked reply operation authoritative
for every write and race.

The compatible Case-message preflight application conversion must use one
strict typed result in both the reply and private-evidence upload routes. Keep
missing and unauthorized rows non-enumerating, preserve the route-side staff
PIN and external evidence checks, and never let preflight replace the final
locked reply authority. At that preflight checkpoint the Case inventory was 52
references across 23 files, with twenty-eight of the 80-reference baseline
retained in the converted ledger. This remains preparation, not production
activation.

The bounded interactive Case-message history is also a narrow source-validating
database projection, not a generic INVOKER read. It crosses exact
Case/CaseMessage/attachment rows for both participants and PIN-verified staff,
so broad runtime table/User visibility is the wrong prerequisite. Keep its
SECURITY DEFINER output limited to message fields, durable or
relationship-derived author kind, and attachment id/content type/size/time;
never return User profile/contact fields, DirectUpload ids or object keys.
Retain the 51-row hard cap and stable `(createdAt,id)` cursor. Unknown legacy
non-party authors remain unlabeled rather than being inferred as staff from
mutable current role.

The compatible Case-message page application candidate uses this operation for
buyer, seller and staff detail pages through one strict typed validator. It
removes mutable User-name joins from message labels and moves the direct
message plus nested attachment reads to the converted ledger. The current live
Case-family inventory is 50 references across 22 files, with thirty of the
80-reference baseline retained in the converted ledger. This remains
preparation only; production Case-family RLS is still off.

Keep the PII-free Case-detail projections separate from the cross-user staff
queue. One Case by id, one Case by Order and the staff active count may remain
SECURITY INVOKER after setting transaction-local actor context. Their fixed
result must not expose the raw Stripe refund id, User contact/profile fields,
payment-source provenance or attachment/object identifiers, and UTC database
timestamps must cross the SQL boundary as `timestamptz`.

The staff Case queue is not one of those ordinary reads. It needs minimal
buyer/seller contact fields for PIN-verified staff, which future self-only User
RLS should hide from the runtime role. Keep it as a separate, narrow
source-validating SECURITY DEFINER projection rather than granting broad User
visibility or adding PII to the shared participant Case result.

Case/CaseMessage Phase 2 may proceed while the DirectUpload cleanup-only R2
credential is created because the Case inspection is owner-only, read-only and
aggregate-only. The two tracks rejoin before activation: DirectUpload must
complete its cleanup credential proof, activation and pooled-runtime postflight
before private Case evidence is enabled or Case policy activation is claimed.
The saved Case inspector must run before the staged DirectUpload
compatibility-key retirement because it pins the current dual-column
compatibility posture. Production inspection results authorize classification
only; any cleanup/backfill or invariant mutation waits for the actual counts.

Case photo evidence is a launch requirement, not a later generic messaging
feature. Before Case policy SQL, add private-object-backed processed image
evidence tied to CaseMessage, with server-verified object ownership/metadata,
authenticated short-lived retrieval, and explicit participant visibility,
export, deletion, and retention behavior. Do not use the public R2 message
attachment path, accept arbitrary external URLs, or activate the attachment
table separately from its parent Case boundary. PDF evidence remains prohibited
until a reviewed malware-scan/quarantine pipeline exists.

Keep the private Case path fail-closed during its compatibility rollout.
`CASE_EVIDENCE_ATTACHMENTS_ENABLED` is absent or exact `false` while the
schema/fixed-operation app deploys and drains. Only the exact lowercase `true`
may be promoted after DirectUpload activation and pooled-runtime postflight,
private-bucket isolation/credential proof, and authenticated
participant/staff-versus-foreign-user route smoke all pass. This breaks the
otherwise circular dependency between deploying compatible code before RLS
activation and withholding sensitive private-object access until that boundary
is proven.

The Case evidence review exposed a separate pre-launch privacy requirement:
ordinary Message attachment bytes currently use public R2 bearer URLs even
though their Message rows and attachment references are protected by FORCE
RLS. Complete the current Case lifecycle proof checkpoint first, then run a
separately reviewed Message private-object compatibility and legacy
classification pass before Case policy activation. Reuse private-bucket
primitives where appropriate, but do not bundle ordinary Message attachment
authority, legacy object mutation or proof claims into the Case activation.
Keep new private direct-message uploads image-only unless malware scanning and
quarantine for PDFs are explicitly designed and proven.

For the active Case lifecycle checkpoint, proof fidelity is part of the gate:
the first accepted 14-ordering PostgreSQL run remains valid only for its modeled
subset because its mark-resolved/cron helpers used stronger post-lock time
semantics than the corresponding application routes and did not contend staff
resolution against replies. Exact hardening head `4dc57266` passed all 21
corrected two-session orderings in disposable PostgreSQL run `30218521286`
after the final private-lifecycle review changed the migration bytes; exact
general CI `30218522907` also passed. The run used the real refund sentinel,
Order-then-Case locks and post-wait PostgreSQL timestamps. Preserve that
expanded proof as the compatible-integrity baseline; later database invariants
and fixed RLS authority still require their own review and proof.

The ordinary Message private-object pass has its own execution contract in
`docs/message-private-object-remediation-plan.md`. Preserve one Message per
attachment for the first release, store new object identity in a private
one-to-one child that references rather than duplicates the `DirectUpload`
key, keep new sends image-only, and classify legacy public URLs before
separately approved copy/rewrite/deletion. Legacy UploadThing/UTFS URLs are a
separate allowlisted provider class, not R2 keys; copy and retirement need
their own bounded fetch/delete evidence. Fixed database operations constrain
behavior but do not authenticate their asserted participant ids; Clerk,
server-side actor resolution and exact call-site guards remain load-bearing.
`DirectUpload` remains a separate shared lifecycle RLS group (CM-A21); do not
silently bundle its cross-product authority into Message or Case. Complete
that separate rollout before production promotion of either private-object
path.

The CM-A21 execution contract lives in `docs/direct-upload-rls-audit.md`.
Public media needs a normalized multi-reference ledger because seller-owned
images may validly appear in more than one Listing/Profile/Blog/Broadcast
source; private Case/Message objects stay single-reference. The target posture
is FORCE RLS with no direct runtime table access and only fixed
record/verify/reference/release/export operations. Cleanup lease/complete/fail
must use a dedicated NOBYPASSRLS worker role rather than the ordinary request
runtime because the worker necessarily receives bounded cross-user object
keys. Refactor private
attachment children to reference the lifecycle row rather than duplicate its
key. Production promotion waits for aggregate legacy inspection, reference
backfill, exact PostgreSQL proof and pooled-runtime postflight.

CM-A21 preparation now uses a service-only reference ledger plus
source-derived public family operations; the generic application claim API is
removed in the draft. Public reuse is reference-counted, source deletion
releases references through database triggers, and Listing/Review mutation
paths defer object deletion to the fenced cleanup worker after the last
reference. This is still compatible preparation only: DirectUpload RLS remains
off and its old table grants remain until the reviewed activation/drain split.
Production now has the four PR #58 Case/CaseMessage preparation migrations and
compatible app at exact commit
`da4489ace5a592880a325c3e6f90bad7ded8ee37`, with Case evidence disabled at
build and runtime. It does not yet have the DirectUpload reference-ledger,
authority or public-reference preparation migrations.
The earlier exact preparation tree passed PostgreSQL 16.14
authority/concurrency proof in run `30225445722`; retain that evidence without
treating it as activation. A later Extra-High review correctly superseded it:
the Case child conversion must retain `objectKey` temporarily, database-derive
and validate `directUploadId` for old writers, dual-write from the new app, and
create/release normalized references through triggers. After compatible app
deployment and old-instance drain, separately prove equality and drop the
duplicate key before DirectUpload activation. The amended exact tree requires a
fresh disposable PostgreSQL proof. That proof is now accepted at exact commit
`6c1dba12`: PostgreSQL 16.14 run `30226543504` applied all 166 migrations and
passed the global grant/RLS audit plus six authority/concurrency checks,
including old/new Case attachment binding and release. It recorded no
persistent-staging or production change. Treat it as compatible-preparation
evidence only, not activation. A subsequent exact-old-writer review found that
the Case route fills legacy `claimedById` after its attachment insert; the
insert reference trigger therefore must be deferred until transaction commit,
not immediate. The corrected harness executes that full old transaction and
the new dual-write transaction. This supersedes the run for release
compatibility. The corrected exact tree passed GitHub Actions run `30226904740`
(job `89858487348`) at commit `ce4a914b` on PostgreSQL 16.14: all 166
migrations, runtime-grant convergence, global grant/RLS audit and all six live
authority/concurrency checks passed, including both full old/new writer
transactions. It recorded no persistent-staging or production change. Treat
this as compatible-preparation evidence only, not DirectUpload activation.

Do not activate DirectUpload or enable either private-object surface until
aggregate legacy classification/backfill, the dedicated cleanup-worker role,
rollback and pooled-runtime postflight gates are complete. The compatible
schema/application checkpoint may be promoted first only with
`CASE_EVIDENCE_ATTACHMENTS_ENABLED=false`; that disabled release is what makes
the required old/new application drain possible. Withhold the unused future
private-message recorder from ordinary-runtime activation until CM-A20's
compatible application release consumes it.

The DirectUpload aggregate-only legacy inspector and its protected serialized
workflow are now saved. Exact disposable PostgreSQL 16.14 run `30228466175`
(job `89862786290`) at `c748758e` passed all migrations, grant convergence,
global catalog audit, the six retained authority/concurrency checks and the
seventh `aggregate_only_legacy_query` check, with no persistent-staging or
production change. This proves the count query executes against the compatible
schema; it does not classify production and does not authorize backfill,
constraint validation, object mutation or activation.

The final 2026-07-27 Extra-High authority review then found two
pre-production gaps: the new SellerBroadcast image path did not fail closed on
an `untracked=1` cleanup race, and account-deletion media functions rejected
already-banned accounts because they reused interactive actor validity. The
broadcast create now requires every selected image to be tracked inside its
serializable transaction. Account URL collection/release now allows an
existing, not-yet-deleted banned account while ordinary upload/export
operations remain denied. The proof harness adds an eighth
`banned_account_lifecycle_cleanup` check. This migration edit supersedes
`30228466175` for release. Fresh exact-tree PostgreSQL 16.14 run
`30327497254` (job `90175815165`) passed at executable commit `546c112f`: all
166 migrations, production-style grant convergence, migration status, the
global grant/RLS audit, static contracts and all eight live checks passed. It
recorded no persistent-staging or production change. Treat it as compatible
preparation evidence only, not DirectUpload activation.

The cleanup credential must not be added to the main Vercel project. The
existing runtime isolation guard intentionally rejects every PostgreSQL URL
outside `DATABASE_URL`, and co-locating a worker URL would expose it to the
same application-compromise boundary it is meant to escape. The accepted
activation design uses a separate protected GitHub environment,
`Production DirectUpload Cleanup`, with the dedicated direct Neon worker URL
and a cleanup-only R2 credential scoped to the two exact buckets. The worker is
bounded, non-overlapping, does no bucket listing, verifies FORCE/ACL posture
before leasing, and retains only sanitized mode-0600 count/hash evidence.
Provisioning creates no role or password; the external LOGIN and secrets
require their own reviewed provider step. This scaffold remains manual-only.
Add its hourly schedule in the activation release that removes the Vercel
cleanup schedule, after the external worker boundary and failure notifications
are proven.

Provider preparation began on 2026-07-28 without activating cleanup. The
main-only protected `Production DirectUpload Cleanup` GitHub environment now
exists, and the dedicated direct Neon LOGIN
`grainline_direct_upload_cleanup` was created on the production branch. Its
connection URL is stored only in that environment, alongside its SHA-256
digest; it was not copied into Vercel or the ordinary Production environment.
The role must be converged and proved through the exact-main owner-only
`DirectUpload Cleanup Role Provision` workflow before it is usable. That
operator preserves compatible runtime authority and proves in a read-only
postflight that DirectUpload RLS is still off.

The first provider role was created through the Neon API and was correctly
rejected before receiving any cleanup grant: Neon API roles inherit
`neon_superuser`-class attributes and membership. Replace that unused role
through the guarded SQL-role provider-remediation operator, rotate the
protected cleanup URL, then rerun the exact-main role-provision workflow.
Do not weaken the cleanup-role posture to accommodate provider defaults.
PostgreSQL 16 does force one narrowly reviewed reverse bootstrap edge when
`neondb_owner` creates the replacement through SQL: `neondb_owner` is a member
of the cleanup role with ADMIN only, INHERIT/SET disabled, granted by
`cloud_admin`. This cannot be removed by the non-superuser creator. Accept only
that exact non-effective edge (or zero edges if a provider superuser removes
it); continue requiring zero cleanup-role parent memberships and no other
direct or transitive members.

The first actual replacement attempt at exact main `f66aa92f` safely crossed
only the provider-delete boundary, then failed before the SQL replacement
committed. The cleanup role is absent and the protected secret/digest remain
the rejected, now-unusable values; RLS, grants, data, deployment, cleanup and
R2 are unchanged. Resume only through the explicit already-deleted-role path:
prove provider and catalog absence, prove the exact-name ordinary replacement
inside rollback, create it once, authenticate directly, then rotate only the
protected cleanup secret and digest. The normal path must also wait for
database-catalog absence after Neon reports deletion complete so this
non-replayable boundary cannot recur.

The first guarded already-deleted-role recovery at exact main `1d4c5fe2`
passed every rollback-only check, then failed inside the committed
replacement-create step. Reconciliation again found the role absent and the
protected secret/digest unchanged. Preserve the safe absent-role state while a
bounded SQLSTATE-only diagnostic is reviewed; do not print raw database errors
or weaken the replacement posture to make the create pass.

The SQLSTATE diagnostic classified the repeated exact-name commit as
PostgreSQL `XX000`, while both rollback probes passed and every failed
transaction left the role absent. Retire that provider-tombstoned identity.
Use `grainline_direct_upload_cleanup_v2` as the cleanup principal, keep the old
name separately forbidden, and remove the provider-delete path entirely.
Because the principal is embedded in generated activation ACLs, a fresh full
disposable activation plus database-first rollback proof is required before
creating the versioned production login.

That fresh versioned proof passed, but the first exact-main `v2` production
creation also failed at commit with PostgreSQL `XX000` and left both role names
absent. This disproves the narrower assumption that only the deleted name was
blocked. The remaining shared operation is supplying a client-built SCRAM
verifier to Neon SQL, the same credential path already retired for the owner
rotation after `XX000`. The next guarded candidate must instead pin
`password_encryption=scram-sha-256` and pass the generated password only
through process memory/`psql` stdin so PostgreSQL performs the hash. Never put
the password in argv, logs, evidence or git, and retain every existing
attribute, membership, target and direct-authentication assertion.

Exact main `9c853676` proved this correction in production: the v2 ordinary
login committed, authenticated directly, retained only the reviewed
non-effective reverse bootstrap edge, and rotated only the protected cleanup
URL/digest. The first three-function provision run then failed before grants
because the older global migration-owner guard had not incorporated that
already-reviewed third membership row. Keep the edge accepted only as
`ADMIN=true`, `INHERIT=false`, `SET=false`; update every shared owner-posture
contract together, and rerun the protected provision workflow from fresh exact
main. Do not broaden the acceptance to arbitrary child roles or options.

That correction merged as exact main `4f859fc8`, and protected run
`30409531954` (job `90442358212`) passed the exact-main preflight,
three-function cleanup grant, read-only postflight and sanitized artifact
upload. The v2 role now has only the reviewed cleanup functions and no
relation, column, sequence, default, create, parent-role or unexpected
DEFINER authority; compatible runtime access remains intact and DirectUpload
RLS remains off. The next gate is the cleanup-only, bucket-scoped R2 deletion
credential plus disposable-object delete proof. Do not reuse application R2
credentials or promote/schedule DirectUpload activation before that gate.

The cleanup-only R2 deletion credential is still absent because no signed-in
Cloudflare control surface was available. Do not substitute the application's
R2 credential. Keep the worker, hourly scheduler and DirectUpload activation
blocked until a cleanup-only key is scoped to the exact public/private buckets
and its provider deletion behavior is proved.

The retained proof path is deliberately independent of the cleanup worker:
the worker must fail closed until DirectUpload is FORCE-protected, while the
credential must be proved before activation. A manual-only protected GitHub
workflow therefore writes, heads, deletes and re-heads one random disposable
object in each exact bucket, receives no database or application R2
credential, performs no bucket listing, and records only sanitized hashes and
bounded outcomes. Any possible residual object fails the gate.

The 2026-07-28 Extra-High review also widened the cleanup-role invariant from
the DirectUpload function namespace to every accessible public
`SECURITY DEFINER` function, both role-membership directions, column-only and
table-like relation grants, default grants, and exact DirectUpload function
security posture. Pure public `SECURITY INVOKER` validators remain callable but
carry no owner authority and the cleanup role has no underlying relation
privileges. The older seven-check cleanup-role proof is superseded. Exact-tree
disposable PostgreSQL 16.14 run `30329597171` (job `90181797774`) passed at
executable commit `e407271e891f59330b20fb50a127b21f2a598364`: all 166
migrations, runtime and cleanup-role convergence, migration status, the global
grant/RLS audit, static contracts and all eight live authority/lifecycle checks
passed, with no persistent-staging or production change. This accepts the
scaffold's hardened database authority partition only; live provider
credentials, R2 deletion, scheduling and DirectUpload activation remain
separate gates.

The compatibility-key retirement and DirectUpload activation candidates are
now saved on a further isolated stack, still unapplied outside disposable CI.
The retirement boundary drops only the duplicate Case attachment key after
exact legacy/reference proof; the disabled app persists only
`directUploadId`. Activation retains zero policies and zero direct table
authority, partitions the 35 reviewed functions as 17 runtime / 3 cleanup /
15 private, and withholds the unused private-message recorder. A
database-first compatibility rollback is part of the activation gate and
restores the exact activated state afterward without recreating the retired
duplicate key.

The first combined disposable run (`30232279615`, commit `af4d0f8e`) stopped
fail-closed while applying activation after retirement; Prisma surfaced only
the secondary aborted-transaction message. It is not activation evidence and
changed no persistent environment. Preserve the failed record and require a
fresh PostgreSQL 16 run with exact statement diagnostics, live activated
authority, rollback and zero-residue restoration before promotion. This does
not change production sequencing: compatible disabled app and drain,
aggregate-only production inspection, separately approved repair/backfill,
provider/worker proof, activation, pooled-runtime postflight, then a separate
Case private-evidence release.

Diagnostic run `30232434982` exposed the underlying failure as one missing
parenthesis between two activation postflight ACL predicates. The activation
transaction had reached its final audit after applying its revokes, grants and
RLS flags, so PostgreSQL's transaction rollback prevented any partial state.
The syntax and class-specific regression contract are corrected; the run
remains failed evidence and a fresh exact PostgreSQL pass is mandatory.

Run `30232549766` subsequently proved the corrected activation SQL applies and
both roles reconverge, but the global audit stopped on its older expectation
that all four compatibility/cleanup functions stay runtime-executable. Keep
the least-privilege design; the audit now derives the activated private set
from the exact 35-function catalog. This run also remains failed disposable
evidence and does not satisfy the live-authority or rollback gate.

Run `30232738558` passed the activated global audit and migration status but
then reran an unstaged-tree cardinality test after intentionally adding both
disposable candidates. Keep that source-inventory contract before staging;
post-staging, run only state-independent harness contracts. The run remains
failed evidence because live activated authority and rollback did not execute.

Run `30232827314` reached live activated catalog proof after every preceding
gate passed, then stopped because its identity comparison used PostgreSQL's
named-argument display against a type-only callable catalog. Use
`oidvectortypes(proargtypes)` in both live proofs; do not weaken the exact
identity comparison. Behavioral authority and rollback still require a fresh
pass.

Exact commit `7de1b836` passed the complete disposable CM-A21
retirement/activation program in PostgreSQL 16.14 run `30232923132` (job
`89875033710`): 166 committed plus 2 staged migrations, compatible and
activated global audits, exact 17/3/15 function partition, direct table
denials, fixed runtime behavior, cleanup lease fencing, database-first
old-app-compatible rollback and exact activation restoration. Both proof
payloads recorded no persistent-staging or production change. Treat this as
accepted disposable-engine evidence only; all production/provider/legacy
inspection and feature-release gates above remain mandatory and separately
approved.

Final proof commit `6449d722` passed PostgreSQL 16.14 run `30233243581` (job
`89875935635`) after adding explicit foreign Case-attachment denial and
post-rollback `objectKey`-absence checks. That run remains useful design
evidence but is superseded for release by the later cleanup-role hardening and
integrated SQL review. Both generated candidates must take their fixed-order
exclusive table locks before inspecting mutable state; activation must reject
both role-membership directions and any non-ordinary DirectUpload catalog
entry. A fresh exact-tree disposable activation and database-first rollback
pass is required. These corrections do not change any production gate or
authorize promotion.

The corrected exact-tree PostgreSQL 16.14 run `30330329787` (job
`90183904860`) passed at executable commit
`b843e21e88bfa79f4951e2e18329408671b9f49a`. It repeated the 166-migration
compatible authority program, staged the reviewed retirement and activation
candidates (SHA-256 `adbad525ca29a6ea42227d3b196659a04b8a39daf0dbb06a859ba3b5dca3a9d6`
and `fe4da53160f2add8a7303bcca0a6bc310b07cdb02e16c39213cabf63a56cec21`),
then passed activated role convergence/global audit, the four live authority
checks and database-first rollback/exact restoration with no
persistent-staging or production change. This accepts disposable database
evidence only; every production/provider/legacy/drain/private-feature gate
remains separate and explicitly approved.

### Messaging architecture decision (2026-07-22)

Keep one ordinary Conversation per unordered participant pair. Do not create a
new inbox thread for every listing: that fragments the relationship, duplicates
blocking/reporting state and becomes noisy for active buyers and shops. Preserve
the listing that prompted a message on the individual Message instead. The
nullable, source-validated Message Listing context is a pre-RLS compatibility
requirement, not permission for callers to select arbitrary private listings.

`isSystemMessage` means server-generated structured presentation, not database
authority. Commission-interest and custom-order-ready cards use it; a
buyer-authored custom-order request does not. Authorization always comes from
the durable source relationship and fixed operation.

Do not give staff a general read/write bypass into ordinary buyer-shop threads.
Exact unresolved-report review remains read-only. `/support` already provides a
reference-numbered request and staff queue, while Case/CaseMessage provides
staff-visible dispute discussion. If Grainline later needs Etsy-style in-product
staff outreach, build visibly branded SupportThread/SupportMessage records with
assignment, audit, retention and separate RLS rather than impersonating a user
or reusing ordinary Conversation.

The Conversation/Message relational shape, bounded keyset windows and compound
indexes are intended to support 50,000-plus registered accounts. That is not a
50,000-concurrent-stream promise. The current SSE endpoint holds a serverless
response and polls PostgreSQL every 3–10 seconds per open thread; move delivery
to managed realtime/fanout before sustained high concurrent messaging while
retaining the same participant-scoped database read contract.

Deploy the nullable Message listing-context relation and read indexes as an
additive compatibility release before the application checkpoint. Its exact
migration phase is `conversation-message-compatibility-reviewed`; it does not
enable RLS, narrow grants or authorize the later authority migration.

The following messaging product work is intentionally after ordinary
Conversation/Message RLS and is not an activation prerequisite:

- visibly branded `SupportThread`/`SupportMessage` staff outreach, followed by
  an optional customer-visible history for existing `/support` requests;
- managed realtime/fanout once sustained concurrent open threads make the
  current SSE database polling inappropriate;
- convenience features such as typing indicators, reactions, editing/deleting
  user messages or richer delivery/read receipts, each with its own retention
  and abuse semantics;
- Case/CaseMessage product upgrades such as evidence attachments, staff
  assignment/SLA tooling and a deliberate appeal/reopen policy. Evaluate these
  during the separate Case pre-RLS audit rather than coupling them to ordinary
  messaging activation.

These are named deferrals, not forgotten work. Per-listing ordinary threads are
not deferred: that alternative was reviewed and rejected in favor of one pair
thread plus per-Message listing context. Attachment kind normalization,
message-search indexing, long-history pagination, timestamp correctness and
mobile horizontal-overflow repair remain in the current pre-RLS scope.

Durable scale review triggers and the reasoning behind these deferrals live in
`docs/scaling-decisions/`. Update the relevant record when production evidence
changes a threshold or architecture decision so deferred work is not mistaken
for forgotten work.

### Prelaunch RLS rollout proportionality (2026-07-22)

The confirmed prelaunch/no-dependent-users state permits shorter operating
windows, not weaker policy or compatibility proof. Do not impose a fixed
12-hour drain or repeat an unrelated provider benchmark solely for ceremony
when there are no customer requests to drain. Before compressing a wait,
reconfirm that no customer traffic, webhook, cron, queue, or administrator flow
can still use the superseded shape. Preserve the evidence explaining why the
shorter window was safe.

Keep the controls that catch correctness and release-shape defects even before
launch: ephemeral PostgreSQL authority/direct-denial/race proof; exact grants
and function ACLs; legacy-data inspection and backup before destructive
cleanup; atomic purge/backfill decisions; old/new application and database
compatibility; authenticated route smoke; and database-first rollback
semantics. Use separate preparation and activation migrations whenever an old
application build cannot safely coexist with the narrowed grants or new policy
surface. The absence of users does not stop Vercel build overlap, cron, or
webhook execution by itself.

Provider performance/locality proof is risk-triggered after Bucket B rather
than automatic for every table. Require it for a new hot path, interactive
transaction or pooling design, lock/concurrency behavior, cross-region change,
or material source-validation joins. Ordinary direct-owner tables may rely on
ephemeral PostgreSQL plus authenticated application smoke when review shows no
new provider/runtime performance question. Notification still requires a fresh
successful provider run because its real one-statement recipient RPC and
source-validation workload have not yet completed once in Vercel. Continue to
activate Notification, messaging, orders/payment/shipping, and cases as
separate tightly coupled groups; prelaunch is not permission to combine their
authority boundaries into one release.

### Runtime owner-credential separation result (updated 2026-07-21)

The release is complete and accepted in production; retain the exact contract,
failed-attempt history, evidence hashes, rollback posture, and operator rules in
`docs/runtime-db-credential-separation.md`. Vercel application builds must never
run owner migrations or receive an owner/admin database variable. Production
migrations run only from the manually approved, main-only GitHub `Production`
environment, and automatic Vercel production deployment from `main` remains off
so migrations and application promotion cannot race. The owner credential lives
only in that protected environment and ignored mode-0600
`.env.migration-owner.local`; `.env.local` is runtime-only. Any ambiguous future
control-plane reset must use reveal-based recovery and must never blindly issue
a second reset. Do not weaken the production-equivalent `LOGIN NOINHERIT`
runtime role fixture or the Vercel privileged-variable guard.

### Bucket B Notification design decision (2026-07-19)

Bucket B Notification RLS is complete in production from merged main commit
`213f2f1d036967cacae4ac217307376efbd7c812`: Notification has exact
`ENABLE` plus `FORCE`, two recipient policies, and narrowed runtime grants.
The compatible application remains live as Vercel deployment
`dpl_92rXcp1PqmoMPtgtAswbecAKWEt2`. The full operating record remains in
`docs/rls-bucket-b-notification-plan.md`. The
verified surface has simple recipient reads/mark-read operations but asymmetric
cross-user creation, dedup recovery, global retention, staff source cleanup,
and account-deletion cleanup. Use recipient SELECT/RLS plus
column-level `UPDATE (read)`, with no direct runtime INSERT/DELETE. Cross-user
creation and cleanup require separate fixed-purpose owner-backed RPCs; never
put a second owner/service credential into Vercel. The guarded prelaunch
Notification inspection, atomic activation-time purge, PostgreSQL proof, and
two fresh real-table Notification passes under the reviewed candidate-aligned
provider/route gate were activation requirements and passed. The unchanged
transaction-wrapper limits
remain blocking for any later release that actually uses that architecture.
Activation used separate ENABLE/NO FORCE and FORCE releases after SavedSearch
Phase B and runtime credential separation were live. Preserve that
compatibility-first release pattern for later sensitive groups; do not treat
Notification's completion as authority to bundle Conversation, Message,
Order, payment, or shipping tables into one activation.

The isolated branch contains both recipient candidates. Fixed
`SECURITY INVOKER` recipient RPCs cover bell, page, unread count, mark-one,
mark-many, conversation mark-read, export, and recent low-stock lookup in one
database round trip per application operation; the prior interactive-transaction
bell/page wrapper is retained only in Git/evidence history after its executable
candidate file was removed. The
2026-07-22 provider attempt selected the one-statement RPC direction: its
target/burst candidate comparisons passed with zero request or isolation errors,
while the generic wrapper crossed seven unchanged 2x adoption/hold thresholds.
The run consumed slot 1 and failed the existing generic gate, so it is not
promotion evidence and slot 2 was not called. Do not weaken the thresholds or
rerun for a favorable boundary sample. Before a fresh provider proof, review a
candidate-aligned gate that keeps wrapper limits blocking for releases that use
interactive transactions and requires two fresh real Notification RPC/route
passes for this release. The invoker draft now has disposable PostgreSQL
parse/apply, own/foreign/direct-denial, and context-reset proof; final SQL
authority review, real-table route proof, and authenticated runtime-credential
evidence remain open. Cross-user
creation and cleanup use separate service authority and must not be conflated
with recipient RPCs.

The later real-table provider attempt at commit
`aef7ef2686a0432529a2d17291e2ca04b2fa0714` is failed, consumed evidence too.
Its deployment and exact isolated runtime/database attestation passed, but slot
1 returned HTTP 500 immediately after durable claim because the candidate gate
used invalid `pg_catalog.current_user` SQL. Slot 2 was not called; all provider
resources were abort-cleaned; production was unchanged. `CURRENT_USER` and the
opaque Vercel environment-id validator now have regressions, but no successful
real Notification workload was produced. A fresh provider run remains required
before activation; do not reinterpret the infrastructure attestation as a
runtime pass.

The fresh follow-up at commit
`b295116a27401433e717e5022238c4006fb871c6` also failed after durable slot-1
claim and was not replayed. Its independent deployment attestation passed, but
the real source baseline used invalid `pg_catalog.exists(...)` syntax. The
correct `EXISTS (...)` expression is now guarded, all disposable resources were
again removed, and production remained unchanged. Before another provider
deployment, a reduced real-query local preflight must complete against fresh
fixtures and owner-reset/reseed them; environment configuration is mechanically
blocked until that preflight is recorded. A later successful local diagnostic
does not retroactively accept either consumed Vercel slot.

A third predeployment-only attempt consumed no Vercel slot: its mandatory local
preflight exited before JSON. A direct invocation later reproduced the exact
pre-main defect: unsupported top-level `await` in the standalone TSX CommonJS
output. The attempt was fully abort-cleaned with production unchanged. The
script now uses a CommonJS-compatible invocation with a regression, and the
operator directly invokes a package-metadata-verified, pinned local TSX
`4.21.0` binary instead of relying on `npm exec`; a fresh database/preflight
remains required.

The fourth attempt passed the mandatory local preflight and provider slot 1,
then failed slot 2 only on the fixed per-slot 2x bell p95 ratio. Correctness and
all request error counts remained green. The reversed slots exposed a symmetric
first-measured-workload ramp (`149.1ms` first baseline in slot 1; `147.2ms`
first candidate in slot 2) while the later workloads were `26.8ms` and
`22.9ms`. Do not retroactively accept the failed gate. The harness now primes
each side at full measured concurrency immediately before measurement and must
pass a fresh two-slot proof. The failed environment was fully removed and
production remained unchanged.

The fifth fresh attempt validated the priming correction and completed the
Notification provider gate. Its local preflight and both non-replayable,
order-reversed Vercel slots passed exact correctness, zero errors, the fixed 2x
ratio, and the 250ms candidate ceiling without exception. The bell target,
burst, and service p95s stayed between `21.7ms` and `39.9ms` across both slots.
Success cleanup removed every disposable resource and production remained
unchanged. Treat provider performance/locality as complete for this exact
Notification design. The consolidated Extra High SQL/application authority
review passed at `ab2d08a6` with no new blocker; authenticated route smoke,
activation packaging, full release CI, and production evidence remain open.

Two authenticated route attempts then failed closed before any ordinary user
was impersonated. The first exposed a Preview/production Redis cache namespace
collision; the second proved that email-pattern selection saw only synthetic
provider actors while every Clerk-backed account was unmarked. All disposable
resources were removed after each attempt. Drew explicitly authorized Codex to
create the missing identity. Use one permanent, non-customer, no-password Clerk
operational canary with external id
`grainline-notification-rls-operational-canary-v1`, current legal metadata, one
normal webhook-created production row, zero marketplace activity, and hashed
private evidence. Because live Clerk requires email, derive the canary's
`+grainline-notification-canary` Gmail alias in memory from the sole active
production admin, allow the one normal welcome email to that controlled inbox,
and never print or commit the raw address. Do not create/delete a disposable
live Clerk user:
those webhooks would leave avoidable production creation/anonymization residue.
Authenticated smoke must resolve this exact external id, never an email pattern
or an unmarked account.

The operational canary was created and independently rechecked on 2026-07-22:
one Clerk identity, one signed-webhook production row, no password, current
legal state, zero marketplace activity, and no welcome fallback-outbox row.
Retain it for authenticated preflight/postflight checks. The isolated
authenticated Notification route smoke passed on 2026-07-22 and all disposable
provider resources were removed; next is legacy aggregate/backup inspection
and clean release packaging, not another provider run.

The production legacy inspection must not weaken the owner-credential boundary
to run early from a feature branch. Package its read-only workflow with the
preparation release, merge through normal review, apply the compatible
preparation migration, and then dispatch the exact clean `main` SHA through the
main-only GitHub `Production` environment. The operator must verify the
protected credential digest and prepared/no-policy/legacy-CRUD posture, run one
repeatable-read read-only transaction, and retain aggregate counts only. The
activation purge remains a later locked transaction; the inspection itself may
never delete or export rows.

The first production package carries only the compatible preparation migration;
the activation migration must remain absent. The promoted preparation artifact
is byte-pinned separately, with a verifier proving its executable body matches
the disposable PostgreSQL candidate and that the only differences are
promotion comments/terminal whitespace. Re-run the disposable PostgreSQL
compatibility and rollback workflow against that committed preparation file,
then exclude all endpoint-specific Preview runners and exceptions before clean
release review.

The clean release derivative keeps the generic/context PostgreSQL harness and
the Notification provider measurement implementation as non-runtime scripts,
but ships no `/api/internal/rls-context-gate` route, middleware exemption, or
runner-only test. The branch-scoped Vercel deployment-disable entries and the
temporary duplicate-database-URL build exception are also removed; only the
standing `main: false` deployment interlock remains. Historical authenticated
smoke/operator sources are retained as reproducibility records without an
active package command. Production promotion is guarded by the exact
preparation migration/tree verifier rather than by the former broad
"draft file exists" Vercel build prohibition.

Live Clerk does not permit backend `sessions.createSession` for this production
instance. Authenticated operational proofs must use a short-lived one-use Clerk
sign-in token consumed by the production Frontend API `ticket` strategy, then
revoke every resulting canary session and any unconsumed token in mandatory
cleanup. Do not loosen this into password login, ordinary-user impersonation,
or a retained browser session.

The isolated service-authority draft now uses seventeen owner-backed functions:
one runtime-ungranted fixed-column core, ten granted creation families, one
dedicated back-in-stock claim/create/consume operation, three exact cleanup
operations, and two fixed retention batches. Runtime receives exact execute
privileges only on the sixteen fixed-purpose entry points;
direct Notification insert/delete and the default public function privilege
remain revoked. The application paths are wired to the draft and broad legacy
Notification cleanup fallbacks have been removed from runtime code. Because the
site remains prelaunch with no users relying on notifications, a guarded
owner-only operator may inspect legacy aggregate counts. The purge must be the
first locked step inside the same transaction that activates Notification RLS;
a standalone reset would leave a recreation race. If the no-users premise
changes, the purge is
prohibited and a backfill must be designed. Application-asserted `app.user_id` is
not database-authenticated identity and a compromised runtime can forge it;
fixed-purpose constraints limit that residual without eliminating it.
In addition, most durable source/audit tables remain ordinary runtime-CRUD
tables until their later independent RLS or database-isolation groups. A fully
compromised runtime may therefore fabricate upstream evidence before invoking a
narrow Notification wrapper. Bucket B still removes direct arbitrary
Notification writes and caller-controlled payload/target identity, but it is
not a complete arbitrary-runtime-compromise boundary on its own. Close that
dependency through the site-wide program; do not activate orders, messages,
cases, and audit ledgers in the same Notification release merely to make a
broader claim.

The existing site-wide runtime-role tooling is part of the Bucket B security
boundary, not a later cleanup. It now runs provisioning mutations
transactionally, aborts on partial Notification RLS state, and converges an
activated Notification table back to `SELECT` plus column-only `UPDATE(read)`.
It also converges all 25 Notification RPC ACLs while keeping the private create
core runtime-ungranted. The grant audit derives FORCE expectations from ordered
migration history and checks the exact Notification policies, column grants,
function owner/mode/search path/overload shape, PUBLIC revokes, and runtime
execute split. The release topology is explicitly split: a preparation
migration installs the schema/RPC surface while retaining disabled RLS, zero
policies, and legacy table CRUD; the RPC application deploys and is verified;
only then may a locked activation migration purge pre-authority rows, install
the policies, enable initial `NO FORCE`, and narrow table grants. Keep three
evidence layers distinct:
the AST gate covers all 55 application emission paths; disposable PostgreSQL
run `29893071538` at exact source
`187ac2fa5a5b7c08a3889b27ef57c873ee7a79ea` executes all 26 family-dispatched
private-core source-validation branches plus the dedicated back-in-stock claim
with valid creation, stable replay, and forged-recipient or mismatched-evidence
rejection. Its 59 creation cases cover all 38 successful source/type pairs and
the security-relevant action, status, and recipient-direction variants within
those source types. The accepted run also proves post-draft role
provisioning reconvergence and the catalog proof on fresh PostgreSQL 16. The
generic grant audit's Notification migration-inventory branch is now exercised
by the later split-migration proof described in the Bucket B operating record;
do not retroactively count the earlier draft run as that proof.

Extra-high review accepts the current source-derived shared create function and
split migration topology for continued proof, not production activation. The
original 54/54 callsite result, current 55/55 result, and 59-case live result
validate the architecture, the
granted boundary, every top-level private-core source branch, every successful
source/type pair, and the security-relevant action/recipient variants.
The latest isolated PostgreSQL proof is green and also passes catalog/grant,
direct-denial, recipient context reset, service replay, the one-shot stock
claim, and both two-session block-race checks. The byte-pinned split migration
and database-first rollback have passed disposable PostgreSQL proof. Provider
route/authentication and application-deployment rollback evidence remain
separate. This narrows the remaining work; it does
not by itself select the recipient architecture, replace provider/performance
proof, prove the production authentication path, authorize merge, or activate
any persistent database. The later 2026-07-22 provider result above selects the
RPC direction without converting either proof into activation evidence.
Do not deploy the long-lived Notification branch for the remaining real-table
provider proof. Its unapplied SQL drafts deliberately make every
Vercel build fail closed, and automatic deployment is disabled for that exact
branch. Use a freshly reviewed disposable proof branch with only the exact
candidate and temporary Preview runner artifacts needed for the next proof.
The runner branch and all branch-scoped provider credentials/resources must be
deleted after sanitized evidence and teardown proof are retained; the generic
harness, regression tests, and operating record remain durable.
The granted wrappers no longer accept notification title, body, link, or dedup
identity. The private core derives all four inside owner authority from the
validated recipient, type, source row, related actor, and source-specific
columns. App-level title/body copies are non-authoritative compatibility
evidence; link and dedup scope are telemetry only. Social/content/message/commission
absence-of-block checks now share a deterministic lock protocol with every
ordinary block/unblock writer: notification creation takes sorted-pair
`FOR SHARE`, while block mutation takes sorted-pair `FOR UPDATE`. Account
deletion retains its earlier conflicting lifecycle lock before block cleanup.
The owner core rejects isolation other than `READ COMMITTED`, and ordinary
block mutations request it explicitly, so a stale transaction snapshot cannot
silently weaken the absence check. This is statically guarded but still needs
two-session PostgreSQL race proof.
Retain provider performance proof for the source-validation joins.

The message family uses `Message.id` as its durable source. For custom-order
ready links, the private core extracts the listing id from the structured
message, checks the reserved buyer, seller, conversation and listing status,
and derives the canonical route. It is not stored as a second
Notification source field.

The inventory family is complete in the isolated draft. Checkout low-stock binds the
exact order item to a paid order, completed stock reservation, listing owner and
current low-stock state, then derives payload, route and replay identity inside
owner authority. Manual low-stock now writes durable audit evidence atomically
with the row-locked listing update and derives its payload, route and identity
from that event. Back-in-stock writes durable restock-transition evidence with
the stock mutation, then atomically validates that audit and the locked
subscription, creates the preference-gated Notification, consumes the one-shot
subscription, and exposes only the winning claim to email fanout.

The verification/Guild family now binds seven staff transitions to the exact
durable, non-undone AdminAuditLog row co-committed with the state change and binds three
cron transitions to fixed-job SystemAuditLog evidence. The first metrics warning
was moved into an audited transaction; the owner wrapper derives payload and
route only after validating actor, recipient, verification status, and Guild
level.

The listing-moderation and account-warning families are also complete in the
isolated draft. Listing approval/rejection returns the exact staff audit written
with the transition; listing reports use the durable `UserReport`. A successful
admin email writes bounded notification content into a strict post-send audit
before attempting the in-app row. Banned-seller buyer warnings use a compound
ban-audit/order event, validate that the order is listed in the ban snapshot,
and retain the banned seller as exact related-user lifecycle metadata.

The order/payment/fulfillment family completes creation coverage. Checkout
buyer/seller notifications bind the atomic checkout-order audit; three seller
fulfillment transitions co-commit a user-attributed system audit; seller and
blocked-checkout refunds plus Stripe disputes bind `OrderPaymentEvent`; payout
failure binds `SellerPayoutEvent`. The owner wrapper derives the recipient,
counterparty, payload, route, and replay identity from those ledgers and exact
order relationships.

Production activation also has a permanent completeness gate:
`npm run audit:rls-notification-readiness`. It inventories the real TypeScript
emission paths, requires the exact 55-path contract, and fails on dynamic calls,
missing source pairs, or source constants that do not dispatch through a
reviewed service family whose draft SQL function, `PUBLIC` execute revoke, and
runtime grant are present. Its current 55/55 result passes the
creation-authority gate; ordinary tests retain the exact count and authority
surface tripwires so new or dynamic paths cannot disappear silently. This green
gate is only one activation prerequisite.

Use a hybrid rather than either extreme. Do not grant runtime the current
generic arbitrary-type/arbitrary-recipient creator, and do not collapse the
completed paths into identical lifecycle metadata. Keep the
fixed-column insert primitive private to the function owner and expose only
family-specific operations keyed by stable domain ids and small event
discriminators. The ten-family inventory and implementation order live in
`docs/notification-create-authority-inventory.md`. This preserves meaningful
write-side defense in depth while keeping database validation proportional to
what each application, staff, cron, or provider flow can actually prove.

Notification initial production activation completed on 2026-07-22. Protected
production inspection found 58 legacy rows; all 58 lacked
the new source and related-user authority fields. The sanitized aggregate-only
evidence is retained outside the repository with SHA-256
`89664c97252c2ec8528cb0b58da422f6eb003c5d2c37d232f7ae9eefd6372d0b`.
Neon branch `br-hidden-tree-aa337i8v` is a protected, no-compute backup of the
production parent at LSN `0/4A7E8628`; retain it through the activation rollback
window. The activation purge is deliberate because the pre-authority rows
cannot be made source-valid, but the backup preserves their exact database
state if forensic recovery is needed.

The compatible application rollback rehearsal passed before activation:
`thegrainline.com` moved from new deployment
`dpl_92rXcp1PqmoMPtgtAswbecAKWEt2` to known-good prior deployment
`dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8`, both `/` and `/api/health` stayed HTTP 200
with health `ok`, and the new deployment was restored and re-attested. The
activation release branch `codex/rls-notification-activation-20260722` promotes
only migration `20260722052000_enable_notification_rls`; promoted SHA-256 is
`f4b475d5f7c071011e35425b68bc26738bae8696c658457d8ed55ebffc8ddc92`,
and its executable body matches accepted disposable candidate SHA-256
`e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329`.
PR `#34` merged the activation package at
`aa3f2c3640c2cb62200c1d660a08ac217271a037`. Main CI `29952665651`, committed
PostgreSQL proof `29952665786`, and protected production migration
`29952892477` passed. Mode-0600 production postflight evidence
`notification-production-postflight-aa3f2c3640c2.json` has SHA-256
`06b635c8249cfdc864a5e133d6edcd2e0805b57537903c4ef13b337057a6463e`.
It proves exact live catalog/grants, zero rows visible without context, own-row
visibility with transaction-local context, denial of direct insert/delete/title
update, no context leakage after rollback, authenticated bell/page isolation,
non-enumerating foreign mark-read behavior, own/read-all mutation, HTTP 401/403
boundaries, and complete fixture/session/token/cache cleanup. That initial
activation remains the preserved compatibility and rollback baseline for the
completed FORCE release recorded below.

Notification FORCE hardening completed on 2026-07-22. PR `#36` merged exact
FORCE head `b7873218f7929f791b6d5e422e647e1598421c91` to main as
`213f2f1d036967cacae4ac217307376efbd7c812`. Migration
`20260722053000_force_notification_rls` changes only the table FORCE flag;
it does not alter rows, policies, grants, functions, or app code. It fails
closed unless the live initial catalog, runtime/owner role posture, exact policy
pair, ownership, and narrow grants match the accepted Phase-A state. Its
reviewed SHA-256 is
`f5e0f906671d21ec7d249e05be681753a81700cfe82a265f37bb4754e315f774`.
PR FORCE proof `29955500231`, PR CI `29955527920`, main FORCE proof
`29956127053`, and main CI `29956127009` passed. Protected production migration
run `29956750176` passed the exact source/owner/role preflight, artifact and
activation-equivalence guards, committed FORCE apply, migration status, and
live catalog/grant audit.

Fresh FORCE production postflight used operator commit
`74da7a2099d1289b0735091f52712af3607ad151` against exact release main
`213f2f1d036967cacae4ac217307376efbd7c812`. It re-proved `rlsEnabled=true`,
`rlsForced=true`, two policies, narrow runtime grants, no-context zero-row
visibility, own-row isolation, denial of direct insert/delete/title update,
transaction-local context cleanup, authenticated bell/page projection,
cross-origin and unauthenticated boundaries, non-enumerating foreign mutation,
own/read-all mutation, and complete fixture/session/token/cache cleanup.
Sanitized mode-0600 evidence
`notification-production-postflight-213f2f1d0369.json` has SHA-256
`637d85180b6b78f0e3edd9da911dcf906f8edcd9eaaf3a4888c5ae432b592bad` and
retains no raw identifier or credential. Bucket B is complete; retain the
protected preactivation backup through the rollback window. Conversation plus
Message subsequently completed as the next separate production group;
Case/CaseMessage/CaseMessageAttachment is now the active compatible authority
conversion, with policy activation still separate.

Temporary provider mechanics are intentionally absent from the production
artifact: the internal context-gate route, its runner-only test, branch-scoped
Vercel/database exceptions, disposable secrets, and provider resources were
removed after sanitized proof and teardown. Their durable value remains in Git
history, the non-runtime operator/harness scripts, regression tests, evidence,
and this operating record. The provider measurement implementation was moved
from a runtime library into `scripts/notification-provider-gate.ts`; it was not
discarded. Do not reintroduce endpoint-specific proof routes or credentials
merely to preserve scaffolding.

### Homepage discovery hierarchy decision (2026-07-15)

Keep the local-maker map directly beneath the hero and floating marketplace stats. It is Grainline's clearest marketplace differentiator, but it should remain a compact discovery band so inventory appears after a short scroll rather than becoming a second full-screen gate.

Preserve this homepage order: hero → stats → local-maker map → Top Picks → Shop by Category → New Arrivals → Makers You Follow → In the Workshop → From the Blog. Do not put a large editorial feature ahead of the first listing row.

### Brand terminology decision (2026-07-15)

Do not globally rename makers to shops. Preserve a three-part vocabulary:

- **Maker** means the person and their craft identity. Use it for community, trust, local discovery, commissions, Guild/Founding recognition, stories, following, and messaging.
- **Shop** means the maker's storefront or a commercial destination/action. Use it for "Visit Shop," profile/settings language, opening a shop, and search copy such as "Search pieces, shops, and more…".
- **Seller** means the transactional/legal role. Keep it in payments, refunds, disputes, staff tooling, schema, APIs, and internal code; avoid it in ordinary buyer discovery copy.

Use "Find Shops Near You" for the homepage hero CTA and local-map heading, where the buyer is choosing a commercial destination. Keep the supporting copy centered on independent woodworkers and do not imply that map pins are guaranteed walk-in retail locations. Internal `SellerProfile` naming and `/makers/...` SEO routes stay unchanged.

### Compliance systems to build before scale

Do not market these as fully implemented until the workflows exist in code and have attorney review.

- **INFORM Consumers Act high-volume seller workflow.** Current Stripe Connect onboarding collects baseline identity and payout information, but Grainline has not built a dedicated high-volume seller threshold tracker, 10-day verification queue, annual recertification flow, or buyer-facing disclosure/reporting workflow. Build before marketplace volume makes the INFORM workflow legally operationally relevant.
- **Privacy-control expansion.** Current product does not sell/share personal information or run third-party behavioral advertising, so GPC does not change current behavior. If that changes, add first-class `Sec-GPC` handling and persistence before enabling the feature.

### `/why-grainline` and `/why-sell-on-grainline` SHIPPED (2026-05-12)

Both landing pages are live.
- `/why-grainline` (buyer) lives in `src/app/why-grainline/page.tsx`. Sections: hero, handmade-trust problem with two-column comparison, four trust-mechanism cards, badge ladder (Founding/Guild Member/Guild Master with live counts), American-made stat bar with map link, buyer protection step-by-step, espresso final CTA.
- `/why-sell-on-grainline` (seller) lives in `src/app/why-sell-on-grainline/page.tsx`. Sections: hero, four-platform fee comparison table (Grainline/Etsy/Faire/Amazon Handmade), Etsy take-rate trap deep dive, Founding Maker scarcity counter, what-we-dont-do, what-you-get six-card grid, risk reversal, espresso final CTA. CTA links use Clerk auth state to send signed-in users straight to `/dashboard` and signed-out users to `/sign-up?redirect_url=/dashboard`.

Both are wired into the Shop and Sell footer columns respectively, added to `middleware.ts` `isPublic`, and added to `sitemap.ts` at priority 0.8 monthly. Live `prisma.sellerProfile.count({ where: { isFoundingMaker: true } })` reads power the "X of 250 spots left" counter on the seller page and the "X of 250 granted" pill on the buyer page.

Revisit when: catalog hits ~75 listings (refresh stats and screenshots), Etsy fees change (refresh comparison table), or Drew wants to test conversion variants on the seller landing.

### Reddit launch posts

Post to: r/EtsySellers, r/woodworking, r/SmallBusiness. NOT r/Etsy main (mods nuke competitor posts).

Each post should:
- Open with "I'm not selling anything" disclaimer.
- Lead with the Etsy fee math problem (specific numbers, including Offsite Ads on shipping).
- Ask for the first 10 sellers + critics + collaborators, not for signups.
- Include concrete technical specifics (Stripe Connect, Texas marketplace facilitator law) that defuse vibe-coding suspicion.
- Drop the URL once, near the bottom.

Be ready in the comment thread to answer specifics about Stripe Connect refund accounting, AI moderation pipeline, dispute escalation, and shipping rate sourcing. Those answers are the real credibility-builder.

### llms.txt is live at `/public/llms.txt`

Already shipped. Revisit if the canonical pitch changes or scope expands beyond woodworking.

## First 10 sellers playbook

The only number that matters for the next 60 days. Do not try to scale recruitment until 10 active sellers are posting.

1. **Etsy poaching, gentle.** Search Etsy for "Austin TX walnut", "Houston handmade cutting board", etc. Filter to 4.8+ rating, 100+ sales, photos that don't look stock. Pull 50 shops. Find their off-Etsy presence (Instagram bio link to personal site is the usual path). Send a personal note about a specific piece of theirs. Offer Founding Maker status + white-glove migration.

2. **Pitch the badge, not the platform.** "Founding Maker #7" is more meaningful than "join my new website". Status + scarcity + permanence does the work.

3. **White-glove migration.** Offer to import their best 5 listings yourself. You type, they review and click publish. Stripe Connect is the only manual step on their end. This kills the #1 friction (re-uploading photos and descriptions).

4. **Be visible in the maker world.** r/woodworking Show-Off Sunday. Texas Woodworkers Guild meetups. Austin/Houston/Dallas local woodworking groups. Don't promote. Be present.

5. **Texas first.** Drew is in Texas. Regional density is more credible than scattered national sellers. "10 Texas makers, 0% commission for 3 months, here's the URL" is a coherent story.

6. **Skip influencer marketing.** Wrong stage, wrong margin. Real makers don't follow influencers, they follow other makers.

Success criteria: 10 makers, 5+ listings each, 3+ have made their first sale by end of month 1. The catalog crosses ~75 listings. Blog content writes itself from maker stories. From there, network effects start.

## Referral system (build later, in phases)

Do not build until there are 50+ active sellers (real referral potential).

**Phase 1 (when ready): Founding Maker referral pass.**
Each of the first 250 Founding Makers can grant one "Founding Maker referral pass" that fast-tracks a referee through the Guild Member criteria. Referee earns a "Founding Maker referred by #N" subtle badge on their profile. Caps gaming because each maker has exactly one pass.

**Phase 2: Fee discount for new sellers via referral code.**
New seller signs up with a referral code, gets 0% Grainline fee for first 3 months or first $500 of sales. Referring seller gets 1% reduction on their own fee for the same period. Gameable in theory (fake accounts) but defended by Stripe Connect verification + first-listing-required-for-payout. Net cost per real referral: $50-150. Net cost per fake referral: $0 (fakes never reach payout).

**Phase 3 (2027+): Percentage-of-sale referral.**
Referrer earns 1% of every sale the referee makes for 12 months, paid by Grainline (not deducted from referee). Powerful but expensive on P&L. Hold until margin allows.

**Explicitly skip:**
- Cash signing bonuses (gameable).
- Per-listing payouts (rewards stuffing the catalog with junk).
- Buyer-side referee discounts (wrong audience, won't move the needle at this stage).

## White-glove migration tool

A "paste Etsy URL" import flow. Public Etsy listing pages render server-side, so a simple fetch + parse can pull title, description, price, photos. Drew (or admin) pastes the URL, the tool drafts a Grainline listing with photos pre-uploaded to R2, seller reviews and edits, then publishes.

Build this only after 5 sellers are confirmed interested. Otherwise it's a feature without a market.

Tech notes:
- Etsy's robots.txt allows public listing page fetches.
- Photos need to be re-downloaded and uploaded to R2 (don't hot-link).
- Categorize via existing AI review pipeline.
- Mark as "Imported from Etsy" in admin notes for traceability.

## LLM-search positioning

### Current state (right move for next 12 months)
- robots.txt blocks GPTBot, ClaudeBot, CCBot, Google-Extended, anthropic-ai for training scraping. This is intentional and stays.
- llms.txt published at root for canonical-pitch consumption.
- Sitemap with rich Product / LocalBusiness / Article / Service JSON-LD. Already shipped.

### Revisit at ~500 listings
At catalog density, consider allowing AI bots for browse-tool / on-demand fetch (not training). The mechanism: keep the broad disallow but add specific allows for AI browse-tool user agents that respect non-training intent. OpenAI's `ChatGPT-User`, Anthropic's `Claude-User`, Google's `Google-Extended-User` (these are the live-browse agents, separate from training agents).

### Long term (3+ years)
LLMs will increasingly act as buyer intent resolvers. Marketplaces will compete to be the system the LLM calls via tool-use to fulfill an order. Grainline's existing Stripe Checkout API is already shaped correctly to be a backend for this. Direction: keep API endpoints clean and well-documented in case OpenAI Operator / Anthropic Computer Use / similar emerges as a buyer channel.

## Things explicitly NOT to do right now

- Don't run paid ads. CAC will be brutal at $0 GMV.
- Don't redesign. The product works. Ship sellers, not features.
- Don't add Canada. Terms already declines it. Revisit at $250K GMV.
- Don't build the percentage-of-sale referral. Margin trap.
- Don't add subscription tiers. Etsy did this. Sellers hate it.
- Don't build a mobile app. PWA is sufficient. Real mobile app is post-$1M ARR territory.
- Don't broaden scope to general handmade. The woodworking-only focus is the differentiator.

## Recurring observations on Etsy 10K (for refresh each year)

Etsy's recent annual reports surface the same pain points that Grainline is positioned against. Worth re-reading when each new 10K drops:

- GMS flat-to-declining since 2021. Documented "marketplace revitalization" theme in MD&A.
- Take rate creep, particularly through Offsite Ads expansion.
- Explicit risk-factor language about counterfeits and AI-generated content eroding buyer trust.
- AI search as a documented existential risk factor.
- Star Sellers + Etsy Plus + subscription monetization push (universally unpopular with sellers).

Each year's 10K refresh is free competitive intel. Pull the relevant quotes into recruiting copy.

## Geographic expansion plan

1. **Phase 1 (now through ~50 sellers):** Texas-first. Density story. Recruitment in r/Austin, r/Houston, r/Dallas, Texas Woodworkers Guild.
2. **Phase 2 (50 to 500 sellers):** Major US metros (NYC, Bay Area, Chicago, LA, PNW). City landing pages already exist as SEO surface area for this expansion.
3. **Phase 3 (500+ sellers):** Full national rollout.
4. **Canada (2027+):** Re-enable only after attorney review of Quebec Bill 96, PIPEDA cookie consent, GST/HST registration, and cross-border carrier considerations. Code change is one line in middleware; legal work is the bulk.

## When to revisit this file

- After every session that produces a strategic decision.
- Before any commit that changes scope, fee structure, or geography.
- When a referenced item ships (move from "to build" to a brief note that it shipped, then delete after 60 days).
