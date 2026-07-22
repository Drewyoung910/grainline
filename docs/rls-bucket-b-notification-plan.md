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
`docs/rls-drafts/notification-service-authority.sql`. It is live-tested only on
fresh disposable PostgreSQL 16; it is not a migration and is not active in any
persistent database.

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
fallback scaffolding does not. Selection is not promotion. The invoker SQL now
has disposable PostgreSQL parse/apply, own/foreign/direct-denial, column-grant,
and context-reset proof. Final authority review, a byte-pinned real migration,
authenticated runtime-credential proof, and real-table candidate-aligned
provider/route evidence remain open.

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

### Real Notification provider attempt (2026-07-22)

The first provider run against the actual Notification preparation and
activation candidates is also retained as failed evidence. Database preparation
commit `a96acb753f33d78f6da7cbc251a53cbdd8d28b00` applied the byte-pinned split
migrations only to disposable Neon child branch `br-wispy-tree-aawgpj9l`,
passed the migration-derived grant audit, seeded ten deterministic fixtures,
and completed owner-only setup proof. Final Git-integrated Preview commit
`aef7ef2686a0432529a2d17291e2ca04b2fa0714` deployed as
`dpl_8ikdx65RV1WWgv9sQE61sARTV6ZF`. Independent attestation matched the exact
branch/SHA/deployment, `sfo1` Vercel region, `westus3.azure` database region,
pooled `grainline_app_runtime`, 28-key branch-only sensitive environment
manifest with no owner URL, and unchanged production deployment
`dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8`.

Two proof-harness defects were found before any promotion claim. Vercel created
all 28 environment records successfully, but its current API returned opaque
16-character record ids rather than the assumed `env_` prefix. Configuration
therefore failed closed after creation and before a deployment. Exact redacted
inventory showed the reviewed keys, branch, target and sensitivity; a one-time
recovery recorded those ids without changing the attested commit. The durable
validator now treats provider ids as bounded opaque values and has regression
coverage.

Counted slot 1 was then durably claimed and returned HTTP `500`; slot 2 was not
called and the claim ledger was not edited or replayed. A reduced, uncounted
diagnostic against the separate slot-2 disposable fixtures reproduced
PostgreSQL `42P01`: the gate catalog query used `pg_catalog.current_user`, but
`CURRENT_USER` is SQL syntax rather than a schema-qualified function. The gate
now uses `CURRENT_USER AS "currentUser"` and a regression rejects the invalid
qualified spelling. This was a provider-gate query defect, not evidence that
the Notification policies or runtime environment failed. It also means this
attempt contains no successful real Notification provider workload and cannot
be used as performance, route, or activation evidence. A future run requires a
fresh child branch, run id, trigger, commit, deployment, and two new slots.

Abort cleanup passed after diagnosis: owner-only fixture/canary teardown
completed; all 28 branch variables, the exact Preview, sole temporary
automation bypass, disposable Neon branch, and both private state files were
removed; production remained READY and unchanged. Sanitized mode-`0600`
artifacts are:

- `notification-provider-proof-setup-a96acb753f33.json` — SHA-256
  `5cffef30a9adbd0b737678cdf41aa531d956e6a5f4f13e1c70cc8f6a2dd16381`
- `notification-provider-proof-attestation-aef7ef2686a0.json` — SHA-256
  `e052b1510b88722b2ab73ae7e8cc60ee2a0e953679df019e6a38b8c8a12a4145`
- `notification-provider-proof-response-slot-1-aef7ef2686a0.json` — SHA-256
  `8ed4d56fca216d9cdfb14049330eb7052d70059226ab3bdda1945946621927e9`
- `notification-provider-proof-teardown-aef7ef2686a0.json` — SHA-256
  `c92465d4baf54902e634325b5ba1d63b1d36815d29482c68ebe77516bd8618fb`
- `notification-provider-proof-abort-cleanup-aef7ef2686a0.json` — SHA-256
  `0a4e4882dc6e3095a1133ad12fd18c68dff737b2e12e85193429aa99332b83c4`

### Second real Notification provider attempt (2026-07-22)

The fresh follow-up is also failed, consumed evidence and was not replayed.
Preparation commit `d03d87beccdb1b1c76e70fb6d24c28c204538431`
applied the same byte-pinned migrations and fresh fixtures only to expiring Neon
child `br-green-field-aadli194`. The first enable commit
`a645bd0adba4aefe879b68a0798e1090c87e27a1` produced no Vercel deployment:
because the new Git branch's first remote commit disabled itself, removing that
entry did not self-trigger a build. No slot or deployment existed. A reviewed
configured-commit rebind then proved the same 28 environment ids, zero
deployments, changed only the sensitive allowed-SHA value, and pinned trigger
commit `b295116a27401433e717e5022238c4006fb871c6`.

That trigger deployed as Git-integrated Preview
`dpl_8VBGLye1gMnUiVxA7dHMm1BCjZuv`; independent attestation passed. Counted slot
1 then returned HTTP `500` after durable claim, so slot 2 was not called. A
reduced uncounted diagnostic found PostgreSQL `42601`: the service-source
baseline used `pg_catalog.exists(...)`, but `EXISTS` is SQL syntax rather than a
schema function. `SELECT EXISTS (...)` now has a regression. After that fix,
the reduced diagnostic completed the whole gate with zero query errors, stable
service replay, and context reset. Its row-count findings were expected because
the earlier diagnostic had already created one replay notification; its local
latency was diagnostic only. None of this converts the consumed Vercel slot
into a pass.

The operator now makes a reduced real-query local preflight mandatory after
fresh disposable database preparation and before Vercel environment
configuration. It executes the real recipient and source-validation workload,
ignores only local performance thresholds, requires exact correctness and zero
query errors, then owner-resets and reseeds every fixture before a counted run.
This closes the process gap that let two sequential raw-query syntax defects
consume provider slots.

Abort cleanup again passed: fixtures/canary, all 28 branch variables, exact
Preview, temporary bypass, child branch, and private state files were removed;
production remained READY and unchanged. Sanitized mode-`0600` artifacts are:

- `notification-provider-proof-setup-d03d87beccdb.json` — SHA-256
  `10c8a07c1cee957d6f4fb66fdf88ff11fb314ad564bd1dbc9d485928fdc7711c`
- `notification-provider-proof-attestation-b295116a2740.json` — SHA-256
  `a01be557caca72ed3b1cedbb4c487e2ef52bb379ac0c263b7011bdc8cc9fa6a6`
- `notification-provider-proof-response-slot-1-b295116a2740.json` — SHA-256
  `39b13c3f160a217d58c3ea6e72f97ac66c34607ed082d2e0b4c00ba3b0385106`
- `notification-provider-proof-teardown-b295116a2740.json` — SHA-256
  `630d5bdb0bcbe927dee7d5cee0dc7e66e273cf43e8c3daebdd4aa99904dbf420`
- `notification-provider-proof-abort-cleanup-b295116a2740.json` — SHA-256
  `4b269a9692122307fe3395cf7134d813a0c6cb105868b94f341df6c60da4d317`

### Third predeployment-only Notification attempt (2026-07-22)

The third isolated attempt did not create a Vercel environment or deployment
and consumed no provider slot. Preparation commit
`0ac183c8ec213b9e3bfca20f6f4c53cf9f9f64e0` successfully applied the pinned
candidate to fresh expiring Neon child `br-noisy-tree-aa7gi1yn`, passed the
grant/setup gate, and seeded fresh fixtures. The new local real-query preflight
then failed before emitting JSON. A bounded retry fixed the operator's
whole-stdout JSON assumption, re-verified zero Vercel state, the exact Neon
target, migration bytes, grants, and a fresh owner reset/reseed, but again
exited with zero stdout. Because the real query runner had not started, this was
a local tool-bootstrap failure rather than Notification policy evidence.

Raw stderr was intentionally not retained in those artifacts. A later direct
TSX invocation of the exact script reproduced the pre-main cause: top-level
`await` is unsupported when this standalone TSX entrypoint is emitted as
CommonJS. The script now calls `void main()` and a regression forbids the
incompatible top-level form; a dummy loopback run reached the script's
sanitized JSON error path. Independently, the operator now pins an
already-installed TSX `4.21.0` package path, validates its package metadata,
and invokes it directly with the reviewed Node binary. This removes npm
registry/cache availability from the preflight path.
The third attempt was abort-cleaned: fixtures, bypass, child branch, and private
state were removed; branch variables and provider deployments remained zero;
production remained unchanged. Sanitized mode-`0600` artifacts are:

- `notification-provider-proof-setup-0ac183c8ec21.json` — SHA-256
  `dfaed6e6e0d289ef2ae64f3d5bee41365b15b0605c9df6e4c7589aceea17b8f1`
- `notification-provider-proof-local-preflight-0ac183c8ec21.json` — SHA-256
  `57a09c9c7ffbabc98b8f81a3951753b3bab8c9c58dcfc56a88f88d7728d2aa7a`
- `notification-provider-proof-local-preflight-rebind-1fbaacc549a3.json` — SHA-256
  `8693ff189d80640072f71be8f6106ea2b75bb42178f48eccd8a8fbfb7486debd`
- `notification-provider-proof-local-preflight-2-1fbaacc549a3.json` — SHA-256
  `f2c9c10e96cbdd27c083a1224a93469143e607d9100bd81be603c84fcbb5273a`
- `notification-provider-proof-abort-cleanup-1fbaacc549a3.json` — SHA-256
  `efe1f7235066110e28786c5e0ae110118a4aead0844d4e5475f709abf8d4c1e1`

### Fourth real Notification provider attempt (2026-07-22)

The mandatory local preflight finally passed before deployment on fresh
preparation commit `beceee00630c095ba4e0af6a6e53f8a67a580b13`: exact runtime
identity/RLS catalog, all recipient counts, replay stability, statement-local
context reset, zero query errors, and zero local performance issues. Fixtures
were owner-reset and reseeded before the counted run. Enablement commit
`0e84a432d75812b82a3f1e3f09052a1f951c10c4` produced Git-integrated Preview
`dpl_F7H3SBuNc8HiiV16tfbBQNZcScfL`; independent attestation passed.

Counted slot 1 passed with exact correctness and zero request errors. Counted
slot 2 preserved the same correctness and zero-error results but returned HTTP
`422` for one performance issue: target-concurrency bell candidate p95 was
`147.2ms` versus the later baseline's `22.9ms`, exceeding the fixed per-slot
2x ratio. The slot was not replayed and the two-pass proof is not accepted.
The order-reversed evidence demonstrates a first-measured-workload ramp bias:
in slot 1, the baseline ran first and had p95 `149.1ms`, while the later
candidate was `26.8ms`; in slot 2, the candidate ran first and had p95
`147.2ms`, while the later baseline was `22.9ms`. Burst and service results
remained within bounds in both slots. This is evidence against the existing
comparison method, not permission to retroactively pass the failed gate.

The gate now primes each baseline and candidate at the workload's full measured
concurrency immediately before measuring it, in the same slot-specific order;
prime request errors fail closed. A fresh two-slot run is required to validate
that correction. Abort cleanup removed fixtures, all 28 branch variables, the
Preview, temporary bypass, child branch, and private state; production remained
unchanged. Sanitized mode-`0600` artifacts are:

- `notification-provider-proof-setup-beceee00630c.json` — SHA-256
  `37525fe654bb26223961fa0e46d3a59eadcaee2b414255e4cedb8b6a44211da9`
- `notification-provider-proof-local-preflight-beceee00630c.json` — SHA-256
  `a2fcc89c79db9e43ca8acc1d49838be995110e5bb9f36c1c00c5db581013be41`
- `notification-provider-proof-attestation-0e84a432d758.json` — SHA-256
  `1ee5e6593e1411ce9e1a1e5215414a0db1aa11c5cef7b36b512cc9788c16eeb7`
- `notification-provider-proof-response-slot-1-0e84a432d758.json` — SHA-256
  `bfd6edf020d6abdf8ce59ca1ec2fc0f0aaed68daad4fbe571ab4b3898f004d22`
- `notification-provider-proof-response-slot-2-0e84a432d758.json` — SHA-256
  `293c1675864d6865557fe75bfb56075b477070c5f1046681e776b4aba96e3540`
- `notification-provider-proof-teardown-0e84a432d758.json` — SHA-256
  `13bec3a45ca0378c9d2e405ad4f6c22a0b199e503ed4eea8f65d7e02ca355481`
- `notification-provider-proof-abort-cleanup-0e84a432d758.json` — SHA-256
  `0e671c706149bd2d5148bd5084f6e56fdf174ec7f9a951f554195bde602a169c`

The prelaunch/no-dependent-users fact shortens traffic-drain ceremony but does
not waive this candidate's fresh provider run: this hot one-statement recipient
RPC and service-source workload has not yet completed in Vercel. For later RLS
groups, provider performance proof is required only when review finds a new hot
path, pooling/transaction design, lock/concurrency risk, cross-region change,
or material validation joins. Ephemeral authority proof, exact grants,
application/database compatibility, destructive-data review, authenticated
route smoke, and rollback semantics remain mandatory before activation.

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
- Creation authority and owner-derived payload callsite coverage are 54/54.
  PostgreSQL 16 run `29893071538` at exact source
  `187ac2fa5a5b7c08a3889b27ef57c873ee7a79ea` passed disposable-database
  parse/apply, catalog/grant, own/foreign/direct-denial, every granted creation
  family, stable replay, the one-shot back-in-stock claim, and both two-session
  block-race checks. Each of the ten family fixtures rejects a forged recipient;
  mismatched restock evidence neither creates nor consumes. Provider behavior,
  pre-activation review, and direct authenticated runtime-credential proof
  remain separate gates. Direct or generic runtime creation remains
  unacceptable. Its 59 creation cases execute all 26 family-dispatched
  private-core source-validation branches, all 38 successful source/type pairs,
  and their security-relevant action/status/recipient-direction variants with
  valid, replay, and forged-recipient evidence, plus the dedicated back-in-stock
  claim. The later split candidate completes byte-pinned disposable migration
  proof; rollback, provider, and authenticated-route proof remain required
  before calling the service-authority layer activation-ready.
- Role provisioning and the generic grant audit preserve Notification's
  asymmetric table/column grants, initial `NO FORCE` phase, exact policies, and
  25-function ACL/mode split. Accepted split-migration run `29894705025` now
  exercises those migration-derived expectations and database-first rollback
  against disposable PostgreSQL 16. Provider/authenticated-route proof and the
  application deployment rollback sequence remain separate gates.
- Recipient bell/page/count/export/mark-read uses the narrow one-statement
  `SECURITY INVOKER` RPC direction. The rejected transaction wrapper is retained
  only in Git and evidence history, not as executable fallback scaffolding.
  Final promotion still requires SQL authority review, disposable real-table
  PostgreSQL proof, and two fresh passes providing real-table candidate-aligned provider and route evidence.
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
PostgreSQL 16 `grainline_ci` database and applies all current migrations. It
then stages and applies two byte-pinned real Prisma migration candidates. The
preparation candidate adds `relatedUserId` and all 25 RPCs while preserving
disabled RLS, zero policies, and legacy table CRUD. A compatibility proof calls
both old direct CRUD and new recipient/service RPC paths and deliberately leaves
one exact legacy row. Only after that proof does the activation candidate take
the advisory and `ACCESS EXCLUSIVE` locks, prove and purge the exact row count,
install the two policies, enable initial `NO FORCE`, and narrow table grants.
Production-style provisioning, Prisma status, the generic grant audit, and the
68-check Notification authority/concurrency proof run after activation. Every
helper refuses non-loopback hosts and databases other than `grainline_ci`. The
workflow changes neither production nor persistent staging.

Latest accepted run `29894705025` (job `88842292079`) completed at
`2026-07-22T05:46:55Z` against exact source
`a4ced63b065be985965c47a37583ba4c1fdf1e32`. It repeats every accepted
split-migration, compatibility, grant-audit, and 68-check authority result below,
then proves database-first rollback: policies/functions remain installed, RLS
is disabled and legacy CRUD restored, both old direct CRUD and new recipient
RPCs work, and the exact `ENABLE` + `NO FORCE` + narrow-grant activation state
is restored before the final 68-check proof. It explicitly records
`activationPurgeReversible=false`; rollback cannot resurrect legacy rows deleted
by activation. This closes disposable database rollback semantics only. A
provider-owned route/deployment rollback proof remains required.

Earlier accepted sequencing run `29894316762` (job `88841144497`) completed at
`2026-07-22T05:38:35Z` against exact source
`c47acbc79b77dc51c40024e553ee8efceb2e097a`. Preparation candidate
`20260722051500_prepare_notification_rls` had SHA-256
`83f49cec2589c359cda5413282a492f68b26cca760f54861cd29a9a3bfb579f9`;
activation candidate `20260722052000_enable_notification_rls` had SHA-256
`e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329`.
The intermediate proof confirmed old-application direct CRUD compatibility,
new recipient/service RPC callability, private-core denial, and retention of the
legacy row for the locked purge. Both Prisma deploys passed; the final generic
grant audit covered 58 tables, 20 enums, 28 `grainline_*` functions, two RLS
policy tables, and zero sequence references; the final authority proof reported
all 68 checks passed.

Run `29893744367` at `9f42c0917855e10cdd8296cb62f483621629c618`
is retained as technically green but rejected release topology. Its single
all-at-once candidate passed PostgreSQL, Prisma, grant, and authority checks,
but no deployment order was safe: database-first revoked grants before the old
app stopped using them, while app-first called functions that did not yet
exist. It is not promotion evidence. The split above is the accepted proof
direction.

Earlier accepted draft run `29893071538` (job `88837282837`) completed at
`2026-07-22T05:12:11Z` against exact source
`187ac2fa5a5b7c08a3889b27ef57c873ee7a79ea`. It passed current migrations,
baseline provisioning/audit, all three draft applications, post-draft
Notification-aware provisioning convergence, and 19 catalog/isolation/service/
race checks. Those checks include valid creation, stable replay, and
forged-recipient rejection for all ten granted creation families and all 26
family-dispatched private-core source types. Its 59 creation cases cover all 38
successful source/type pairs plus security-relevant action, status, and
recipient-direction variants. It also proves the dedicated back-in-stock claim's
mismatched-evidence, derived-identity, and one-shot-consumption behavior. This
proves the provisioning branch, granted family boundary, and private-core action
matrix on fresh PostgreSQL 16; it still does not exercise the generic grant
audit's migration-derived Notification expectations because the SQL remains in
draft files outside `prisma/migrations`.

Accepted run `29892353264` (job `88835135659`) completed at
`2026-07-22T04:56:36Z` against exact source
`32d18261c0d5e6e818103bd0ba97648f36798861`. It first executed every top-level
private-core source type before the action/status variant matrix was added.

Accepted run `29890596734` (job `88830103706`) completed at
`2026-07-22T04:16:35Z` against exact source
`d1467b2477e9a11802e12244464f444bc27ef39a`. It first proved every granted
creation-family wrapper, post-draft grant convergence, and the expanded
forged-recipient boundary before the per-source execution matrix was added.

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
  64-character replay key as 32 characters; and
- `29890505007`: expanded-fixture bind parameter was inferred as both `varchar`
  and `text` (`42P08`) in two `SystemAuditLog` inserts; fixed only in the
  disposable fixture by explicitly casting the reused target id to `text`; and
- `29892949346`: the Guild-system action-variant fixture reused its actor-id
  parameter as both a `varchar` assignment and JSON `text` (`42P08`); the draft
  functions had already applied successfully, and the fixture now casts the
  actor id to `text` at the SQL boundary with a regression assertion.

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
