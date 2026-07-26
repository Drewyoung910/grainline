# DirectUpload RLS and Lifecycle Authority Audit

Opened 2026-07-26 as CM-A21. Current phase: read-only/static audit at High.
No database, provider, bucket, object, deployment, grant or production state
has changed.

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

## Exit

High ends when this audit, the matrix/strategy decision and static inventory
tests are committed on the separate stacked branch. Switch to Extra High
before editing schema, migrations, functions, grants, policies or lifecycle
application code.
