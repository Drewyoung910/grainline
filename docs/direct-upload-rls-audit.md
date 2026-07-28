# DirectUpload RLS and Lifecycle Authority Audit

Opened 2026-07-26 as CM-A21. High audit completed on
`agent/direct-upload-rls-audit-20260726`; Extra-High preparation is active on
`agent/direct-upload-rls-preparation-20260726`. Production now contains the
four PR #58 Case/CaseMessage compatibility migrations and compatible
application at exact commit
`da4489ace5a592880a325c3e6f90bad7ded8ee37`, with Case evidence disabled at
both build and runtime. No DirectUpload preparation migration, DirectUpload
grant/RLS change, provider-object mutation or DirectUpload activation has
reached production.

`DirectUpload` is a shared upload-control ledger, not an ordinary user-owned
content table. It spans public listing/profile/review/blog/broadcast/commission
media, legacy ordinary-message attachments, private Case evidence, future
private ordinary-message attachments, account export/deletion and the cleanup
cron. Its production release therefore remains separate from Message and Case
even though both depend on it.

## Accepted threat boundary

The production runtime role must lose direct table access. `DirectUpload` and
its reference table should use ENABLE plus FORCE RLS with no runtime table
policy or direct table grant; the runtime receives only fixed operations.
Owner-backed functions must pin `search_path`, reject `PUBLIC`, validate all
durable targets and derive status/timestamps/cleanup state.

Those functions do not authenticate a human. The runtime can assert an actor
id, so a stolen `grainline_app_runtime` credential can impersonate a valid
application actor within each granted function. Clerk authentication,
server-side actor resolution and exact call-site guards remain load-bearing.
The database boundary removes arbitrary table CRUD, enumeration, target
selection and status rewriting; it is containment, not independent identity.

The cleanup worker is intentionally different: leasing eligible objects must
return cross-user object keys. Those lease/complete/fail operations must move
to a dedicated NOBYPASSRLS worker role and connection before DirectUpload
activation. Ordinary `grainline_app_runtime` must lose EXECUTE on all three.
Until then, the compatible preparation retains the existing runtime authority
and does not claim containment from a stolen runtime credential.

Arbitrary application-runtime compromise with R2 credentials also remains able
to access objects permitted by those credentials. Database RLS cannot solve
that provider-secret threat. Separate bucket scope, credential rotation,
no-public-domain proof and object audit telemetry remain required.

## Verified operation inventory

| Operation | Current code | Authority destination |
|---|---|---|
| Record processed public upload | `src/app/api/upload/image/route.ts` calls `recordDirectUploadVerified()` | Fixed actor/endpoint operation; database derives status and clocks and validates endpoint/type/size bounds |
| Record presigned public upload | `src/app/api/upload/presign/route.ts` calls `recordDirectUploadPresigned()` | Fixed direct-upload operation; disable unused/retired endpoints before grant |
| Mark public upload verified | `src/app/api/upload/verify/route.ts` calls `markDirectUploadVerified()` | Exact actor/key/endpoint transition with database-derived clocks |
| Record private Case evidence | `src/app/api/cases/[id]/attachments/route.ts` calls `recordDirectUploadVerified()` | Case-participant operation with fixed private endpoint/storage, exact Case scope and no public URL |
| Verify public persistence | `src/lib/uploadPersistenceVerification.ts` reads by key | Exact actor/key/endpoint projection; no list or arbitrary-row read |
| Verify private Case persistence | `src/lib/caseEvidence.ts` reads by key | Exact Case/actor/source projection |
| Read private Case evidence | Case attachment route reads lifecycle by key | Exact Case attachment read operation; no client key |
| Claim public durable references | Listing, SellerProfile, Review, BlogPost, CommissionRequest, SellerBroadcast and legacy Message writers call generic claim helpers | Family-specific reference operations that prove the exact durable field/row and owner |
| Claim private Case evidence | Case message route calls generic key claim then directly links `claimedById` | One atomic CaseMessage/attachment/reference operation |
| Clean abandoned uploads | Before activation, the compatible Vercel cron calls `processExpiredDirectUploadBatch()` | The activation release removes the Vercel route and runtime helper, then hands fixed lease/complete/fail operations to a dedicated GitHub cleanup-worker role with an exact schedule release gate |
| Account export | Account export directly lists every column | Fixed actor export projection with no key, URL, internal target id or raw error |
| Account deletion | Deletion reads rows and deletes public lifecycle rows directly | Fixed source-aware release/deletion operation; retained Case evidence remains referenced |
| Runtime provisioning | `scripts/provision-runtime-db-role.sql` grants SELECT/INSERT/UPDATE/DELETE | Activation must revoke all table access and grant only reviewed functions |

Current public claim call sites:

- Listing: new, custom and edit;
- SellerProfile: onboarding and profile edit;
- Review: create and edit;
- BlogPost: new and edit;
- CommissionRequest: create;
- SellerBroadcast: create; and
- ordinary Message: attachment send.

Private Case evidence is the current private claim path. CM-A20 will add a
private ordinary-Message path only after this rollout.

## Endpoint and durable-source matrix

| Endpoint | Current storage/content | Valid durable sources |
|---|---|---|
| `listingImage` | Public processed image | Listing photos; an already-referenced seller-owned image may also appear in that seller's broadcast |
| `messageImage` | Public processed image | CommissionRequest reference images |
| `messageFile` | Public PDF direct upload | Legacy Message only; no new grant after the CM-A20 cutover |
| `messageAny` | Public processed image or PDF direct upload | Legacy ordinary Message only; no new grant after the CM-A20 cutover |
| `caseEvidenceImage` | Private processed image | One exact CaseMessageAttachment |
| `messagePrivateImage` | Planned private processed image | One exact MessageAttachment after CM-A20 |
| `reviewPhoto` | Public processed image | ReviewPhoto owned by the reviewer |
| `listingVideo` | Public video direct upload | Listing video, but no active UI call site was found; inspect legacy state before deciding whether to disable it |
| `bannerImage` | Public processed image | SellerProfile banner; seller-owned broadcast reuse is valid |
| `galleryImage` | Public processed image | SellerProfile avatar/workshop/gallery, BlogPost cover, or seller-owned broadcast |
| `blogImage` | Public processed image | BlogPost cover |

Do not encode one exclusive claim rule across this matrix. Private attachments
are exclusive. Public images can legitimately be referenced by more than one
durable source.

## Findings

### DU-A01: broad runtime CRUD

The provisioning script grants runtime SELECT, INSERT, UPDATE and DELETE on
`DirectUpload`. A stolen runtime credential can enumerate keys, rewrite
ownership/status/cleanup state, delete lifecycle evidence or create arbitrary
rows. Child-table RLS does not contain that table-level access.

### DU-A02: caller-controlled generic claim identity

`claimDirectUploadForKey()` accepts `claimedByType` and `claimedById` from
application code. It validates upload owner/storage/status but does not prove
that the claimed source row exists, belongs to that actor or contains the
object. Fixed family operations must derive reference identity from the exact
durable source.

### DU-A03: one claim conflicts with valid public reuse

The current `claimedByType`/`claimedById` pair is exclusive. Yet the product
explicitly accepts a seller's existing `listingImage`, `bannerImage` or
`galleryImage` in a SellerBroadcast, and BlogPost covers may reuse a
`galleryImage`. A previously tracked image already claimed by Listing or
SellerProfile is rejected when the second valid source tries to claim it.

Use a normalized reference ledger with multiple active references for PUBLIC
objects and exactly one for PRIVATE objects. Do not weaken private exclusivity
to solve public reuse.

### DU-A04: claimed-object deletion drifts from ledger state

Review removal/admin deletion and Listing edit/delete call R2 deletion helpers
without releasing or updating the corresponding lifecycle row. Other replaced
profile/blog objects may retain both object and claim indefinitely. A row can
therefore remain `CLAIMED` after its object or source is gone, while storage can
retain unreferenced claimed objects forever.

Reference release must happen atomically with the durable source change. The
last active reference should set the upload back to cleanup-eligible
`VERIFIED` with a database-derived immediate `cleanupAfter`; the retryable
worker performs the external delete and records success/failure.

### DU-A05: export exposes raw control metadata

Account export selects `key`, `publicUrl`, `claimedById` and `lastError` for
every row. With private storage this would export opaque private object keys.
The user-facing export needs only bounded endpoint/storage/content/size/status
and lifecycle timestamps. It must omit key, URL, internal target ids and raw
provider error text.

### DU-A06: private key duplication

The unapplied Case-compatible schema duplicates the private key in
`CaseMessageAttachment`. The CM-A20 draft initially proposed the same shape.
Both private children should instead hold a unique foreign key to the exact
`DirectUpload` row. Only a fixed authenticated read operation may resolve the
object key. The already reviewed Case migration must remain byte-immutable;
the next reviewed DirectUpload migration performs the shape transition and
must fail closed rather than rewrite any unexpected Case evidence row.

### DU-A07: incomplete database invariants

The database checks the status enum, positive size, nonnegative attempts and
public/private URL nullability. It does not yet enforce:

- endpoint whitelist and endpoint/storage/content/size compatibility;
- ownership foreign key;
- status-specific timestamp/claim/cleanup coherence;
- immutable key/owner/endpoint/storage/content/size;
- permitted status transitions;
- active-reference/status coherence; or
- private exclusive versus public shared reference cardinality.

Add compatible constraints/triggers in stages and validate them only after the
legacy inspection/backfill.

### DU-A08: compatibility accepts untracked new references

The public verifier allows a valid owned first-party object when no lifecycle
row exists, and generic claim returns `{tracked:false, claimed:false}` without
failing. That preserves historical URLs but lets a newly submitted URL bypass
the ledger. After compatible app deployment, new values must require a
verified lifecycle row. Exact already-persisted legacy values may remain under
an explicit unchanged-value exception until migration.

### DU-A09: cleanup completion lacks a lease fence

The cleanup worker serializes normal duplicate pickup through status and
`cleanupAfter`, but its final success/failure updates use only the row id. A
worker that outlives the retry lease can overwrite a newer worker's result.
Fixed cleanup operations must return an attempt/lease token and condition
complete/fail updates on that exact token and `DELETING` state.

### DU-A10: endpoint retirement is unresolved

No active `VideoUploader` consumer was found for `listingVideo`;
`messageFile` is legacy and `messageAny` is scheduled for public-message
cutover. Aggregate legacy counts—not assumptions—must decide whether those
creation grants can be removed. Unknown endpoints/types fail closed.

### DU-A11: legacy reference completeness is unknown

Database inspection is required for tracked rows with null/unknown/dangling
claims, durable public URLs without lifecycle rows, multiple durable sources
sharing one URL, stale claimed rows, expired cleanup rows, private attachment
mismatches and invalid state coherence. Inspection returns aggregate counts
only: never keys, URLs, user ids, source ids, message bodies or raw errors.

### DU-A12: cleanup authority is broader than ordinary request authority

The cleanup lease must return a bounded cross-user batch containing object
keys, while complete/fail mutate service-owned lifecycle state. The cron route
is protected by `verifyCronRequest()`, but the current database grant is still
held by the ordinary request runtime role. A stolen runtime database credential
could therefore invoke the worker operations directly, lease eligible rows and
enumerate their keys even without the cron secret.

Preparation may retain that grant only because DirectUpload still has its old
full runtime CRUD authority and RLS remains off. Activation must create a
dedicated NOBYPASSRLS cleanup-worker role/connection, grant it only
lease/complete/fail EXECUTE, and revoke those three functions from
`grainline_app_runtime`. The production grant audit and pooled postflight must
prove both sides. The unused future
`grainline_direct_upload_record_private_message` grant must also be absent from
ordinary-runtime activation until CM-A20's compatible application release
actually consumes it.

### DU-A13: private Case child conversion must survive old/new app overlap

The first reference-ledger draft treated the unapplied Case evidence table as
empty and replaced `objectKey` with `directUploadId` in one migration. That is
fail-closed for unexpected rows but not deployment-compatible: an old
application instance would continue inserting `objectKey` after the migration
and fail against the new shape.

Preparation must instead retain the compatibility column, add and exactly
backfill `directUploadId`, and install a private database binding trigger. The
trigger derives the id for an old writer and rejects any caller-provided
key/id/uploader/content/size mismatch. It locks the lifecycle row against the
cleanup worker and makes attachment identity immutable. A second private,
deferred constraint trigger creates the exclusive normalized reference at
transaction commit and releases it on delete. Deferral is required because the
old Case writer claims the upload, inserts the attachment, then fills the
legacy `claimedById` in the same transaction; an immediate trigger would fill
that legacy field first and make the old writer roll back. New application code
dual-writes both columns and performs an immediate explicit reference call; the
deferred commit-time replay remains idempotent.

After the compatible application is deployed and every older instance has
drained, a separate reviewed cleanup migration must prove exact agreement and
drop `objectKey`. DirectUpload activation may not retain this duplicate private
key behind ordinary runtime table access; either the compatibility column is
gone first or the parent attachment table has independently activated,
parent-derived RLS. The planned sequence uses the narrower first option.

### DU-A14: a second database URL cannot share the application environment

The reviewed Vercel runtime guard rejects every PostgreSQL URL outside
`DATABASE_URL`. That is load-bearing: adding
`DIRECT_UPLOAD_CLEANUP_DATABASE_URL` to the main Vercel project would both fail
the build and place the supposedly isolated worker credential in the same
environment as every ordinary request handler. Application compromise able to
read environment variables could then recover the worker credential, defeating
the separation from `grainline_app_runtime`.

The accepted cleanup topology is therefore external to the application
project:

- a separate protected GitHub environment named
  `Production DirectUpload Cleanup`;
- one direct Neon connection authenticating only as
  `grainline_direct_upload_cleanup`;
- one R2 credential restricted to the exact public and private cleanup
  buckets, with no application upload credential in the job;
- an hourly, non-overlapping main-branch workflow that can only call the three
  fenced cleanup functions and `DeleteObject`;
- a maximum of 10 batches of 20 rows per run, with no bucket listing;
- exact source, database digest, endpoint, role, RLS, table-denial and function
  ACL checks before the first lease; and
- mode-`0600` evidence containing only counts, bounded error-code
  distributions and hashes of provider identifiers.

`scripts/provision-direct-upload-cleanup-role.sql` deliberately creates no role
and sets no password. The externally managed LOGIN must exist first; the
operator only converges its attributes, memberships and grants. The worker
refuses to run until both lifecycle tables have ENABLE plus FORCE RLS with zero
policies, the worker has zero table/sequence authority, ordinary runtime has
lost cleanup EXECUTE, and the unused private-message recorder remains
runtime-inaccessible.

GitHub schedule delay is acceptable for abandoned-object garbage collection:
it can delay deletion but cannot authorize a live object or customer action.
It is not a substitute for monitoring. Before database activation, verify the
environment's exact-main deployment-branch restriction, isolated secret and
variable inventory, and failed-workflow notification path while the schedule
gate remains absent. Once the hourly schedule is enabled, this recurring
worker environment must have no required reviewers, wait timer, or custom
manual protection rule; GitHub holds a job before runner/secret access until
those rules pass, which would turn an hourly maintenance job into a queue of
pending approvals. The worker intentionally refuses cleanup until FORCE RLS
and the exact function partition are live, so the disposable provider deletion
smoke belongs after activation but before enabling the hourly schedule. It
requires its own reviewed provider/database mutation approval and must leave no
object or row behind. The activation release removes the Vercel cleanup route
and schedule; do not leave two providers as steady-state owners of the same
operational job. Do not put the cleanup URL into Vercel or weaken
`guard:runtime-db-env`.

## Proposed compatible schema

Add `DirectUploadReference`:

- id;
- `directUploadId` foreign key;
- constrained `sourceType`;
- bounded `sourceId`;
- database-derived `exclusive` flag matching the lifecycle storage class;
- `createdAt`;
- nullable `releasedAt` and bounded `releaseReason`;
- active source and lifecycle indexes;
- one active `(directUploadId, sourceType, sourceId)` reference; and
- one active reference total when `exclusive=true`.

The reference table starts with ENABLE plus FORCE RLS and no runtime table
grants. Fixed family functions insert/release rows only after locking the
lifecycle and validating the exact durable source. A trigger rejects a
reference whose exclusivity does not match PUBLIC/PRIVATE storage.

The compatible `CaseMessageAttachment` transition temporarily stores both its
legacy `objectKey` and unique `directUploadId`; the database derives and proves
their equality for old writers while the new application dual-writes them.
After old deployment drain, drop the duplicate key. The planned
`MessageAttachment` starts directly with a unique `directUploadId` foreign key
and never needs the legacy duplicate. Child metadata remains source-derived and
database-constrained.

Keep legacy `claimedByType`/`claimedById` during coexistence only. Preparation
functions dual-write them where compatible. After old deployment drain and
reference backfill, remove application dependence on those columns; later drop
them in a separately reviewed cleanup migration.

## Fixed operation catalog

Preparation must define and prove:

1. processed-public record;
2. presigned-public record;
3. public verification transition;
4. private Case record;
5. private Message record;
6. exact actor-owned persistence lookup;
7. family-specific public reference operations for Listing, SellerProfile,
   Review, BlogPost, CommissionRequest and SellerBroadcast;
8. legacy Message compatibility reference during drain only;
9. atomic Case and Message private attachment references;
10. source-aware reference release;
11. fenced cleanup batch lease, complete and fail;
12. sanitized account-export projection;
13. account-deletion release/retention; and
14. owner-only aggregate legacy inspection.

Private generic cores, if used, receive no runtime or PUBLIC EXECUTE. Every
runtime function has a pinned signature, `search_path=pg_catalog`, bounded
return projection and exact ACL inventory. No dynamic SQL is permitted.

## Legacy aggregate inspection

The separately approved, repeatable-read owner inspection must count:

- rows by endpoint/storage/status/content type/claim type;
- unknown endpoint/type/storage/status combinations;
- state/timestamp/cleanup coherence violations;
- missing User owners;
- null/unknown/dangling claim pairs;
- claims whose source exists but has the wrong owner, endpoint or URL/key;
- lifecycle rows referenced by zero, one or multiple durable sources;
- durable first-party URLs by source family with no lifecycle row;
- allowlisted legacy UploadThing/UTFS durable URLs by source family and origin;
- private Case child/lifecycle mismatches;
- expired cleanup-eligible rows and stale `DELETING` leases;
- `listingVideo`, `messageFile` and `messageAny` legacy populations; and
- rows that cannot be deterministically backfilled.

Inspection stops after counts. Reference backfill, constraint validation,
object deletion, URL rewrite, key migration and endpoint retirement each need
their own reviewed mutation and residue proof.

The reusable inspector is now scaffolded in
`scripts/direct-upload-legacy-inspect.mjs` and the protected,
production-serialized manual workflow is
`.github/workflows/direct-upload-legacy-inspection.yml`. It refuses anything
except the exact clean dispatched main commit, reviewed direct production
owner URL/digest and the explicit
`compatible-app-drained-private-surfaces-disabled` prerequisite. The current
public R2 base comes from the protected GitHub Production variable
`CLOUDFLARE_R2_PUBLIC_URL`; the artifact retains only its SHA-256.

The single repeatable-read, read-only transaction returns fixed aggregate
counts for lifecycle/reference coherence, source ownership, public/private
exclusivity, Case key/id/reference binding, cleanup eligibility, stale leases,
first-party and UploadThing/UTFS legacy populations, backfillable versus
untracked durable URLs and the legacy `listingVideo`, `messageFile`,
`messageAny` and future-private endpoint populations. Fixed categorical
distributions cover endpoint, storage class, status, content type, claim type,
and source-family/provider-origin buckets. Unknown database values are folded
into `UNKNOWN`/`UNKNOWN_EXTERNAL`; no raw value, key, URL, row id, user id or
message body enters the evidence.

The exact aggregate SQL is also executed inside the disposable DirectUpload
PostgreSQL harness. GitHub Actions run `30228466175` (job `89862786290`) at
commit `c748758e` passed on PostgreSQL 16.14: all 166 migrations,
production-style runtime grant convergence, migration status, the global
grant/RLS audit, static contracts and seven live checks passed. The seventh
check, `aggregate_only_legacy_query`, executed the full inspector SQL against
the disposable fixture population and preserved the expected Case/reference
invariants. The run recorded `persistentStagingChanged=false` and
`productionChanged=false`.

This accepts the query as executable disposable-engine evidence, not as a
production data classification. Dispatching it against production still
requires separate read-only authorization after the compatible application is
deployed and old instances have drained.

## Release sequence

1. **High audit:** complete this source/actor/endpoint inventory and static
   drift tests.
2. **Extra-High preparation:** design schema, fixed functions, grants,
   constraints, call-site guards and exact disposable PostgreSQL
   authority/concurrency/rollback proof. No production mutation.
3. **Additive preparation release:** land the reference table, compatible
   columns/functions and non-disruptive constraints. Old app remains valid.
4. **Compatible application release:** new code uses fixed operations and
   dual-writes references while old instances may still use direct CRUD.
5. **Drain proof:** prove the old deployment is gone; stop all new untracked
   persistence and direct lifecycle CRUD.
6. **Aggregate legacy inspection:** separately approved, read-only and
   count-only.
7. **Reference backfill/repair:** separately approved from exact counts with
   backup, rollback and residue proof. Unknown rows remain fail-closed.
8. **Activation:** ENABLE plus FORCE RLS, revoke all runtime table privileges,
   grant only reviewed actor operations, move cleanup lease/complete/fail to
   the externally isolated worker role, remove the Vercel cleanup schedule,
   withhold the unused private-message recorder, and validate accepted
   invariants.
9. **Postflight:** prove no-context/direct CRUD denial, actor/source isolation,
   public shared references, private exclusivity, release/cleanup fencing,
   sanitized export and exact grants under the pooled runtime role.
10. **Private-object releases:** only after this postflight may Case or CM-A20
    make private-key application paths live, each in its own release.

## Extra-High proof requirements

Disposable PostgreSQL must prove:

- runtime cannot select, insert, update or delete either table directly;
- exact record/verify state transitions and invalid-transition denial;
- endpoint/storage/content/size and owner validation;
- valid same-owner public reuse plus foreign-source denial;
- private single-use under concurrent claims;
- reference creation versus release and cleanup winner orderings;
- stale cleanup worker completion cannot overwrite a newer lease;
- actor/key exact lookup cannot enumerate or switch context;
- export never returns key, URL, source id or raw error;
- account deletion retains Case evidence and schedules ordinary private/public
  cleanup correctly, including when the account is banned before local
  anonymization starts;
- function ACL/search-path/source hashes match the reviewed catalog; and
- rollback restores the accepted compatible schema/grants without residue.

## Extra-High preparation checkpoints

### Reference-ledger schema checkpoint

The first local-only checkpoint adds
`20260726184500_prepare_direct_upload_reference_ledger` and begins the
deployment-compatible Case child transition to `DirectUpload.id`.

The preparation migration deliberately leaves `DirectUpload` RLS disabled and
keeps its old runtime grants for old-application compatibility. It creates
`DirectUploadReference` with ENABLE plus FORCE RLS, zero policies and no
runtime/PUBLIC table privileges from birth. It also adds:

- a NOT VALID DirectUpload owner foreign key so new rows are checked without
  pretending unknown legacy rows have been inspected;
- compatible endpoint/storage/content/size and key/public-URL constraints;
- cleanup lease columns for later attempt fencing;
- immutable lifecycle identity and bounded status-transition triggers;
- active reference identity and private-exclusivity partial unique indexes;
  a locked Case attachment key/id binding trigger for old/new application
  coexistence; and
- a trigger that derives reference exclusivity from the locked lifecycle row
  instead of accepting the caller's value.

This is schema preparation only. The fixed operation catalog, reference/status
maintenance, app call-site conversion, activation migration, aggregate legacy
inspection and live PostgreSQL proof remain open.

The exact reviewed bytes of
`20260726184000_prepare_private_case_message_attachments` remain immutable.
`20260726184500_prepare_direct_upload_reference_ledger` adds and exactly
backfills `directUploadId` while retaining `objectKey` for old-application
compatibility. A locked SECURITY DEFINER trigger derives the id for old writes,
validates dual writes, and rejects attachment identity mutation. The authority
migration then creates/releases normalized references automatically for both
writer versions and backfills any rows created between the two migrations.
Production has received the four earlier PR #58 Case compatibility migrations
and compatible app at exact commit
`da4489ace5a592880a325c3e6f90bad7ded8ee37`, with Case evidence disabled. It
has not received `20260726184500_prepare_direct_upload_reference_ledger`,
`20260726185000_prepare_direct_upload_authority` or
`20260726185500_prepare_direct_upload_public_references`. The duplicate key is
a temporary transition field and must be removed after the compatible app
drains, before DirectUpload activation.

### Fixed lifecycle/core authority checkpoint

The next local-only checkpoint adds
`20260726185000_prepare_direct_upload_authority` without revoking the old
DirectUpload table grants or enabling DirectUpload RLS. It adds fixed,
runtime-granted operations for:

- processed-public, presigned-public, private Case and future private Message
  lifecycle creation;
- the public verification transition and exact actor/key lookup;
- source-validated private Case attachment reference and read;
- bounded cleanup leasing plus exact lease-fenced completion/failure;
- sanitized account export;
- account-owned public URL collection; and
- account-deletion reference release/cleanup scheduling.

Private actor, UTC clock, record, reference and release cores are explicitly
revoked from both runtime and PUBLIC. Database clocks are normalized to UTC at
the SQL boundary; IDs and cleanup lease tokens are database-derived. The record
core independently derives the key owner segment from the actor's durable
Clerk id and rejects a key whose endpoint or user segment does not match,
rather than relying only on application-side key construction.

The compatible application draft now uses those operations for upload
record/verify, persistence lookup, private Case reference/read, cleanup,
account export and account deletion. New first-party persistence fails closed
without a matching lifecycle row; exact unchanged legacy URLs remain accepted
only through the pre-existing `existingUrls` path.

This checkpoint still has no live PostgreSQL proof and is not release-ready.
The public source families, source-aware release, exact ACL/catalog proof and
the activation/rollback split remain open at this checkpoint.

### Fixed public-reference family checkpoint

The next compatible draft adds
`20260726185500_prepare_direct_upload_public_references` and removes the
generic application claim API. Runtime receives only seven source-specific
operations for Listing, SellerProfile, Review, BlogPost, CommissionRequest,
SellerBroadcast and the drain-only legacy Message representation. Each
operation locks and reads its durable source, proves the actor/source
relationship, derives URLs, endpoints, source type and source id in the
database, and calls a runtime-inaccessible reference core.

The family conversion preserves valid public object reuse through normalized
references rather than rebinding a single `claimedByType`/`claimedById`.
Create paths fail closed when a submitted first-party URL lacks a matching
verified lifecycle. Compatible edit paths may retain exact legacy URLs already
stored on the source, pending the aggregate legacy inspection and backfill.
When any durable URL is untracked, the database may add references for matched
lifecycles but releases none; this prevents a permissive legacy edit or a
direct fixed-function caller from using an ignored untracked count to release
and clean up an object the source still needs.

The Extra-High static review caught and corrected four defects before live
PostgreSQL execution:

1. nullable BlogPost ownership originally used `NOT IN`, and six other
   families used `<>`; SQL UNKNOWN could fail to reject a null actor. All
   ownership checks now use `IS DISTINCT FROM`, the core rejects null
   actor/source inputs explicitly, and Blog recognizes only durable
   `authorId`, matching the application edit authority;
2. SellerProfile invoked four mutating families through `UNION ALL`, which did
   not provide an explicit execution sequence;
3. desired references and stale references originally acquired lifecycle
   locks in separate orders, allowing a cross-source public-object swap to
   deadlock; and
4. Listing/Review application cleanup still deleted R2 objects directly after
   release, which could destroy an object that another valid public source
   continued to reference.

The corrected core locks the union of desired and currently referenced
lifecycle rows by id before any reference mutation. SellerProfile families run
sequentially. Source-root BEFORE DELETE triggers release references for
Listing, SellerProfile, Review, BlogPost, CommissionRequest, SellerBroadcast
and legacy Message rows. Application mutation paths no longer directly delete
Listing or Review media; the fenced lifecycle worker deletes only after the
last reference is released. Removing a seller avatar also synchronizes its
reference in the same transaction.

This remains preparation only: DirectUpload RLS is still off, old runtime table
grants remain for deployment coexistence, no SQL has been applied, and no
provider or production state changed. Exact disposable PostgreSQL syntax, ACL,
authority, reuse, release/cleanup and concurrency proof has passed. Aggregate
legacy inspection and backfill, the production preparation preflight,
activation/rollback split and final Extra-High authority review remain
required.

### Disposable PostgreSQL proof record

`scripts/direct-upload-authority-postgres-proof.mjs` and its branch-scoped
PostgreSQL 16 workflow are the next evidence gate. The harness refuses every
non-loopback target and every database name except `grainline_ci`; it never
reads the ordinary runtime or migration URL variables. It is designed to
apply the exact stacked migration tree, converge the production-style runtime
role, and prove:

- exact runtime/PUBLIC function ACLs, pinned `pg_catalog` search paths, the
  compatible pre-activation DirectUpload posture, and the zero-table-authority
  FORCE posture of DirectUploadReference;
- runtime denial of generic reference operations, null/foreign actor denial,
  and database-derived key ownership;
- fail-closed partial-source behavior even when a direct database caller
  ignores the returned untracked count;
- public-object reuse plus last-reference release through source-delete
  triggers;
- stable lifecycle lock ordering during a two-source object swap; and
- both cleanup/reference winner orders, including `SKIP LOCKED` behavior and
  exact cleanup-lease fencing.

The scaffold is not evidence of a pass until the workflow runs successfully.
It uses only disposable `example.invalid` fixtures, removes them in `finally`,
and records that neither persistent staging nor production changed.

The first workflow execution, GitHub Actions run `30224585194`, applied the
entire migration tree, converged the runtime role, and then stopped at the
global grant audit before fixtures ran. The audit still assumed that every
Prisma table required CRUD and every `grainline_*` function required runtime
EXECUTE. That old assumption correctly failed against the new least-privilege
shape: `DirectUploadReference` has zero table grants and 12 generic/trigger
functions are runtime-private. The correction keeps the audit hard while
classifying exactly that one service-only table and those 12 functions,
teaches provisioning to converge the same ACLs, and updates the schema-wide
inventory from 59 to 60 models. Do not reinterpret this stopped run as
authority evidence; the actual proof did not execute.

The corrected exact-tree execution, GitHub Actions run `30224847389` (job
`89853249938`) at commit `f7dcce32`, passed on PostgreSQL 16.14. It passed the
full migration tree, production-style runtime-role convergence, the global
grant/RLS audit, static harness contracts and all five live checks:

1. `catalog_and_acl`;
2. `fixed_authority_and_partial_source`;
3. `stable_swap_lock_order`;
4. `multi_source_reuse_and_delete_release`; and
5. `reference_cleanup_winner_orderings`.

The runtime-role denial probes produced the expected database errors for
DirectUploadReference table access, generic sync execution, null actor,
forged key ownership and foreign Listing source authority. The result recorded
`persistentStagingChanged=false` and `productionChanged=false`; the CI service
database and every disposable fixture were destroyed with the job. This is
accepted disposable-engine authority/concurrency evidence for the compatible
preparation stack, not activation evidence and not a production catalog claim.
The post-proof Extra-High review also hardened the global drift audit: accepting
this intentionally policyless service ledger may not suppress verification of
its posture. The audit now independently requires DirectUploadReference to
retain ENABLE plus FORCE, zero policies and zero runtime table privileges; a
missing catalog row or loss of either RLS flag fails closed.

That audit correction passed again in run `30224946994` at commit `69ecd95a`.
During final release-guard packaging, the guard then correctly exposed that the
previously sealed Case migration had been amended by the first reference-ledger
checkpoint. Commit `6697a0f3` restored
`20260726184000_prepare_private_case_message_attachments` byte-for-byte to its
reviewed `b3e3d18f...` tree and moved its then-empty-only `objectKey` to
`directUploadId` transition into
`20260726184500_prepare_direct_upload_reference_ledger`. The reviewed full-tree
fingerprint at that checkpoint was
`8eb9896ac024b73daf368593e57fc485bd2b651b8e4b4b37a8cb66b31c1fe7bc`.

The fresh exact-tree execution, GitHub Actions run `30225445722` (job
`89854768934`) at commit `6697a0f3`, passed on PostgreSQL 16.14. It applied all
166 migrations, converged the production-style runtime role, verified
migration status, passed the global grant/RLS audit and static contracts, then
passed all five live authority/concurrency checks listed above. It recorded
`persistentStagingChanged=false` and `productionChanged=false`. The subsequent
Extra-High deployment-skew review found that its empty-only shape replacement
would reject old-application writes after migration. The preparation now uses
the additive dual-column/binding-trigger protocol in DU-A13 and adds automatic
Case reference insert/delete maintenance. Therefore run `30225445722` remains
useful prior authority/concurrency evidence but is explicitly superseded for
release; the amended exact tree requires a fresh PostgreSQL run before its
preparation can be accepted. The first Extra-High-reviewed amended full-tree
fingerprint was
`90290c0c88ecf0270acf832605126100fa6f24505496989754ab5d6d01274324`.

The first execution of that amended tree, GitHub Actions run `30226471869`
(job `89857383277`) at commit `34711980`, applied all 166 migrations and passed
runtime-role convergence, migration status, the global grant/RLS audit and
static contracts. The live harness then failed because its older cleanup
concurrency check asserted that the entire service-wide lease batch was empty.
The new Case lifecycle check had correctly released an unrelated private
fixture, so PostgreSQL legitimately leased that row. This was a proof-isolation
defect, not an authority or migration failure; both databases were disposable
and the workflow changed no persistent staging or production state. The
correction verifies that the specifically referenced upload is absent from the
lease batch and moves the already-proven released fixture outside the later
test's clock window.

The corrected exact-tree execution, GitHub Actions run `30226543504` (job
`89857578571`) at commit `6c1dba12`, passed on PostgreSQL 16.14. It applied all
166 migrations, converged the production-style runtime role, verified migration
status, passed the global grant/RLS audit and static contracts, then passed all
six live checks:

1. `catalog_and_acl`;
2. `fixed_authority_and_partial_source`;
3. `case_attachment_compatibility_and_lifecycle`;
4. `stable_swap_lock_order`;
5. `multi_source_reuse_and_delete_release`; and
6. `reference_cleanup_winner_orderings`.

The result recorded `persistentStagingChanged=false` and
`productionChanged=false`; the disposable service database and fixtures were
destroyed with the job. This is the accepted disposable-engine evidence for the
amended compatible preparation tree. It is not DirectUpload activation
evidence, provider-bucket evidence or a production catalog claim.

The following deployment-packaging review then compared the database triggers
against the exact old Phase 1B Case route rather than only its final insert. It
found that the old route updates legacy `claimedById` after attachment creation
inside one transaction. The immediate insert trigger in the proven tree had
already populated that field, so the old route's exact null-guarded update would
return zero and roll back. Run `30226543504` remains valid for its six modeled
checks but is superseded for release compatibility. The corrected trigger is
`DEFERRABLE INITIALLY DEFERRED`, and the live harness now executes both the
exact old claim-insert-link transaction and the new
dual-write-plus-explicit-reference transaction. That amended tree requires
another exact PostgreSQL proof. Its then-reviewed full-tree fingerprint was
`61bd54f8f1a3b6c627fe6c895be65e30aa09c906ab732a42e94d021d8018ce74`.

The corrected exact-tree execution, GitHub Actions run `30226904740` (job
`89858487348`) at commit `ce4a914b`, passed on PostgreSQL 16.14. It applied all
166 migrations, converged the production-style runtime role, verified migration
status, passed the global grant/RLS audit and static contracts, then passed all
six live checks listed above. In particular,
`case_attachment_compatibility_and_lifecycle` now commits both the exact legacy
claim-insert-null-guarded-link transaction and the new
dual-write-plus-explicit-reference transaction. The result recorded
`persistentStagingChanged=false` and `productionChanged=false`; the disposable
database and fixtures were destroyed with the job. This is the accepted
disposable-engine authority, concurrency and application-skew evidence for the
then-current compatible preparation tree. It is not DirectUpload activation
evidence, provider-bucket evidence or a production catalog claim.

### Final preparation authority review corrections

The 2026-07-27 Extra-High review found two pre-production defects in the
preparation stack:

1. New seller broadcasts verified an optional first-party image before their
   serializable create transaction, but did not require the source-sync result
   to track every selected URL. A concurrent cleanup lease could therefore win
   between verification and source sync, leave `untracked=1`, and still allow
   the broadcast row to commit. The create path now passes
   `requireAllTracked: Boolean(imageUrl)` inside the transaction, so that race
   rolls back the new broadcast rather than persisting an image whose object
   may be deleted.
2. Account URL collection and account release reused the ordinary interactive
   actor-validity helper, which rejects banned users. Provider-driven deletion
   or deletion of an already-banned account could therefore omit its public
   media and make local anonymization roll back. Those two account-lifecycle
   operations now independently require a syntactically valid, existing,
   not-yet-deleted account while intentionally allowing `banned=true`.
   Ordinary upload creation, ownership lookup and sanitized export continue to
   use the stricter not-banned actor rule.

The disposable PostgreSQL harness now includes an eighth
`banned_account_lifecycle_cleanup` check proving that a banned account can
enumerate its exact public deletion URLs and schedule its unreferenced public
upload for cleanup while its ordinary sanitized upload export remains empty.
The migration edit changes the complete reviewed tree fingerprint to
`0dacf34460ed27a16e332d29240c09eb8e0d183dba3c89778498987d3501759c`.
All earlier runs remain useful evidence for the checks they executed, but are
superseded for release by this exact-tree change.

The fresh exact-tree execution, GitHub Actions run `30327497254` (job
`90175815165`) at executable commit `546c112f`, passed on PostgreSQL 16.14. It
applied all 166 migrations, converged the production-style runtime role,
verified migration status, passed the global grant/RLS audit and static
contracts, then passed all eight live checks:

1. `catalog_and_acl`;
2. `fixed_authority_and_partial_source`;
3. `case_attachment_compatibility_and_lifecycle`;
4. `stable_swap_lock_order`;
5. `multi_source_reuse_and_delete_release`;
6. `reference_cleanup_winner_orderings`;
7. `aggregate_only_legacy_query`; and
8. `banned_account_lifecycle_cleanup`.

The result recorded `persistentStagingChanged=false` and
`productionChanged=false`; the disposable service database and fixtures were
destroyed with the job. This is the accepted disposable-engine authority,
concurrency, application-skew, aggregate-inspector and banned-account cleanup
evidence for the exact compatible preparation tree. It is not DirectUpload
activation evidence, provider-bucket evidence or a production catalog claim.

Local validation at this checkpoint passed all 2,147 repository tests
(2,144 pass, zero fail, three intentional skips), TypeScript and lint. The
default Next build did not reach application compilation because Turbopack
rejects this disposable worktree's intentionally external `node_modules`
symlink. The webpack fallback then reached compilation but exhausted Node's
default 2 GiB heap without reporting an application defect. Neither result is
accepted as build evidence. The partial `.next` output was deleted, the 10 GiB
disk guard was preserved, and the clean GitHub runner must provide the exact
in-tree dependency install, build and PostgreSQL evidence.

That clean-runner gate is now accepted. Pull-request CI run `30327609567` (job
`90176153302`) at documentation head `67617abd` completed the in-tree
dependency install and Prisma generation, verified every pinned migration and
prior RLS release artifact, applied all migrations to ephemeral PostgreSQL,
converged/audited runtime grants, passed the retained database proofs,
TypeScript, lint, all repository tests, the high-severity dependency audit and
the production Next build. The executable DirectUpload tree remained exact
commit `546c112f`; `67617abd` changed only this audit and `STRATEGY.md`.

### Production preparation postflight scaffold

`scripts/direct-upload-preparation-production-postflight.mjs` is the
read-only pooled-runtime proof for the additive preparation release. It is
deliberately separate from the owner migration workflow and rejects every
owner/direct/aliased database credential. The operator requires:

- the exact clean release commit;
- the reviewed pooled `grainline_app_runtime` production identity;
- exact positive general-CI and protected-migration run ids;
- an explicit confirmation phrase; and
- a fresh, commit-bound evidence path.

It verifies the compatible pre-activation boundary rather than pretending
activation has occurred:

- `DirectUpload` still has RLS off, zero policies and legacy runtime CRUD for
  old-application coexistence;
- `DirectUploadReference` has ENABLE plus FORCE, zero policies and no runtime
  table authority;
- the six staged `DirectUpload` legacy constraints exist but remain
  intentionally `NOT VALID` until the later aggregate inspection, repair and
  retirement gate; the two Case `directUploadId` constraints are validated;
- the temporary Case `objectKey` plus `directUploadId` columns and all 13
  reviewed trigger-to-table/function bindings are installed, including the
  deferred commit-time Case reference trigger and every source-delete release
  trigger;
- all 35 reviewed DirectUpload functions retain exact runtime/PUBLIC ACL,
  owner and pinned-search-path posture;
- direct reference-ledger access and the generic source core fail with
  `42501`; and
- invalid-actor fixed lookup/read operations return no rows.

The pooled runtime connection enters `BEGIN TRANSACTION READ ONLY` before
identity, table, constraint, trigger, function or denial inspection, so the
database engine enforces the read-only boundary across the entire live proof.
It creates no fixture rows and writes only a fresh mode-0600 local JSON
artifact. This database postflight does **not** verify the Vercel deployment,
the
`CASE_EVIDENCE_ATTACHMENTS_ENABLED=false` environment value, the private R2
bucket, authenticated routes, legacy data, cleanup-worker separation or
DirectUpload activation. Those remain explicit later gates rather than
caller-supplied claims embedded in this evidence.

The postflight is deliberately catalog-only and non-destructive. A production
row delete would mutate real marketplace state and is not an acceptable way to
prove these triggers. The disposable PostgreSQL authority proof separately
exercises Case attachment deletion plus Listing and SellerBroadcast deletion,
including reference release and terminal upload-state behavior. Likewise, an
authenticated upload smoke belongs to the later compatible-app/provider gate,
not this additive database postflight. Existing Case attachment rows are
backfilled into `DirectUploadReference` by the authority migration, so the
ledger must not be described as universally empty after preparation.

### Cleanup-worker activation scaffold

The isolated activation-design branch adds:

- `scripts/direct-upload-activation-catalog.mjs`, which partitions all 35
  reviewed functions into 17 ordinary-runtime, 3 cleanup-worker and 15 private
  functions;
- `scripts/direct-upload-function-source-catalog.mjs`, which derives the exact
  final `pg_proc.prosrc` SHA-256 for every reviewed function from the immutable
  migration history and makes source drift a worker/proof failure;
- `scripts/provision-direct-upload-cleanup-role.sql`, which converges an
  externally created NOBYPASSRLS/NOINHERIT LOGIN without handling its password;
- `scripts/direct-upload-cleanup-worker.mjs`, which refuses every non-main,
  shared-credential, pooled/wrong-endpoint, unforced-RLS, table-authorized or
  ACL-drifted execution; and
- `.github/workflows/direct-upload-cleanup.yml`, which initially remains
  manual-only and references only the separate protected cleanup environment.
  The activation-release branch adds the hourly trigger behind the exact
  repository variable
  `DIRECT_UPLOAD_CLEANUP_SCHEDULE_RELEASE=20260726190500_enable_direct_upload_rls`
  while removing the Vercel cleanup route and schedule.

This is saved scaffolding, not a live worker. No cleanup role, GitHub
environment, database credential, R2 credential, enabled GitHub schedule,
migration or provider object has been created or changed. Production's Vercel
cron remains the compatible pre-activation owner of cleanup until the later
activation release deliberately transfers that responsibility.

The scaffold's first disposable PostgreSQL execution, GitHub Actions run
`30230563291` (job `89868520266`) at commit `cf776ea2`, applied the migration
tree and reached cleanup-role convergence, including the three intended
function grants. Its final authority verifier then failed with
`"pg_toast_16388" is not a sequence`. PostgreSQL had reordered a
`has_sequence_privilege` predicate ahead of the adjacent `relkind = 'S'`
filter, so the verifier passed a TOAST relation to the sequence-only helper.
This was a catalog-verifier defect, not accepted activation evidence; the
service database was disposable and no persistent staging or production state
was addressed. The corrected verifier and runtime worker keep each relation
kind check inside a `CASE` expression before calling the type-specific
privilege helper. A fresh exact-commit PostgreSQL proof is required.

The corrected exact-tree execution, GitHub Actions run `30230829313` (job
`89869276880`) at commit `6f8856b4`, passed on PostgreSQL 16.14. It applied all
166 migrations, converged the production-style runtime role and the isolated
NOBYPASSRLS/NOINHERIT cleanup role, verified migration status, passed the
global grant/RLS audit and static contracts, then passed all seven live checks:

1. `catalog_and_acl`;
2. `fixed_authority_and_partial_source`;
3. `case_attachment_compatibility_and_lifecycle`;
4. `stable_swap_lock_order`;
5. `multi_source_reuse_and_delete_release`;
6. `reference_cleanup_winner_orderings`; and
7. `aggregate_only_legacy_query`.

The result recorded `persistentStagingChanged=false` and
`productionChanged=false`; the disposable database and fixtures were destroyed
with the job. This accepts the cleanup-role catalog partition, exact function
source/ACL checks and compatible DirectUpload preparation authority on the
disposable engine. It does not activate the worker, create provider
credentials, prove R2 deletion, inspect production legacy data, apply
DirectUpload RLS activation or change any persistent environment.

### Compatibility-key retirement and activation proof

The next isolated stack retires the duplicate
`CaseMessageAttachment.objectKey` only after exact equality/reference/status
preflight and keeps `CASE_EVIDENCE_ATTACHMENTS_ENABLED=false`. The disabled
application writes only the authoritative `directUploadId`; it no longer
carries the private object key in the persistence result. The disposable
retirement candidate validates the six staged DirectUpload constraints,
replaces the attachment binding trigger with id-derived validation and changes
no RLS flag or grant. The following activation candidate requires the exact
clean predecessor, then makes both `DirectUpload` and
`DirectUploadReference` policyless ENABLE plus FORCE service tables with zero
direct runtime/worker table authority. Its exact function partition is 17
ordinary-runtime, 3 isolated cleanup-worker and 15 private functions; the
unused private-message recorder remains withheld.

The same disposable workflow also contains two separate live gates:

- activated authority proves exact function identities, owners, source hashes,
  modes and ACLs; direct table denial for both roles; fixed public/Case
  operations; foreign-source denial; retired Case attachment identity; and a
  fenced cleanup lease/complete flow; and
- database-first rollback disables DirectUpload RLS before restoring the old
  runtime CRUD/four compatibility functions, executes old-app direct CRUD,
  then restores both FORCE tables and the exact 17/3 function partition with
  zero fixture residue. The retired duplicate key is deliberately not
  recreated; the rollback target is the drained compatible app, not an ancient
  pre-drain deployment.

The first clean PostgreSQL 16.14 execution, GitHub Actions run `30232279615`
(job `89873270366`) at commit `af4d0f8e`, passed the current 166 migrations,
runtime/cleanup-role convergence, global pre-activation grant/RLS audit,
static contracts, compatible authority proof and both candidate generators.
The retirement candidate applied, but Prisma reported the activation
transaction only as `current transaction is aborted`, without the original
statement error. This is failed activation evidence: no activation,
rollback or post-activation authority claim is accepted from that run. The
database was the disposable loopback CI service; it changed neither persistent
staging nor production. The workflow now executes each generated candidate
with `psql --echo-errors -v ON_ERROR_STOP=1` and records the exact successful
bytes in Prisma's disposable ledger afterward, so the next run retains the
load-bearing PostgreSQL diagnostic instead of Prisma's secondary transaction
error.

The diagnostic rerun, GitHub Actions run `30232434982` (job `89873695544`)
at commit `6cbf2681`, again passed preparation and retirement, then exposed the
original activation error exactly. Activation completed preflight, all
function/table revokes and grants, and both tables' ENABLE plus FORCE
statements inside its transaction; the final table-ACL postflight failed to
parse because the newly strengthened per-privilege/runtime-worker query did
not close its first `EXISTS` before the separate `PUBLIC` ACL `EXISTS`.
PostgreSQL rolled the entire activation transaction back. This was a generated
postflight syntax defect, not a passed or partially committed activation, and
the disposable service database changed neither persistent staging nor
production. The correction closes both predicates independently and adds a
class-specific static regression assertion. A fresh full run is still required
before any activation/rollback evidence is accepted.

The corrected candidate then applied completely in GitHub Actions run
`30232549766` (job `89874007172`) at commit `9c54af1f`; both runtime and cleanup
role provisioners also reconverged the activated state. The following global
grant audit correctly stopped because its source-derived generic function
rule still expected the three cleanup functions and the unused private-message
recorder to remain executable by the ordinary runtime. This was stale audit
classification, not an activation or provisioning failure. Restoring those
grants would violate the reviewed separation, so the audit now derives the
activated runtime-private set from the exact function catalog and requires
those four functions to remain withheld. The run did not reach live activated
authority or rollback proof, remains failed evidence, and used only the
disposable CI database.

Run `30232738558` (job `89874534822`) at commit `0adc668b` then passed the
activated global grant/RLS audit and exact migration status. Its duplicate
post-staging static step failed because the schema-source inventory contract
correctly pins the committed tree's 95 revokes, while the two intentionally
staged disposable candidates raise that temporary working-tree count to 131.
The same contract had already passed before staging, and the live activated
audit had just passed; rerunning that committed-tree cardinality assertion
after mutating the disposable migration directory was a workflow-ordering
error. The post-staging step now retains only harness contracts that are
state-independent. This run did not execute the live activated authority or
rollback scripts and therefore remains failed evidence.

Run `30232827314` (job `89874779664`) at commit `3b58888c` passed every
migration, role convergence, pre/post-activation global audit, exact status and
static contract, then entered the live activated authority proof. Its first
function-identity comparison stopped on PostgreSQL representation:
`pg_get_function_identity_arguments()` returned named arguments such as
`p_user_id text`, while the callable catalog intentionally stores type-only
signatures such as `text` for `to_regprocedure`. No authority mismatch was
reported. Both live activation and rollback proofs now use
`oidvectortypes(proargtypes)`, PostgreSQL's exact type-only representation.
The run did not reach behavioral authority or rollback checks, so it remains
failed disposable evidence.

The corrected exact-stack execution, GitHub Actions run `30232923132` (job
`89875033710`) at commit `7de1b836`, passed on PostgreSQL 16.14. It applied the
current 166 migrations, proved compatible authority, then staged and applied
the two disposable retirement/activation candidates (168 total), reconverged
both least-privilege roles, passed the activated global grant/RLS audit, and
verified exact migration status. The live activated proof passed four checks:

1. `activated_catalog_source_and_acl`;
2. `runtime_and_worker_direct_denial`;
3. `runtime_fixed_authority_and_retired_case_key`; and
4. `isolated_cleanup_lease_fence`.

The separate database-first rollback proof passed old-application direct CRUD
compatibility, exact function-partition restoration, exact ENABLE plus FORCE
restoration on both policyless service tables, preserved retirement of
`objectKey`, and left zero fixture residue. Both proof payloads recorded
`persistentStagingChanged=false` and `productionChanged=false`; the disposable
database and candidates were destroyed with the job.

This accepts the retirement/activation SQL shape, catalog/source/ACL partition,
fixed runtime behavior, isolated worker fencing and reversible database-first
compatibility path on the disposable engine. It does **not** promote either
candidate into the committed migration tree, inspect or repair production
legacy rows, create the production cleanup role/provider credentials, prove R2
deletion, deploy the compatible app, complete an old-instance drain, activate
production RLS, or enable either private-object feature. Those remain separate
reviewed gates.

The final Extra-High authority review added two explicit assertions that the
accepted run had only implied: a third, non-participant user receives no Case
attachment-read row, and the rollback postflight re-queries the catalog to
prove `CaseMessageAttachment.objectKey` remains absent after exact activation
restoration. GitHub Actions run `30233243581` (job `89875935635`) at exact
commit `6449d722` repeated the complete PostgreSQL 16.14 program and passed
every gate, including both strengthened checks. It recorded the same four
activated proof groups and successful database-first rollback/restoration with
no persistent-staging or production change. This is the current accepted
disposable-engine proof head; it supersedes `7de1b836` only by adding those
assertions, not by changing the authority design.

The 2026-07-28 Extra-High review supersedes that run for release. Its catalog
check was exact only inside `grainline_direct_upload_*`; it did not reject
another accessible public `SECURITY DEFINER` function, column-only relation
authority, default privilege grants, or a role that was a member of the cleanup
role. It also put the hourly trigger in the scaffold even though the
Vercel-to-GitHub scheduler handoff is an activation operation. Provisioning,
the live worker and the disposable proof now reject both membership directions,
table/view/materialized-view/foreign-table and column authority, sequence
authority, default grants, and every unexpected public `SECURITY DEFINER`.
All DirectUpload functions also require their exact DEFINER/INVOKER posture,
non-LEAKPROOF ordinary-function kind, source hash, owner, search path and role
ACLs. Pure public `SECURITY INVOKER` validators carry no owner authority and
remain harmless without relation privileges. The scaffold is manual-only. A
fresh exact-tree disposable PostgreSQL proof is required before this branch can
be accepted.

Fresh diagnostic run `30329320704` at `64c0203d` then failed closed during
cleanup-role convergence before any authority proof or cleanup call. Diagnostic
run `30329414299` at `228514f9` identified the first effective function as
`public.grainline_notification_preferences_valid(jsonb)`. That function is a
pure immutable `SECURITY INVOKER` check-constraint validator, not a
privilege-bearing service function. PostgreSQL's default PUBLIC EXECUTE makes a
blanket ban on every named invoker helper both over-broad and impossible to
enforce with a per-role REVOKE. The global escape check is therefore scoped to
all accessible public `SECURITY DEFINER` functions, while the complete
DirectUpload catalog remains exact. Neither failed run addressed persistent
staging or production.

The corrected exact-tree disposable PostgreSQL 16.14 execution, GitHub Actions
run `30329597171` (job `90181797774`) at executable commit
`e407271e891f59330b20fb50a127b21f2a598364`, then passed. It applied all 166
migrations, converged the production-style runtime role and the isolated
NOBYPASSRLS/NOINHERIT cleanup role, verified migration status, passed the
global grant/RLS audit and static contracts, and passed all eight live checks:

1. `catalog_and_acl`;
2. `fixed_authority_and_partial_source`;
3. `case_attachment_compatibility_and_lifecycle`;
4. `stable_swap_lock_order`;
5. `multi_source_reuse_and_delete_release`;
6. `reference_cleanup_winner_orderings`;
7. `aggregate_only_legacy_query`; and
8. `banned_account_lifecycle_cleanup`.

The result recorded `persistentStagingChanged=false` and
`productionChanged=false`; its database, roles and fixtures existed only
inside the discarded job service container. Expected `42501` and validation
errors in the PostgreSQL service log are deliberate negative assertions that
proved the cleanup role could not read reference rows, execute private cores,
forge actors/keys or create invalid Case bindings. This accepts the hardened
cleanup-role authority partition and current DirectUpload function catalog on
the disposable engine. It does not create or exercise a live cleanup
credential, GitHub environment, R2 credential, schedule or production
activation.

Because the accepted retirement/activation run at `6449d722` predates this
cleanup-authority hardening, it remains useful design evidence but is
superseded for release. The integrated retirement/activation tree must repeat
the complete disposable PostgreSQL activation and database-first rollback
program against the hardened global catalog, role-membership, default-grant and
function-security checks before PR #61 can be accepted.

The integrated 2026-07-28 SQL review then found that both generated candidates
took their exclusive table locks after inspecting mutable catalog/data state.
The documented disabled-app drain reduces that race in production, but the
migration itself should not depend on timing: both candidates now take their
fixed-order `ACCESS EXCLUSIVE` locks immediately after the rollout advisory
lock and before any preflight. The activation preflight also checks inbound and
outbound role memberships, and both the candidate and live proof require every
catalog entry to remain an ordinary `pg_proc.prokind = 'f'` function. Static
regressions pin those class-wide invariants. Any proof run predating these
changes is superseded; a fresh exact-tree disposable activation plus
database-first rollback run remains required.

Integrated run `30330040739` at merge head `3a61fa50` completed successfully,
but it began before the lock-order/function-kind corrections and is deliberately
not accepted as release evidence.

The replacement exact-tree PostgreSQL 16.14 execution, GitHub Actions run
`30330329787` (job `90183904860`) at executable commit
`b843e21e88bfa79f4951e2e18329408671b9f49a`, passed the complete program. It
applied all 166 committed migrations, converged the production-style runtime
role and hardened isolated cleanup role, passed migration status, the global
grant/RLS audit, pre-activation static contracts and the eight-check compatible
authority proof, then generated and applied only these disposable candidates:

- `20260726190000_retire_direct_upload_compatibility_key`, SHA-256
  `adbad525ca29a6ea42227d3b196659a04b8a39daf0dbb06a859ba3b5dca3a9d6`;
- `20260726190500_enable_direct_upload_rls`, SHA-256
  `fe4da53160f2add8a7303bcca0a6bc310b07cdb02e16c39213cabf63a56cec21`.

After 168 total migrations it reconverged both roles, passed the activated
global audit and exact migration status, then passed all four activated checks:
`activated_catalog_source_and_acl`, `runtime_and_worker_direct_denial`,
`runtime_fixed_authority_and_retired_case_key`, and
`isolated_cleanup_lease_fence`. The separate database-first rollback proved
old-application direct CRUD compatibility, exact function-partition
restoration, exact FORCE restoration, preservation of `objectKey` retirement
and zero fixture residue. Both proof payloads recorded
`persistentStagingChanged=false` and `productionChanged=false`; the service
database, roles, fixtures and candidate directories were discarded with the
job. This accepts the integrated candidate bytes and database proof at
`b843e21e` only. It does not promote a migration, inspect production, create a
role/credential/provider object, exercise R2, deploy, activate RLS or enable
private Case evidence.

Local validation at `b843e21e` passed Prisma generation, `tsc --noEmit`, lint
(with the existing JSX analyzer warning), all 2,172 runnable repository tests
and 3 intentional skips. Turbopack compiled the production application
successfully twice in the disposable worktree, but Next's subsequent
type-check worker exhausted both the default 2 GiB and explicit 4 GiB Node heap
on the 8 GiB local host. Because the separate TypeScript pass is green, this is
classified as a local resource failure rather than a source/type failure, but
it is not called a successful production build. PR #60 exact head
`c667e5c96f203301e1d6c64300b537187976288e` merged into `main` as
`9d3a55e078e21264f40765cedeedf81a5e6d2187` on 2026-07-28. PR #61 was then
retargeted to that `main` head while remaining draft. A fresh clean-runner CI
production build against the retargeted PR is still a mandatory gate before
any merge.

PR #61 exact head
`d4abd02d87ef34741f73d0ccf04ac963bd069c3a` subsequently merged into
`main` as `ff6abe15badc54132ce9df70ba56f93723d332ac` on 2026-07-28.
The merge preserved the reviewed candidates as generators and compatible
application/schema preparation; it did not itself commit either generated
retirement/activation migration. No provider credential, cleanup role,
repository schedule release variable or production database mutation was
performed as part of that merge-only action.

### Scheduler-handoff activation-release checkpoint

Branch `agent/direct-upload-scheduler-handoff-20260728` starts from exact
`main` head `ff6abe15badc54132ce9df70ba56f93723d332ac` and prepares the
single-scheduler transition:

- removes `/api/cron/direct-upload-cleanup`, its `vercel.json` schedule and
  `processExpiredDirectUploadBatch()` from application runtime;
- adds an hourly `50 * * * *` GitHub trigger while retaining manual dispatch;
- skips every scheduled job unless repository variable
  `DIRECT_UPLOAD_CLEANUP_SCHEDULE_RELEASE` is exactly
  `20260726190500_enable_direct_upload_rls`; and
- repeats the exact release-token check inside the worker so a workflow-only
  edit cannot accidentally make scheduled cleanup executable.

The branch is deliberately inert while the repository variable is absent. It
does not create the protected environment, Neon role/credential, cleanup-only
R2 credential or failure-notification integration, and it does not stage or
apply the two production migrations. Do not merge or deploy it as ordinary
maintenance. This scheduler sub-sequence does not replace release-sequence
steps 3 through 7 above: additive preparation, compatible-app deployment and
drain, aggregate production inspection, and any separately approved repair
must be complete first. Only then may the final activation release be
assembled and promoted in this order:

1. provision and verify the isolated worker boundary with the schedule release
   variable absent; restrict the environment to exact `main`, and verify it has
   no reviewer/wait/custom manual gate that would block recurring jobs;
2. stage the already proved retirement/activation candidate bytes in the final
   reviewed release commit alongside this scheduler handoff;
3. merge and deploy that exact release, verify the production alias, retire the
   Vercel scheduler, and prove every preceding application instance and
   in-flight Vercel cleanup invocation has drained;
4. apply the reviewed compatibility-key retirement and DirectUpload activation
   migrations;
5. run a separately approved disposable R2/database deletion smoke and one
   manual worker pass, then inspect the sanitized artifacts;
6. set the exact repository release variable; and
7. verify the first scheduled run and failure-notification delivery, then
   retire the old Vercel Sentry cron monitor.

This creates a bounded cleanup gap between steps 3 and 6. That gap delays
garbage collection but cannot authorize uploads; it is safer than giving the
new worker work before its database grants exist. Keep the old Sentry cron
monitor active during that gap: an expected missed-check-in signal is better
than an invisible stalled handoff. Rollback order is: remove the release
variable, run the database-first rollback, redeploy the last compatible
Vercel-cron application and restore its Sentry monitor if it was already
retired. The provider smoke and each production/provider mutation remain
separate explicit approvals.

The 2026-07-28 read-only GitHub inventory confirmed this boundary before the
checkpoint: `Production DirectUpload Cleanup` returned `404 Not Found`, and
the repository contained zero variables whose names start with
`DIRECT_UPLOAD_CLEANUP_`. This proves that the current branch did not inherit a
live release switch or pre-existing worker environment. It does not provision
either one; their later creation remains an explicit provider mutation.

Pre-commit local validation passed the focused scheduler/DirectUpload
contracts, `tsc --noEmit`, full lint (with the existing JSX analyzer warning),
and all 2,172 runnable repository tests with 3 intentional skips. The local
Next production build stopped before application compilation because this
disposable worktree's `node_modules` is a symlink outside Turbopack's accepted
filesystem root. That environmental panic is retained as failed build
evidence, not relabeled as success or a source defect. A clean-runner
production build against the exact pushed checkpoint remained mandatory.

GitHub Actions CI run `30374757227` (job `90327434031`) then passed at exact
code checkpoint `d1c879a4511545f98251a29ece8f95eaaf4f5f0f`. The clean
runner installed a local dependency tree, applied the committed migration tree
to PostgreSQL, converged and audited production-style runtime grants, repeated
the Conversation/Message FORCE proofs, passed TypeScript, lint, all tests and
the dependency security audit, and completed the production build. This
resolves the local symlink failure as environmental evidence. It accepts the
scheduler-handoff checkpoint for draft review only; it does not satisfy the
later provider, production inspection, migration, smoke, schedule-release or
postflight gates.

The prior documentation-only follow-up was exact branch head
`878d9b3586e79d57034458d175fbf70659d7c3b0`. GitHub Actions CI run
`30375097337` (job `90328613291`) passed against that checkpoint: every
committed migration and production-style grant audit, the retained
Conversation/Message PostgreSQL proofs, TypeScript, lint, all repository tests,
the dependency security audit and the clean-runner production build passed.
Draft PR #65 remained open, draft and unmerged.

Its Vercel Preview status is red for a different, expected reason. Deployment
`dpl_GuAoSiGMWhrJWjVgKZfk3RugEMWx` stopped at
`guard:runtime-db-env` with `DATABASE_URL_SHAPE` before the Next build because
the branch Preview does not have the reviewed runtime database credential
shape. Do not weaken that fail-closed guard or relabel the Preview as source
build evidence; the clean GitHub runner is the accepted source/build proof, and
the eventual production application release remains an exact manual deployment
using the protected production runtime environment.

A 2026-07-28 read-only release inventory also preserved the boundary between
repository preparation and production. Exact `main` head
`ff6abe15badc54132ce9df70ba56f93723d332ac` has green CI run
`30368981066`, but the newest visible `Production Migrations` workflow remains
run `30235375755` at older release `da4489ace5a592880a325c3e6f90bad7ded8ee37`.
This workflow history contains no later DirectUpload-preparation deployment; it
is not a substitute for a live database postflight and must not be used to
claim the current catalog. The production alias resolves to ready deployment
`dpl_3fknfRH5uMczmdq21xQmcAmc614V`, whose built `vercel.json` still contains
the hourly `/api/cron/direct-upload-cleanup` schedule. Vercel exposed no Git
source SHA for that manual deployment, so its deployment id and age do not
attest an exact commit. Before any compatible-app drain claim, deploy and
independently attest the exact approved `main` release rather than inferring
source identity from this alias.

The protected GitHub `Production` environment itself is present, restricts
deployments to exact branch `main`, and requires review by `Drewyoung910`
without a wait timer. Its non-secret inventory contains
`PRODUCTION_MIGRATION_DIRECT_URL_SHA256`, and its secret inventory contains
`PRODUCTION_MIGRATION_DIRECT_URL`; values were not read. This is the required
shape for the next additive migration dispatch. The later aggregate inspector
is not yet dispatch-ready: neither the protected environment nor repository
variable inventory contains `CLOUDFLARE_R2_PUBLIC_URL`, which its fail-closed
parser requires. Provisioning that credential-free public base remains a
separate provider mutation after the exact compatible app is deployed and
drained; do not bypass the missing variable or dispatch the inspector early.

The same Extra-High readiness pass found that the prepared production
postflight's environment, clean-checkout, evidence and read-only contracts had
unit coverage, but its exact table/trigger/function/denial query sequence had
not itself executed in disposable PostgreSQL. The shared catalog proof is now
exported without weakening the production-only authenticated identity check,
and the compatible authority harness runs that exact query path under
`grainline_app_runtime` before creating any fixtures. A fresh disposable
PostgreSQL run was mandatory before treating this improvement as accepted
evidence; the historical eight-check runs remain accurately recorded rather
than being retroactively upgraded.

That replacement proof passed. GitHub Actions run `30376366157` (job
`90332970378`) at exact executable commit
`f9a05405ad6c8067a7cdf12753c85508a9337fcc` applied all 166 committed
migrations to disposable PostgreSQL 16, converged and audited both the
production-style runtime role and isolated cleanup role, and passed the
expanded nine-check compatible proof. Its new
`production_postflight_query_shape` check executed the exact prepared
table/trigger/function/denial query path under `grainline_app_runtime`; the
other eight authority, lifecycle, race and aggregate-inspector checks also
passed. The run then generated and applied only the two reviewed disposable
retirement/activation candidates, passed the activated catalog and behavioral
proof, and passed database-first rollback plus exact activation restoration.
Every proof payload recorded `persistentStagingChanged=false` and
`productionChanged=false`; no provider or production state was addressed.

The compatible postflight catalog was then strengthened after an external
review incorrectly proposed requiring validation of all staged constraints
and using a real production Listing deletion as proof. Exact executable commit
`019e98663035b7a097f768f307b30f4e26f3dd38` instead asserts the intended
compatible boundary read-only: the six reviewed `DirectUpload` constraints
exist and remain unvalidated, both Case attachment `directUploadId`
constraints are validated, and all 13 reviewed triggers have the exact table,
function, enabled and deferrability bindings. It also records why production
row deletion and authenticated upload mutation belong to disposable and later
provider proofs, respectively, rather than this additive database postflight.
Disposable PostgreSQL 16 workflow run `30380507780` (job `90346906910`)
applied all 166 committed migrations and passed the expanded nine-check
compatible proof, including the new exact
`production_postflight_query_shape`; its source-reuse checks exercised real
fixture deletion only inside the disposable database. It then generated and
applied the two disposable retirement/activation candidates, passed activated
authority plus database-first rollback and exact restoration, and recorded
`persistentStagingChanged=false` and `productionChanged=false` throughout.

## Exit

Keep Extra High through the scheduler-handoff authority/sequencing review.
PRs #60 and #61 are merged as preparation, but DirectUpload RLS remains an
unexecuted production rollout: the generated migrations are not committed,
the GitHub schedule is not enabled, and this handoff branch is not merged or
deployed. A later explicit approval is required separately for its merge, exact
deployment, each provider credential/role change, production inspection,
migration, disposable provider smoke and schedule release.
