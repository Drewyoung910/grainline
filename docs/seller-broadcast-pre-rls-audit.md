# SellerBroadcast pre-RLS audit

Date: 2026-11-01

Status: compatible preparation candidate based on exact public main
`12a4dfc492412ff52ff94d921e20e7026c4cff38`. Option B is selected in
`docs/seller-broadcast-rls-options.md`. The isolated candidate installs 14 new
bounded SellerBroadcast functions, hardens the existing provider-attempt
authority, and converts every application caller while leaving RLS off and
predecessor table grants intact. This document authorizes no Production
operation, merge, deployment, grant change, or RLS activation.

## Domain and data classification

`SellerBroadcast` has six scalars:

| Column | Classification | Current writers/readers |
| --- | --- | --- |
| `id` | stable source identifier | create path; notification/email/upload source validation; staff and deletion |
| `sellerProfileId` | owner relationship | create path; every visibility and lifecycle path |
| `message` | public only through bounded current surfaces | owner create/history/export; public latest; follower feed; staff search |
| `imageUrl` | public first-party media only through bounded current surfaces | owner create/history/export; public latest; follower feed; staff; upload lifecycle |
| `sentAt` | public ordering/time | database default; public/feed/owner/staff ordering |
| `recipientCount` | owner/staff operational metadata | provisional create; after-delivery update; owner history/export; staff |

The message and image are intentionally public when reached through an active
shop page or eligible follower feed. The full history and delivery count are
not currently public. The table therefore cannot be treated as a generic
public catalog relation.

## Exact application caller inventory

On the audited main baseline, six source files performed 16 direct Prisma
operations:

The machine-checked inventory runs with:

```sh
npm run audit:seller-broadcast-consumers
```

| Caller | Direct operations | Principal and invariant |
| --- | --- | --- |
| `src/app/api/seller/broadcast/route.ts` | two `findFirst`, `create`, `findUnique`, `update`, `findMany`, `count` | Active owner create/cooldown, post-response source recheck and count update, owner history |
| `src/app/api/account/feed/route.ts` | `findMany` | Signed-in follower; bounded recent rows for currently visible followed sellers after reciprocal-block filtering |
| `src/app/seller/[id]/page.tsx` | `findFirst` | Anonymous or signed-in viewer; latest row only after seller visibility and block checks |
| `src/app/admin/broadcasts/page.tsx` | `findUnique`, `deleteMany`, `count`, `findMany` | Staff plus admin PIN; global bounded queue/search and atomic deletion side effects |
| `src/app/api/account/export/route.ts` | `findMany` | Active account owner export of the exact seller profile's complete history |
| `src/lib/accountDeletion.ts` | `findMany`, `deleteMany` | Deletion service; source outbox redaction before exact seller broadcast deletion |

No other `src/` file directly queries the delegate on this baseline.

The compatible candidate converts all six callers. Its machine-checked current
inventory is zero source files, zero direct delegate operations, and zero raw
SQL callers outside `src/lib/sellerBroadcastAccess.ts`. The fixed-operation
module is excluded by exact path rather than by query text.

## Installed database dependencies

The current migration chain contains retained functions and triggers that must
survive zero-direct activation:

- `grainline_notification_create_core(...)` locks and validates the exact
  broadcast, seller, source user, follower relationship, recipient account,
  reciprocal-block state, and active-shop state before inserting an in-app
  notification.
- `grainline_notification_delete_seller_broadcast(text)` validates the source
  and deletes its notification rows during staff cleanup.
- `grainline_direct_upload_sync_seller_broadcast(text,text)` locks the exact
  broadcast, proves seller ownership, and claims the durable first-party image.
- `grainline_direct_upload_release_seller_broadcast_delete` releases the
  durable upload reference before row deletion.
- `grainline_email_outbox_source_owner(text,text)` resolves the source seller
  for email enqueue and provider-attempt fences.
- `grainline_seller_staff_broadcast_targets(text,text[])` returns bounded
  seller labels for the staff queue through the isolated staff role.
- the `SellerProfile -> SellerBroadcast` foreign key cascades owner deletion.

Preparation must inventory the exact installed signatures, owners, ACLs,
volatility, security mode, search paths, triggers, constraints, and hashes on a
complete disposable PostgreSQL 17 database. Static migration text is not
sufficient release evidence.

## Workflow audit

### Owner create and cooldown

The route resolves the Clerk account and active seller, validates and sanitizes
message/image input, verifies first-party media, reads eligible followers, and
uses a `SERIALIZABLE` transaction for the durable cooldown recheck, insert, and
upload-reference claim. Concurrent create attempts serialize through SSI: one
commits and a retry observes the new latest row. The Redis limiter is only an
outer abuse control and is not the durable cooldown authority.

The RLS conversion must keep create plus upload-reference claim in one
transaction. Direct owner insert is not acceptable because it would separate
cooldown, active-shop, seller ownership, provisional audience, and media
reference invariants.

### Post-response fanout

The background callback re-reads the source and seller state. In-app
notification creation then re-proves the exact source, follower relationship,
recipient account, blocks, and active-shop state under row locks. Staff or
account deletion either prevents creation or deletes already-created fanout.

The route stores a provisional in-app recipient count and later reduces it to
the number of notifications actually created. The field does not count
email-only recipients, even though the UI labels it generically as
"recipients." That is a product-copy/metric issue, not a reason to broaden
table access; the fixed operation should preserve existing semantics until a
separate product change is approved.

### Queued-email eligibility drift — fixed in preparation

The predecessor email enqueue and provider-attempt functions rechecked source
existence, source-account activity, and recipient email eligibility, but did
not recheck the live follower/block relationship. The compatible preparation
therefore replaces the existing provider-attempt function without changing its
signature or grant. For `seller_broadcast` and
`followed_maker_new_listing`, it now locks the sorted user pair, exact source,
seller, source account, and exact `Follow` before the outbox row; requires an
active public source and seller plus reciprocal `Block` absence; and marks the
claimed job `SKIPPED` before any provider work if that relationship is no
longer eligible. If that claim generation already carries a provider-attempt
marker, the function preserves the ambiguous generation instead of incorrectly
declaring it skipped.

The complete-chain PostgreSQL scenario queues a claimed broadcast email, then
unfollows and proves the predecessor incorrectly reaches `ready`; after the
candidate it proves an already-marked generation remains recoverable, while a
fresh claim becomes `ineligible` plus `SKIPPED`. It separately queues a
followed-listing email, creates a reciprocal block, and proves the same
pre-provider result. The user-pair lock order matches block mutation, while
source-before-outbox matches staff cleanup. Account deletion's source-id
authority now takes the same ordered source-row locks before its outbox
redaction, and a two-session PostgreSQL proof requires provider start to wait
behind deletion without a deadlock.

### Public latest and follower feed

The seller page proves seller visibility and reciprocal-block state before
reading one latest broadcast. The follower feed first derives the actor's
followed seller ids, removes reciprocal blocks, derives currently visible
seller cards, reads at most `limit + 1` recent rows, and rechecks the returned
sellers before rendering.

RLS preparation must preserve those distinct contracts. A policy that permits
all rows for a visible seller would expose old messages and delivery counts
beyond the current public surface.

### Owner history and export

History is bounded to ten rows per page and capped to page 1000. Export returns
the full owner history. Both derive seller ownership from the authenticated
local user, not a client-supplied seller id. The fixed operations must derive
the actor from transaction-local `app.user_id` and refuse banned, deleted, or
missing actors.

### Staff read and delete

The page is guarded by staff role plus admin PIN. It currently performs global
count/search/read and row deletion through the ordinary runtime client, while
seller labels already use the isolated staff client. The RLS conversion must
finish the boundary: staff list/search/delete operations execute only through
`grainline_staff_read_runtime`, validate the staff actor, and bind deletion to
the atomic notification/outbox cleanup and admin audit record.

This is part of the broader verified staff-login gap; activation must not
create a new ordinary-runtime staff mutation authority.

### Account deletion and upload lifecycle

Deletion first enumerates source ids to redact or skip pending emails, then
deletes the seller's broadcasts. The delete trigger releases direct-upload
references. Preparation must keep the cleanup inside the larger account
deletion transaction and must prove another seller's broadcast, outbox,
notification, and upload rows are untouched.

## Race and crash matrix

| Race/crash | Current behavior to preserve | Required proof |
| --- | --- | --- |
| Two owner sends | Serializable conflict/retry leaves one row inside the seven-day window | Two concurrent sessions, one durable row |
| Block/unfollow during in-app fanout | Notification core rechecks and refuses delivery | Hold source/follower locks and prove fail-closed completion |
| Block/unfollow during email queue delay | Currently stale and can send | Failing-first test, then provider-attempt `SKIPPED` |
| Staff delete during in-app fanout | Source locking either prevents create or cleanup deletes the created notification | Two-session delete/create proof |
| Staff delete during email enqueue | Source re-derivation or outbox cleanup prevents retained pending delivery | Two-session enqueue/delete proof |
| Account deletion during fanout | User/source locks plus source cleanup prevent durable post-delete delivery | Two-session deletion/fanout proof |
| Crash after row insert but before response | Row remains durable and cooldown prevents duplicate; background fanout may be incomplete | Replay returns cooldown and does not create a second row |
| Crash during fanout | Notification/outbox dedup keys make retries idempotent, but no durable fanout job currently guarantees completion | Preserve current best-effort semantics; do not claim delivery guarantee |
| Count update after delete | Update may fail and is caught by outer background telemetry; deleted row stays deleted | Delete wins without recreation |

## Findings and disposition

| Finding | Severity | RLS disposition |
| --- | --- | --- |
| Queued broadcast email ignores later unfollow/block | Medium privacy/trust | **FIXED_IN_PREPARATION**: provider-attempt relationship fence plus complete-chain unfollow and reciprocal-block behavior proof |
| Generic recipient label counts in-app deliveries only | Low product accuracy | Deferred product copy/metric decision; preserve field semantics during RLS |
| Staff CRUD uses ordinary runtime while labels use isolated staff role | Medium security boundary | **FIXED_IN_PREPARATION**: count/page/delete now use the isolated staff role, recheck staff and PIN at the action, and co-commit cleanup plus audit |
| Zod's `.max(500)` counts UTF-16 units while storage sanitization truncates by code point | Low input inconsistency | **FIXED_IN_PREPARATION** with code-point validation matching SQL/storage semantics |
| Post-response fanout is best-effort rather than a durable job | Medium reliability, pre-existing | Documented; not silently expanded into the RLS release. Consider a later durable fanout ledger design |

No column deletion, historical content rewrite, or behavior-broadening public
policy is approved.

## Selected authority contracts

Option B needs these bounded operations; exact signatures remain part of the
additive preparation review:

1. owner cooldown/create with active-seller and actor binding;
2. owner paginated history and owner export;
3. public latest for an already-visible seller/viewer contract;
4. actor follower-feed page with current follow/block/visibility checks;
5. source/delivery recheck plus monotonic recipient-count update;
6. isolated-staff count/list/search and atomic delete;
7. account-deletion source-id enumeration and exact seller delete; and
8. retained notification, email-owner, upload-sync, upload-release, and
   staff-target dependencies.

The zero-direct caller gate must cover Prisma delegates, relation traversals,
raw SQL, generic clients, and account-deletion helpers. It must not count
retained fixed functions as direct application access.

## Release and rollback gates

Preparation may be batched with other compatible private-table preparations,
but activation remains serialized and exact:

- complete PostgreSQL 17 chain and current-function catalog inventory;
- failing-first behavior tests for each new contract and the email drift;
- predecessor/new-app compatibility in both deployment orders;
- no direct runtime/PUBLIC table or column privileges after activation;
- exact function owners, ACLs, search paths, volatility, and trigger types;
- app-deploy guard preventing new callers from reaching old database state;
- migration lock and statement timeouts;
- sanitized read-only Production inventory before activation;
- database-first rollback restoring predecessor CRUD and proving predecessor
  statements before disabling RLS; and
- migration-ledger recovery instructions for partial workflow failure.

No production or merge action is authorized by this audit.

## Compatible preparation evidence

The isolated candidate has the following current evidence:

- the complete 448-migration chain passes on disposable PostgreSQL 17;
- owner create/cooldown/history/export, public latest, actor feed, delivery
  update, isolated staff read/delete, account deletion, reciprocal blocks and
  concurrent create behavior execute against the full schema;
- exactly one of two concurrent owner creates succeeds inside the seven-day
  window;
- the shared private-table preparation catalog byte-seals the migration and
  assigns only the three staff operations to `grainline_staff_read_runtime`;
- runtime/staff provisioning and global grant inventory tests agree on the
  exact 11-runtime/3-staff function split; and
- the source consumer inventory is zero direct operations.

This is preparation evidence only. The queued-email eligibility defect blocks
activation until this compatible preparation is accepted in Production, and no
activation migration or emergency rollback has been accepted.

