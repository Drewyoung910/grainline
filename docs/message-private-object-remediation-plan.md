# Ordinary Message Private-Object Remediation Plan

Opened 2026-07-26. Current phase: read-only/static design audit at High.
Production Conversation and Message row RLS remains live and FORCE-hardened.
No provider, database, object, deployment, grant or production mutation is
authorized by this document.

This work is tracked as CM-A20 in
`docs/conversation-message-pre-rls-audit.md`. It is stacked on the isolated
Case compatibility branch only to reuse reviewed private-bucket and
storage-class primitives. It remains a separate pull request, migration,
legacy-data decision, provider proof and production release.

## What is and is not broken

Conversation/Message RLS correctly limits database rows. It does not mediate a
public R2 URL after that URL leaves PostgreSQL. Ordinary attachment bytes are
therefore public bearer objects today even though the Message containing the
URL is participant-protected.

This is a storage-confidentiality defect, not evidence that the accepted
Conversation/Message policy, grants or pooled-runtime proof were false.
Remediation must preserve the live database-row posture rather than reopening
or weakening it.

Short-lived signed reads will still be bearer URLs for their bounded lifetime.
They reduce accidental and durable disclosure; they do not protect against an
authorized participant deliberately sharing a downloaded file or signed URL.
Likewise, RLS does not by itself protect against arbitrary application-runtime
compromise while that runtime holds private R2 credentials. Application auth,
provider credential containment, least-privilege bucket credentials and object
audit logs remain separate layers.

The fixed database operation also does not authenticate a human caller.
`grainline_app_runtime` can assert any syntactically valid participant id, so a
stolen runtime credential can impersonate an existing Conversation participant
within the operation's bounded behavior. Clerk authentication, server-side
actor resolution and exact call-site guards remain load-bearing. The database
operation still removes free-form routing and metadata authority; that is
meaningful blast-radius containment, not independent sender identity.

## Verified current source/data flow

| Surface | Current behavior | Required destination |
|---|---|---|
| `src/components/MessageComposer.tsx` | Sends images/PDFs through public `messageAny` and submits returned public URLs in a hidden field | Conversation-scoped private upload endpoint returning an opaque pending key plus bounded metadata |
| `src/app/api/upload/image/route.ts` | Accepts `messageAny` images and writes them to the public bucket | Reject new ordinary-message uploads after the compatibility/drain cutover |
| `src/app/api/upload/presign/route.ts` and `/verify` | Accept public `messageAny` PDF direct uploads | Reject ordinary-message use at cutover; keep new private messages image-only until malware scanning/quarantine exists |
| `src/app/messages/[id]/page.tsx` | Verifies each public URL, serializes `{kind,url,name,type}` into `Message.body`, creates one Message per attachment and claims `DirectUpload` | One fixed attachment-send operation deriving recipient, timestamp, verified private source metadata, Message row, attachment row and lifecycle claim atomically |
| `public.grainline_message_list` plus list/stream routes | Returns raw Message body to authorized participant or exact reported-thread staff | Preserve body compatibility but load bounded attachment metadata through one participant/report-authorized batch projection |
| Inbox RPC/page | Parses the public URL-bearing JSON for the latest-message snippet | Derive `Photo`/attachment copy from kind plus private metadata without a URL |
| `src/components/ThreadMessages.tsx` | Renders the public URL directly in links/images/PDF chips | Render an authenticated same-origin attachment route; never return the opaque key to the client |
| Account export | Exports Message bodies, including current attachment URLs | Export bounded attachment metadata without object key, public URL or signed URL |
| Account deletion | Parses authored Message bodies, queues public object deletion, then redacts retained rows | Queue private-object deletion and remove the ordinary attachment/lifecycle link while retaining the redacted Message; unlike Case evidence, ordinary message bytes have no dispute-retention exception |
| Reported-thread staff review | May read only an active unresolved reported Conversation | Reuse the exact reported-thread visibility predicate and require the existing staff/PIN boundary for attachment reads |

The current product creates one Message row for each attachment, even when the
composer submits several attachments at once. Preserve that behavior in the
first private release: it keeps notification/replay semantics stable and lets
the new attachment relation be exactly one-to-one. A future multi-attachment
Message design would be a separate product and migration decision.

## Legacy representations that must be classified

At least two historical shapes are renderable:

1. `Message.kind='file'` with a JSON body containing
   `{kind:"file",url,name,type}`.
2. Older raw image/PDF URL bodies whose kind may be null.

The renderer's `isR2PublicUrl()` compatibility name is broader than R2: it
also allowlists legacy UploadThing/UTFS origins (`utfs.io`, `ufs.sh` and the
historical Grainline subdomain). New attachment persistence is already limited
to the current user-scoped R2 `messageAny` endpoint, so UTFS is a legacy
read/migration class rather than a permitted new-write source.

Do not infer or rewrite a row merely because private body text resembles a URL.
The owner-only inspector must return aggregate counts only and must not export
message bodies, object URLs, object keys, participant ids or Message ids.
Required classes:

- structured file rows with a valid Grainline R2 public URL;
- structured file rows with an allowlisted legacy UploadThing/UTFS URL, grouped
  by provider origin without exposing the URL;
- structured file rows with an invalid, external or unparseable URL;
- raw Grainline R2 image URLs;
- raw Grainline R2 PDF URLs;
- raw allowlisted legacy UploadThing/UTFS image/PDF URLs by provider origin;
- raw external URL-like bodies;
- `kind='file'` rows missing a usable structured body;
- matches to `DirectUpload.publicUrl`, grouped by endpoint, lifecycle status
  and content type;
- structured rows without a matching lifecycle record;
- lifecycle records claimed by Message without a matching classified row; and
- public objects whose metadata/size cannot support a safe private copy.

Inspection stops after counts. Copying bytes, inserting attachment rows,
rewriting Message bodies, changing lifecycle rows or deleting public objects
requires a separately reviewed mutation with backup, rollback and residue
proof.

## Proposed private schema and authority

Add `MessageAttachment` as a sensitive child of `Message`:

- `id` primary key;
- unique `messageId` foreign key with cascade deletion;
- `uploaderId` foreign key;
- unique `directUploadId` foreign key with restricted deletion;
- sanitized nullable `originalName`;
- database-constrained processed image `contentType`;
- positive bounded `byteSize`;
- stable `createdAt`;
- parent and uploader indexes.

The current one-Message-per-attachment contract makes `messageId` unique.
`Message.body` becomes fixed non-sensitive compatibility copy such as
`Sent an attachment`; `Message.kind` remains `file`. Neither the body nor any
client response contains an object key, public URL or signed URL. The opaque
key remains only in the shared lifecycle row; the child references that row by
id instead of duplicating the key.

`MessageAttachment` should start with ENABLE plus FORCE RLS before it can
contain rows. A parent-derived SELECT policy may expose metadata to the two
Conversation participants and the existing exact unresolved-report staff
predicate. Runtime receives only the read privilege required by the reviewed
projection and no direct INSERT/UPDATE/DELETE.

One narrow owner-backed attachment-send function must:

1. validate bounded ids and user-authored name;
2. lock/revalidate the sorted participants, account state and reciprocal block
   absence using the live Message writer protocol;
3. lock the exact Conversation and optional Listing context;
4. lock one `DirectUpload` source owned by the actor;
5. require the reviewed private endpoint, `PRIVATE` storage, processed-image
   content type, verified state, matching Conversation scope and no prior
   claim;
6. derive the lifecycle id, recipient, timestamp, fixed Message body/kind,
   byte size and content type from that locked source;
7. create Message plus MessageAttachment and claim the upload atomically; and
8. return only Message id, recipient id, attachment id, sent time and
   first-response state.

The runtime must not receive a generic attachment insert function or direct
child-table DML. The caller may select one pending upload that it owns, but the
function accepts no durable object URL or metadata: lifecycle identity,
recipient, byte metadata, kind, body and timestamp come from locked durable
rows.

## Upload and read contract

- New ordinary private attachments are processed JPEG, PNG or WebP only,
  metadata-stripped, at most 8 MiB each and at most six per composer submit.
- PDFs are disabled for new sends until malware scanning, quarantine, safe
  content disposition and provider failure handling are explicitly designed
  and proven. Legacy PDFs remain classified/readable during migration; this is
  not permission to accept new unscanned PDFs.
- Upload requires an authenticated active Conversation participant, explicit
  same-origin POST, ordinary message/upload rate limits and current
  recipient/block state.
- The key uses a distinct `messagePrivateImage` prefix, Clerk-safe user
  segment, exact Conversation id and random suffix in the non-public bucket.
- Upload response may return the pending opaque key to the sending composer
  because persistence still needs to claim it. No Message/list/stream/inbox or
  send response returns that key after persistence.
- Read uses an exact Conversation plus attachment id, re-resolves the local
  user, and authorizes participant or exact unresolved-report staff visibility.
  Non-party staff must satisfy the session-bound admin PIN.
- Read verifies the attachment and claimed lifecycle source, then issues at
  most a 60-second signed image redirect. The redirect is private/no-store,
  no-referrer and nosniff; the signed `GetObject` request also pins the
  validated image content type, inline disposition and private/no-store cache
  policy on the object response. R2 does not inherit arbitrary redirect
  headers, so the implementation must not treat redirect `nosniff` as an
  object-response guarantee. Processed image-only bytes, signature validation
  and the pinned response type are the final-response content boundary.
  Foreign, stale, mismatched or deleted sources fail closed.
- Thread history fetches attachment metadata in one bounded batch per Message
  page, not one database query per row. Browser object reads may remain
  per-visible-image; use lazy loading and measure before adding a signed-manifest
  optimization.

## DirectUpload boundary (CM-A21)

`DirectUpload` is already `PLANNED_RLS` in the site-wide matrix. The compatible
Case branch adds private keys to this shared table, and ordinary private
messages would add more. Current runtime CRUD/default privileges are therefore
not a complete database-least-privilege posture for private object metadata.

Do not silently bundle `DirectUpload` activation into Message or Case: it
touches public listing/profile/review/blog/broadcast/commission upload claims,
private uploads, verification, cleanup, account export and account deletion.
Give it a separate actor/operation inventory, fixed verifier/claim/cleanup
catalog, legacy inspection and production release.

Before promoting either private Case evidence or ordinary private messages,
complete the separate `DirectUpload` RLS/fixed-lifecycle rollout. Preparation
and disposable proof may proceed on isolated branches, but production
application code must not make private keys durable while the shared table
retains broad compatible runtime access.

Even after DirectUpload RLS, arbitrary runtime compromise with private R2
credentials remains outside database-policy protection. Provider credential
scope and rotation remain required.

## Compatible release sequence

1. **High audit/design:** pin every byte-write, metadata-read, export,
   deletion, report and legacy shape; add static drift tests. No SQL/provider
   change.
2. **Extra-High preparation:** add the child table, at-birth RLS/grants,
   fixed send/read functions, private upload/read routes and exact ephemeral
   PostgreSQL authority/concurrency/rollback proof. No production mutation.
3. **Schema/function preparation release:** apply only the compatible catalog
   through the protected manual-main migration workflow. Old app continues
   public sends; new catalog is unused.
4. **Compatible application release:** deploy dual-read/new-private-write code.
   Old public messages remain readable and old app instances may still send
   them during coexistence.
5. **Drain/cutover:** prove old deployment drain, then reject `messageAny` and
   `messageFile` ordinary-message use in public image/presign/verify routes.
   Prove a new authenticated private image send/read, cross-user denial,
   reported-staff boundary, export, deletion and zero object/lifecycle residue.
6. **Legacy aggregate inspection:** owner-only, read-only, separately approved.
7. **Legacy copy/rewrite:** separately approved only after exact counts,
   backup and rollback proof. Copy validated first-party bytes to private
   objects before inserting attachment rows; never delete the public source in
   the same release. R2 sources use exact allowlisted keys. Legacy
   UploadThing/UTFS sources require a bounded allowlisted fetch with redirect,
   size, timeout, content-type and file-signature enforcement before image
   re-encoding; they are never treated as R2 keys. Legacy PDFs remain
   read-only until the malware-scan/quarantine decision is implemented.
8. **Public-object retirement:** after authenticated production proof and a
   defined rollback window, separately delete only the exact migrated public
   objects and prove zero dangling private rows/keys. R2 and
   UploadThing/UTFS retirement are separate provider operations with separate
   evidence; failure to delete one provider must not falsify the other.
9. **DirectUpload rollout:** this separate release is a hard production
   promotion gate, not part of the Message migration. Complete its reviewed
   shared-lifecycle authority before either private-object application release.

For this pre-launch program, finish CM-A20 and its DirectUpload prerequisite
before returning to Case activation so the newly found privacy defect is not
deferred. That is an execution-order decision, not a claim that Message
privacy proves Case policy correctness. Case and Message object changes remain
separate releases even when they share bucket primitives.

## Proof and scale gates

Ephemeral PostgreSQL must prove:

- own/other participant and exact reported-staff metadata reads;
- foreign/no-context denial;
- direct child-table write denial;
- source owner, endpoint, storage class, content type, size and status
  validation;
- immutable single claim under concurrent replay;
- send versus block/deletion/concurrent-send winner orderings;
- Message/attachment/lifecycle atomicity;
- export and account-deletion behavior; and
- rollback to the accepted live Conversation/Message catalog.

Provider/authenticated proof must verify:

- private bucket has no public/custom domain;
- public bucket routes reject new ordinary-message use after cutover;
- valid participant upload/read;
- foreign participant and unrelated user denial;
- reported-staff PIN behavior;
- 60-second signed-read/header contract;
- account export contains metadata but no key/URL;
- deletion removes ordinary private bytes but preserves the redacted Message;
- R2 and legacy UploadThing/UTFS copy/retirement use their exact provider path
  without accepting redirects or origins outside the reviewed allowlist;
- exact cleanup of users, sessions, cache keys, database rows and objects.

The current 200-message/50-conversation keyset bounds remain adequate for
storage and metadata. Private image reads add one authenticated route hit per
visible image. Instrument route latency/error rate and R2 signing failures.
Before sustained 1,000 concurrent open message threads or 5% of thread views
loading more than 20 private images, measure the route and consider a bounded
participant-authorized signed-manifest response. The previously documented
managed realtime threshold remains separate; do not weaken RLS or hold database
transactions open to optimize object delivery.

## Exit

The High phase is complete only when the plan, source map, open CM-A21 boundary
and static tests are committed on the isolated stacked branch. Switch to Extra
High before schema, function, policy, grant, private upload/read implementation
or PostgreSQL authority proof.

No CM-A20 completion or production byte-confidentiality claim is allowed until
the private provider smoke, legacy disposition and public-object retirement
state are recorded with exact evidence.
