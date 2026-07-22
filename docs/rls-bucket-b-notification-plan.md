# Bucket B: Notification RLS Plan

Status: isolated B0/B1 implementation in progress under explicit user
authorization. SavedSearch Phase B and runtime database credential separation
are now live with accepted postflights. Code, unapplied migration/RPC/policy
drafts, local/ephemeral PostgreSQL proof, and isolated provider comparison may
continue on this branch. No Notification change may merge to `main`, apply to
production, or activate a persistent staging database before its remaining
Bucket B gates pass.

First B0 slice: source metadata is now a paired typed contract with a canonical
allowlist. New blog-comment notifications identify `blog_comment` plus the
comment id. Staff blog-comment and seller-broadcast deletion prefers exact
source cleanup through narrow owner RPCs. Broad null-source title/body/link
fallbacks have been removed from runtime code.

Account-deletion slice: `Notification.relatedUserId` records the other user
whose identity or authored content is represented in a recipient's row. Twenty-six
literal creation sites now set it, while back-in-stock derives the seller
relationship inside its owner operation. Account deletion deletes
recipient and related-user rows exactly; its broad Notification text scan,
redaction, source deletion, and link deletion fallbacks have been removed. A
guarded prelaunch inspection plus an activation-transaction purge is the
explicit legacy disposition. The SQL remains at
`docs/rls-drafts/notification-related-user.sql`, deliberately outside
`prisma/migrations` so it cannot contaminate the sealed SavedSearch artifact.
The Vercel runtime guard fails closed while that draft file exists, preventing
this intentionally schema-ahead branch from being deployed accidentally.

Service-authority slice: the application create path now targets the first
granted family function, `grainline_notification_create_source_fanout`, through
`notificationServiceAccess.ts`. The private core atomically locks and validates the active recipient, honors the
in-app preference, validates bounded payload/source/related-user metadata,
proves source/type/actor/recipient relationships for the generic source-tagged
paths, inserts idempotently, and returns only the row id. Separate fixed-purpose draft
functions cover account lifecycle deletion, staff blog-comment/broadcast
cleanup, fixed 90-day read/365-day unread retention batches, atomic
back-in-stock claim/create/consume, and the reviewed creation families. Seventeen functions
are owner-backed `SECURITY DEFINER` functions with `search_path=pg_catalog`: the
generic fixed-column core is ungranted, while runtime gets exact `EXECUTE` only
on the source-fanout, social-event, message-event, commission-event, case-event,
inventory-event, verification-event, moderation-event, account-warning, and
order-event wrappers,
the back-in-stock claim, plus five
cleanup/retention operations. Direct table
`INSERT`/`DELETE` stays revoked.
The functions also revoke PostgreSQL's default `PUBLIC` execute privilege.
This narrows runtime authority but does not create database-authenticated end
user identity: the application still asserts `app.user_id`, so a fully
compromised runtime could invoke the granted fixed-purpose functions and could
forge that context. Input, role, age, and source constraints limit that residual
capability; runtime credential separation remains the separate control against
owner-credential exfiltration.
Most domain/audit source tables also retain ordinary runtime CRUD until their
own later site-wide RLS or service-isolation groups activate. Consequently an
arbitrary runtime compromise may be able to fabricate or mutate upstream
evidence and then invoke a narrow Notification family. Bucket B prevents direct
arbitrary Notification table writes and caller-chosen payload/recipient/source
combinations; it must not be described as a complete arbitrary-runtime-
compromise boundary until the referenced source tables receive their own
controls. Preserve this dependency in the site-wide coverage matrix rather than
silently expanding Bucket B to activate those tables together.

The shared role-provisioning and grant-audit path is now Notification-aware.
Provisioning runs its mutations in one transaction, refuses partial or
unexpected Notification policy state, and—only after the exact recipient policy
pair exists—converges the table to `SELECT` plus `UPDATE (read)` and the 25 RPCs
to their exact runtime/PUBLIC posture. The private create core is the sole RPC
that remains runtime-ungranted. The grant audit derives per-table FORCE state
from ordered migration history, accepts the intentional initial Notification
`NO FORCE` release, requires the exact two policy expressions/roles, rejects
table-level INSERT/UPDATE/DELETE and unexpected column grants, and pins each
Notification RPC's owner, SECURITY mode, `search_path`, overload count, and
direct non-grantable runtime/PUBLIC ACL. These are activation artifacts, not
evidence that the current drafts are ready to migrate; their live PostgreSQL
behavior still has to be exercised with the final migration.
All 54 creation paths, exact account cleanup, exact admin source cleanup, and
retention cron are wired to these draft functions in the isolated branch. Admin cleanup
uses only exact source RPCs, and account deletion uses only recipient plus
`relatedUserId` cleanup for Notification. Existing pre-authority rows are not
silently trusted or exposed to a permanent broad runtime function: after the
sequencing postflights, `ops:notification-legacy-inspect` may retain aggregate
counts only. Under the explicit prelaunch/no-users acknowledgement, the eventual
activation migration must take its advisory and exclusive table locks, empty
Notification, verify exact deleted/zero-row accounting, and activate RLS in the
same transaction. A standalone committed purge is prohibited because a cron,
webhook, or request could recreate a legacy row before activation. If real
users exist by then, the purge is prohibited and this disposition must be
redesigned.
The SQL remains outside `prisma/migrations` at
`docs/rls-drafts/notification-service-authority.sql` and is not live-tested.

Extra-high static review hardened the draft further: renderer-aligned relative
link validation rejects backslashes and control characters; recipient, related
user, source, follower, and staff rows use locks appropriate to the state being
validated; account cleanup takes a conflicting user-row lock before deleting;
and staff source cleanup refuses to run until the comment or broadcast was
deleted in the same transaction. These changes close create-versus-delete races
and prevent source metadata from being attached to the wrong notification type,
actor, or recipient. All ten granted creation families now omit
title/body/link/dedup parameters and derive the payload, canonical link, and
stable 64-hex replay identity inside the private core from validated database
facts. App-level title/body copies remain non-authoritative compatibility
evidence, while `link` and `dedupScope` are telemetry only; none crosses the
service-authority boundary. One central check covers the ten block-sensitive
blog/social/content/message/commission sources; case, order, payment, inventory,
moderation, and account-safety notices intentionally bypass user blocks so
required transactional and safety state remains visible. Those block checks do not
rely on an unlocked absence check anymore: notification creation takes
`FOR SHARE` on the recipient/related-user pair in sorted id order, and every
ordinary block/unblock mutation takes `FOR UPDATE` on the same sorted pair
before changing `Block`. Account deletion already takes the conflicting user
lock through notification cleanup before deleting its outgoing blocks. This
defines a deterministic linearization point under the explicitly required
`READ COMMITTED` isolation level; the core rejects stale-snapshot isolation,
and block mutations request `ReadCommitted` explicitly. It does so without granting Notification
authority over `Block`; PostgreSQL race proof is still required before
activation. App-layer authorization and block checks remain required.
The message family proves message kind and conversation participants.
Custom-order-ready extracts the listing id from the durable structured message
inside the private core, joins it to the reserved buyer, seller, conversation
and listing status, and derives `/listing/<id>`. No caller-provided route or
second Notification source field participates in authority.
Commission-interest creation relies on the durable `CommissionInterest` row,
not the request's mutable current status, because its `after()` notification may
race a legitimate close or fulfill transition. Close, fulfill, and expiry
fanout still require the exact final `CommissionRequest` state and recipient
relationship.

All twelve case emissions use durable evidence appropriate to the event. Case
open and staff resolution bind the `Case`; thread notifications bind the exact
`CaseMessage`; mark-resolved now writes its user audit row atomically with the
case transition; cron notifications use the existing system audit row returned
by the same transaction. The audit-backed paths validate recorded transition
metadata instead of mutable current status, so a legitimate later case change
does not silently suppress an already-committed event.

Creation-authority classification is now complete. All 54 emission paths now carry reviewed creation authority:
a non-null source pair and dispatch through one of ten reviewed creation
families or the dedicated back-in-stock claim. The 26 family-dispatched source
types validated by database joins, plus the dedicated back-in-stock operation,
still require PostgreSQL parse/apply and provider performance evidence before
promotion. This 54/54 result does not select the recipient read architecture,
complete guarded legacy inspection plus the atomic activation-purge artifact,
prove block races in PostgreSQL, or prove live isolation.

The inventory family is now complete in the isolated draft. Webhook low-stock uses
the exact `OrderItem` as its durable source and proves the paid `Order`, completed
`CheckoutStockReservation` containing that listing, seller ownership, and live
1-2 quantity before deriving the seller payload and `/dashboard/inventory` link.
Manual low-stock now writes `MANUAL_LISTING_STOCK_LOW` evidence atomically with
the row-locked listing update; its family validates that event, seller, 1-2
quantity snapshot and derives the payload/link. Back-in-stock writes a durable
`MANUAL_LISTING_RESTOCKED` audit in the same transaction as the locked
SOLD_OUT→ACTIVE transition. Its dedicated owner function validates that audit,
locks the exact `StockNotification`, derives recipient/seller/payload/link/replay
identity, applies the in-app preference, inserts idempotently, and consumes the
subscription atomically. Only its winning claim can proceed to independently
preference-gated email enqueueing. This is an atomic restock-audit plus
subscription claim/create/consume operation.

The verification/Guild family is complete in the isolated draft. Seven staff
approve/reject/revoke/reinstate transitions return the durable, non-undone `AdminAuditLog`
row written with the state change. The wrapper validates the active staff role,
seller recipient, `MakerVerification` status, `SellerProfile.guildLevel`, action,
type, and audit target before deriving the payload and route. Three cron paths
use `SystemAuditLog` with fixed job identities. The first Guild Master metrics
warning now writes its system audit in the same transaction as the warning
state; the two revocations already had atomic system evidence.

The moderation and account-warning families bind all five paths to exact durable
evidence. Listing decisions return their co-committed staff audit; listing reports
use the exact `UserReport`. Successful admin emails write a strict post-send audit
containing the bounded notification body before attempting the in-app row. A
banned-seller warning uses `<ban-audit-id>:<order-id>` as a validated compound
event key, proves the order appears in the audit snapshot, derives the buyer and
banned seller, and keeps each affected order's replay identity distinct.

The order, payment, and fulfillment family binds the final nine paths. Checkout
buyer/seller notices validate the atomic checkout-order audit, paid order, exact
buyer, and single seller. Seller fulfillment changes co-commit a user-attributed
system audit with the row-locked order transition, and the owner wrapper derives
the buyer payload from the recorded transition. Seller refunds and blocked
checkout refunds bind durable `OrderPaymentEvent` rows; Stripe disputes require
both the provider event ledger and the applied-side-effects system audit; payout
failure binds `SellerPayoutEvent`. Recipient, counterpart, payload, canonical
route, and replay identity are derived from those ledgers and order
relationships rather than accepted as caller-controlled authority. Dispute
counterpart validation is null-safe so a seller still receives a real provider
dispute notification after buyer deletion has legitimately cleared
`Order.buyerId`; a non-null caller value must still match the retained buyer.

The authority fork is resolved directionally in
`docs/notification-create-authority-inventory.md`: do not accept one permissive
runtime-callable insert, and do not force every path into one provenance shape.
Keep a fixed-column insert primitive ungranted to runtime and expose reviewed
family functions for source fanout, social/review, messaging/custom orders,
cases, commissions, inventory, orders/providers, listing moderation,
verification/guild, and staff warnings. Stable domain ids and small event
discriminators let the database derive or validate recipients and types without
pretending every server-side assertion can be authenticated by PostgreSQL.

Experimental recipient-path slice: every centralized owner read/count/export,
mark-read, conversation mark-read, and low-stock lookup now has a fixed
`SECURITY INVOKER` function in
`docs/rls-drafts/notification-recipient-access.sql`. The application candidate
in `notificationOwnerAccess.ts` makes one database round trip per operation,
sets transaction-local `app.user_id` inside that statement, retains explicit
projections and bounds, and still executes under the runtime role's recipient
RLS plus `SELECT` and column-only `UPDATE (read)` grants. Conversation marking
now uses the exact canonical link instead of substring matching. The prior
interactive-transaction bell/page implementation was removed after the
2026-07-22 provider result selected the one-statement `SECURITY INVOKER`
recipient RPC direction and rejected the transaction candidate for Notification
hot reads. Its measurements and source history remain retained; executable
fallback scaffolding does not. Selection is not promotion. The invoker SQL has not received its final
authority review, PostgreSQL parse/apply, own/foreign/direct-denial proof, or
real-table candidate-aligned provider and route evidence.

### Provider candidate result (2026-07-22)

The first current Bucket B provider attempt is retained as failed evidence, not
retried or reclassified. Disposable commit
`98b1bfefc4b49e10db84df21ef89c8d88243ada3` ran as Git-integrated Vercel
Preview `dpl_8PyoHFUXDocojifoBGLp99nshkta` against the reviewed runtime role on
the disposable Neon branch. Independent attestation matched the exact branch,
SHA, Preview target, `sfo1` execution region, `westus3.azure` database region,
24-key branch-only environment manifest, configured Node `22.x`, observed Node
`v24.18.0`, and unchanged production deployment
`dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8`.

Counted slot 1 returned HTTP `422` with `issueCount=7`; the ledger consumed the
slot and slot 2 was not called. Correctness, recipient isolation, context reset,
prepared-statement/turnover behavior, and every request completed without an
error. The one-statement Prisma `SECURITY INVOKER` candidate passed its
candidate comparisons: target p95 was `24.9ms` versus a `19.8ms` one-statement
baseline, and burst p95 was `36.2ms` versus `36.4ms`. All seven blocking issues
were the generic interactive-transaction wrapper versus autocommit adoption
limits. Representative results were raw target p95 `80.3ms` versus `38.9ms`
with average hold `75.5ms` versus `37.4ms`, raw burst p95 `78.7ms` versus
`39.1ms` with average hold `75.7ms` versus `37.6ms`, and Prisma burst p95
`147.1ms` versus `73.1ms`.

This result rejects the interactive-transaction wrapper for Notification hot
reads and makes the fixed one-statement recipient RPC the selected direction.
It does **not** satisfy the existing two-pass generic provider gate, prove the
real Notification functions, or authorize activation. Do not rerun the same
shape hoping that measurements cross the exact 2x boundary. Before another
provider run, Extra High review must define a candidate-aligned promotion gate:
the unchanged wrapper limits remain blocking for any group that actually uses
interactive transactions, while Notification must pass two fresh slots on its
real one-statement recipient operations plus route/data-shape proof. The RPC
still requires exact SQL authority review and real-table PostgreSQL proof first.

The earlier pre-slot Preview `dpl_FzX4p6B9xzCqKjXdbwR6pEapbArR` failed safely
at build time because the general Vercel guard rejected the intentionally equal
`RLS_CONTEXT_GATE_DATABASE_URL` alias. It consumed no ledger slot. The retry
used a disposable-only exception pinned to Preview environment, exact branch
and SHA, exact staging endpoint/role, byte-identical URLs, and the runner/test
markers; that exception was never added to this canonical branch.

Abort cleanup completed after the consumed slot: the exact Preview, all 24
branch variables, synthetic RPC fixture, disposable Neon branch
`br-sweet-dawn-aa58p53g`, and both temporary secret files were deleted.
Production remained READY and unchanged. Sanitized mode-`0600` artifacts are:

- `notification-provider-proof-attestation-98b1bfefc4b4.json` — SHA-256
  `d4a13a2359988a75d4328f5dd24cd22452c21d57f9ad5a5257d1ab1c85bbea1a`
- `notification-provider-proof-response-slot-1-98b1bfefc4b4.json` — SHA-256
  `0c622af75dedecbc37785dd88ef131f7d25d3687b1a7fff9fbd41e6d1c18aa25`
- `notification-provider-proof-teardown-98b1bfefc4b4.json` — SHA-256
  `43e8566c96486a01acb384e1352bda33fd514d927f43db9282c0ff27a277c79f`
- `notification-provider-proof-abort-cleanup-98b1bfefc4b4.json` — SHA-256
  `39a35ec7a2b46dc2e5615e1f1c3451fb03f734e0e9e8f81f17ab4cfd6c8d09f8`

## Isolation Boundary And Hot-Path Decision

- The isolated branch may retain the verified inventory, source-lifecycle
  hardening, static guards, restored blocking gate, and experimental wrapper.
- SavedSearch Phase B and runtime credential separation completed their exact
  production postflights on 2026-07-21. That sequencing gate is closed.
  Ephemeral PostgreSQL and isolated provider-candidate proof may now proceed;
  this does not authorize production apply, merge, or persistent staging
  activation.
- The statement that the site currently has no users does not waive the sealed
  SavedSearch operator's skew/canary gate or any production evidence gate. It
  only makes parallel isolated Bucket B construction a reasonable use of time.
- The 2026-07-22 provider result rejects interactive transactions for the
  Notification bell/page hot reads and selects narrow one-statement
  `SECURITY INVOKER` recipient RPCs as the candidate direction. It is synthetic
  evidence, not a real Notification-table or route proof, and the consumed run
  did not satisfy the generic two-pass gate.
- Bell/page RPCs must
  preserve explicit projections, counts, pagination, owner isolation, context
  reset, and hot-route SLOs. Mark-read and export need the same candidate review.
- Recipient RPCs are distinct from cross-user creation/cleanup service
  authority. Do not use recipient performance as justification for a broad
  `SECURITY DEFINER` function or direct runtime `INSERT`/`DELETE` grants.

## Scope Boundary

Bucket B means `Notification` only. It does not include `StockNotification`,
`EmailOutbox`, `Conversation`, `Message`, `Order`, payment/shipping records,
`Case`, or `CaseMessage`. Those retain separate coverage-matrix groups and
production releases.

The 2026-07-19 source snapshot contains 51 direct `createNotification` calls
across 29 caller files: 50 object-literal calls plus the fulfillment route's
typed wrapper call. That wrapper serves three distinct fulfillment payloads,
and back-in-stock uses one dedicated owner-backed claim, so the authority
inventory contains 54 distinct emission paths. All 54 are currently
authority-bound and none are source-less. This broad fanout surface is the main
reason the table cannot receive a copied SavedSearch owner-only policy; the
completed source inventory does not remove its asymmetric service-authority
requirements.

## Actor And Operation Inventory

| Actor/path | Operations | Required behavior under RLS |
|---|---|---|
| Authenticated recipient | Count/list/export own rows; mark own row(s) read; mark own conversation notifications read | Set transaction-local `app.user_id`; `SELECT` and `UPDATE` only where `userId` matches; update only the `read` column and never transfer ownership |
| Application notification service | Read recipient preference/status, insert for any legitimate recipient, recover the existing row after a dedup collision | Ten reviewed family creation RPCs plus one dedicated back-in-stock operation; no direct runtime `INSERT`; validate active recipient, preference, enum/payload bounds, source metadata, and dedup inside the database operation |
| Retention cron | Delete old read and unread rows globally in bounded batches | Parameter-free or tightly bounded owner RPC using server time and code-pinned retention windows; no general runtime `DELETE` |
| Account deletion | Delete the departing user's rows and related-user residue across other recipients | Use one narrow account-lifecycle RPC for recipient plus `relatedUserId` deletion; do not grant direct table `DELETE`. The prelaunch activation transaction removes pre-authority rows before this invariant becomes mandatory |
| Staff blog/broadcast deletion | Delete notifications tied to a deleted comment or broadcast across recipients | Use exact `sourceType`/`sourceId` service cleanup only; no title/body/link matching remains in runtime code |
| Admin, webhook, cron, order/case/message/social flows | Create recipient notifications through reviewed service access | All 54 emission paths dispatch through ten reviewed family wrappers or the dedicated back-in-stock claim; the gate also requires the corresponding SQL function, revoke, and runtime grant |

Current access files are deliberately pinned by test. There are no remaining
direct Prisma Notification owner reads or updates outside the RPC helper:

- `src/lib/notificationOwnerAccess.ts` — one-statement invoker RPC candidate;
  no direct Prisma `Notification` table access.
- `src/lib/notifications.ts` plus `src/lib/notificationServiceAccess.ts` —
  bounded service-create input and the single raw service RPC call.
- `src/app/api/cron/notification-prune/route.ts` — bounded orchestration over
  the two parameter-free draft retention functions.

## Chosen Database Shape

1. Keep application authorization primary. RLS is defense in depth.
2. Add recipient policies for `SELECT` and `UPDATE` with both `USING` and
   `WITH CHECK` on exact `userId = current_setting('app.user_id', true)`.
3. Grant the runtime role table `SELECT` and column-level `UPDATE (read)` only.
   Do not grant direct `INSERT` or `DELETE`. RLS cannot by itself prevent an
   owner from changing protected columns, so the column grant is mandatory.
4. Use the selected one-round-trip `SECURITY INVOKER` recipient candidate with
   only the server-resolved local user id. The rejected transaction baseline is
   evidence history, not executable code. Keep PostgreSQL
   isolation/direct-denial proof and candidate-aligned provider/route thresholds
   blocking before activation.
5. Implement notification creation as a narrowly reviewed owner-backed RPC.
   It must be the sole cross-user insert path and must keep recipient status,
   preferences, payload bounds, source metadata, and durable dedup behavior.
6. This RPC is application-asserted service authority, not database-authenticated
   end-user identity. A compromised runtime could call it with another valid
   recipient. Record that residual honestly; do not introduce a second owner or
   service credential into Vercel Functions, which would defeat the runtime
   separation control.
7. Implement separate fixed-purpose cleanup RPCs for retention and exact source
   residue. Do not expose a generic `delete notification where ...` interface.
8. Keep broad legacy Notification scans/redaction out of runtime authority.
   Because this is a confirmed prelaunch/no-users system, retain a read-only
   owner inspection before activation. The destructive purge must be embedded
   in the activation migration's transaction after the advisory and exclusive
   table locks and before policy/grant activation, with exact deleted-row and
   zero-row assertions. A standalone purge is forbidden. If the no-users premise
   changes, do not purge; design a backfill instead.
9. Use `relatedUserId` for exact account-deletion cleanup of cross-recipient
   identity or user-authored notification content. Keep it distinct from
   `sourceType`/`sourceId`, which identify the domain object's lifecycle.
10. Use explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY` for the first
   production activation, then a separate `FORCE ROW LEVEL SECURITY` release
   after its skew/canary/session-drain window. FORCE does not constrain the
   BYPASS migration owner used by service RPCs.

## Implementation Gates

### B0 - Consolidation and source coverage

- Inventory every owner read/update, create/dedup, prune, staff cleanup, and
  account-deletion path mechanically.
- Add `sourceType`/`sourceId` to every fanout whose lifecycle can require
  cross-recipient cleanup; inspect legacy rows and purge them atomically in the
  activation transaction.
- Add `relatedUserId` to every cross-recipient notification containing another
  user's identity, authored text, or account-owned object reference.
- Replace blog/broadcast title/body/link cleanup with exact source cleanup.
- Run the guarded prelaunch aggregate inspection. Put the destructive purge,
  exact deleted/zero-row assertions, and RLS activation in one database
  transaction; never commit a standalone reset.
- Serialize reciprocal block absence checks with block/unblock mutations using
  the shared sorted-user-row lock protocol; prove both transaction orderings in
  PostgreSQL before activation.
- Retain two fresh counted passes for the real Notification recipient RPC and
  route workload under a reviewed candidate-aligned gate. The unchanged generic
  transaction limits remain blocking for later releases that actually adopt
  interactive transactions.

### B1 - Staging database prototype

- Add exact creation and cleanup RPCs, recipient policies, grants, default
  privileges, catalog fingerprints, and static callsite guards.
- Test own/foreign empty and nonempty reads, counts, pagination, exports,
  mark-one, mark-many, conversation mark-read, column-update denial, ownership
  transfer denial, direct insert/delete denial, RPC dedup, preference opt-out,
  recipient suspension/deletion, retention batches, source cleanup, account
  deletion, connection reuse, and context reset.
- Exercise rollback in staging: disable RLS, restore grants/RPC posture, re-enable
  exact policies, and positively verify the final state.

### B2 - Production activation

- Require Phase B and runtime credential separation already live and healthy.
- Run `npm run audit:rls-notification-readiness` and require an exact 54/54
  result. The AST-backed gate fails on count drift, dynamic/unrecognized helper
  calls, missing source pairs, source constants not dispatched by a reviewed
  service family, or a missing SQL wrapper/revoke/runtime grant. Its current
  green result proves the creation call graph and draft authority surface agree;
  it is not a complete Bucket B activation verdict.
- Deploy Notification RPC/application changes before enabling policies where
  compatibility requires it; never ship an app/table ordering that strands
  writes or cleanup.
- Activate `ENABLE` with explicit `NO FORCE`, retain catalog/grant/direct-denial
  evidence, route smokes, cron/webhook health, account-deletion proof, and a
  permanent non-customer Notification canary.
- Promote FORCE only in a later release after the full provider skew window,
  post-skew canary, owner credential/session drain, and tested database-first
  rollback.

## Current Blockers

- SavedSearch Phase B and runtime owner-credential separation are complete with
  accepted production postflights; they are no longer Bucket B blockers.
- Existing pre-authority Notification rows still require the guarded aggregate
  inspection and an atomic activation-transaction purge. The purge must not run
  if real users begin relying on notifications; that change requires a backfill.
- Creation authority and owner-derived payload coverage are 54/54. PostgreSQL
  16 run `29883083596` at exact source
  `1b9bd603d53488f18375d369835085e6581fb9b2` passed disposable-database
  parse/apply, catalog/grant, own/foreign/direct-denial, source/replay, and both
  two-session block-race checks. Provider behavior, pre-activation review, and
  direct authenticated runtime-credential proof remain separate gates. Direct
  or generic runtime creation remains unacceptable.
  The disposable proof dynamically exercised the social/follow creation family,
  not every source branch in the ten creation wrappers. Expand the final
  PostgreSQL fixture set across every authority family (including negative
  source/recipient/actor cases) before calling the service-authority layer
  activation-ready.
- Role provisioning and the generic grant audit now preserve Notification's
  asymmetric table/column grants, initial `NO FORCE` phase, exact policies, and
  25-function ACL/mode split. The final migration must still pass those checks
  against a disposable real database; static guardrails are not a live proof.
- Recipient bell/page/count/export/mark-read uses the narrow one-statement
  `SECURITY INVOKER` RPC direction. The rejected transaction wrapper is retained
  only in Git and evidence history, not as executable fallback scaffolding.
  Final promotion still requires
  SQL authority review, real-table PostgreSQL proof, and two fresh
  candidate-aligned provider/route passes.
- The social/message/commission block-race protocol is implemented, statically
  guarded, and passed both transaction orderings under the CI runtime policy
  role. The proof uses CI-superuser `SET ROLE`, not a production runtime
  credential, so it proves policy-role permissions and lock behavior without
  claiming production authentication-path equivalence.
- The generic wrapper findings remain blocking evidence against adopting that
  architecture. Extra High review must add the real Notification RPC/route
  workload without deleting or downgrading those findings; two fresh counted
  passes are still required.

These blockers permit isolated implementation drafts, ephemeral PostgreSQL
proof, and candidate-aligned provider comparison. They prohibit merge,
production apply/deployment, persistent staging activation, and production
Notification RLS activation.

## Ephemeral PostgreSQL proof checkpoint (2026-07-22)

The branch-only `Notification RLS Ephemeral Proof` workflow creates a fresh
PostgreSQL 16 `grainline_ci` database, applies all current migrations and
production-style runtime grants, then applies the three isolated Notification
drafts. The proof script refuses non-loopback hosts and any database name other
than `grainline_ci`. It changes neither production nor persistent staging.

Accepted run `29883083596` (job `88807905625`) completed at
`2026-07-22T01:27:06.486Z` against exact source
`1b9bd603d53488f18375d369835085e6581fb9b2`. Its nine passing checks cover:

- runtime role attributes, `ENABLE` plus explicit `NO FORCE`, the exact two
  recipient policies, table/column grants, function security modes, pinned
  `search_path`, runtime execute grants, and `PUBLIC` revocation;
- zero direct rows without context, own-row filtering with transaction-local
  context, column-only `read` updates, and denial of direct title update,
  insert, delete, and private-core execution;
- one-statement recipient RPC results and context reset;
- family/source rejection, DB-derived payload, and stable DB-derived replay
  identity; and
- both lock orderings: creation first makes block creation wait and commits
  before the block; block first makes creation wait and then return `NULL`
  after observing the committed reciprocal block.

The proof also records the recipient candidate's honest residual boundary: its
`p_user_id` is application-asserted. It must be supplied only from the
server-resolved authenticated identity. This RLS layer limits accidental direct
ORM/table access; it does not claim to stop a fully compromised runtime role
from deliberately invoking an RPC with another user's id.

Failed-run ledger retained for diagnosis:

- `29882719410`: harness-only `name[]` decoding mismatch for policy roles;
- `29882790058`: harness-only catalog scope included the pre-existing
  `grainline_notification_preferences_valid` function;
- `29882864893`: genuine draft defect, PostgreSQL error `42804` when executing
  text-returning recipient RPCs over `varchar` Notification columns; fixed by
  explicit casts in bell/page/export plus a regression assertion; and
- `29883002383`: harness-only expectation treated the deliberately doubled-MD5
  64-character replay key as 32 characters.

## Preview deployment guard checkpoint (2026-07-22)

Git integration attempted eight Preview deployments for Notification commits
`4177c53e` through `37d2ced1`. Vercel deployments `dpl_5ruyxHuYr5QeLa8fhRckNz3uAXpt`,
`dpl_HfGj813HSMLaP9fkJn9dMvZXRXAa`, `dpl_3pLFn1L8haX5vPFKKQsmZHs5yDZ5`,
`dpl_ACPvp8YcRPJA9LTxFma4sPax5G6m`, `dpl_4GSdxVgNM2bWVH9vySWuSEG6jxrQ`,
`dpl_3uFW864crt81ZQinHgUD7zSBKxrK`, `dpl_CkpLxB1PD8Qg3Y9JoXttt6D9CTef`,
and `dpl_3sDbx3esnsst5SuzWS4uFiA3jDJ7` all stopped at
`guard:runtime-db-env` before `next build`; none produced a runnable Preview or
changed production. The guard was working as designed because the branch still
contains unapplied Notification SQL under `docs/rls-drafts`, but the exception
was previously reported as `[UNCLASSIFIED]`. The bounded diagnostic is now
`[NOTIFICATION_RLS_DRAFT_PRESENT]`.

Automatic Vercel deployment is disabled for the long-lived Notification branch.
The completed generic comparison used a separate disposable proof branch, now
deleted. A future real Notification candidate run must again use a freshly
reviewed disposable branch and temporary Preview runner rather than making the
long-lived SQL-draft branch deployable. This avoids weakening the draft guard
while allowing the exact real-table RPC/route candidate to be measured after
its authority and PostgreSQL gates pass.

The project also has a linked team-shared `DATABASE_URL` whose metadata targets
Development, Preview, and Production. Ordinary Previews therefore receive a
database value even though `vercel env ls` shows no project-level Preview
`DATABASE_URL`; recent unrelated Previews correctly rejected its shape as
`[DATABASE_URL_SHAPE]`. The disposable proof branch must override it with an
exact branch-scoped, isolated-staging pooled runtime URL. Teardown must remove
that branch override, every `RLS_CONTEXT_GATE_*` variable, the Preview
deployment, the synthetic schema/function/ledger, the isolated database branch
or project, and the disposable Git branch. Sanitized evidence, tests, the
generic harness, and this failure ledger are durable; credentials, provider
resources, runner route, middleware exemption, and runner-only test are not.

The Node warning in those logs is separate from the guard failures.
`package.json` currently declares `>=22`, so Vercel selects Node 24 despite the
project's 22.x setting; the accepted production deployment's Functions are also
`nodejs24.x`. The disposable performance run should preserve that current
runtime for comparability. Pinning an intended Node major is a separate release
decision and must not be smuggled into the temporary proof branch.
