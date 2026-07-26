# DirectUpload RLS and Lifecycle Authority Audit

Opened 2026-07-26 as CM-A21. High audit completed on
`agent/direct-upload-rls-audit-20260726`; Extra-High preparation is active on
`agent/direct-upload-rls-preparation-20260726`. No database, provider, bucket,
object, deployment, grant or production state has changed.

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
| Clean abandoned uploads | Cleanup cron calls `processExpiredDirectUploadBatch()` | Fixed worker lease/complete/fail operations returning only an eligible batch |
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
object key. Changing the unapplied Case migration invalidates its exact-tree
PostgreSQL evidence and requires a fresh proof before release.

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

Refactor the unapplied `CaseMessageAttachment` and planned
`MessageAttachment` to store unique `directUploadId` foreign keys, not object
keys. Child metadata remains source-derived and database-constrained.

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
   grant only reviewed functions and validate accepted invariants.
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
  cleanup correctly;
- function ACL/search-path/source hashes match the reviewed catalog; and
- rollback restores the accepted compatible schema/grants without residue.

## Extra-High preparation checkpoints

### Reference-ledger schema checkpoint

The first local-only checkpoint adds
`20260726184500_prepare_direct_upload_reference_ledger` and refactors the
unapplied Case compatibility schema to reference `DirectUpload.id` rather than
duplicating its private object key.

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
  and
- a trigger that derives reference exclusivity from the locked lifecycle row
  instead of accepting the caller's value.

This is schema preparation only. The fixed operation catalog, reference/status
maintenance, app call-site conversion, activation migration, aggregate legacy
inspection and live PostgreSQL proof remain open.

Changing `20260726184000_prepare_private_case_message_attachments` invalidates
the earlier exact-tree Case PostgreSQL proof by design. That proof must be
rerun against the final stacked migration tree before Case packaging resumes.
The private Case object key remains a server-only transient value while an
attachment is being verified; it is no longer duplicated in the durable child
row.

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
provider or production state changed. Live PostgreSQL syntax, ACL, authority,
reuse, release/cleanup and concurrency proof; aggregate legacy inspection and
backfill; the activation/rollback split; and the final Extra-High authority
review remain required.

### Disposable PostgreSQL proof scaffold

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

## Exit

High ends when this audit, the matrix/strategy decision and static inventory
tests are committed on the separate stacked branch. Switch to Extra High
before editing schema, migrations, functions, grants, policies or lifecycle
application code.
