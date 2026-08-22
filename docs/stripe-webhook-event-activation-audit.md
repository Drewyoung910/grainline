# StripeWebhookEvent activation audit

Status: policyless Phase A is live in production with FORCE deliberately off.
Compatible maintenance functions and the exact application remain live. Reviewed
test-mode provider correction plus signed classic Connect delivery/retry now
pass alongside exact platform/v2 topology checks, rollback-only retention,
expanded ops health and legacy restoration. The activation revoked direct
runtime table/column authority while retaining exactly six functions. Connect v2
signed delivery remains a mandatory launch/provider proof, but is not a
StripeWebhookEvent database-authority gate: all three signed routes use the
same fixed begin/complete/fail functions and have zero direct table access.
The predecessor deployment/drain check and hardened final compatibility
postflight now pass; live-mode provider proof remains a separate launch
release.

## Exact reviewed stack

The compatible database preparation, application conversion and maintenance
conversion are complete. Their accepted release sequence was:

1. PR #160 is merged. Exact main
   `6f1f4c1e99fb21726744ecd1652a37b6be35c294` passed CI `31276366947`;
   guarded Production Migrations run `31277540714` applied only
   `20260805012000_prepare_order_payment_shipping_compatibility`; and the
   separate actual pooled-runtime read-only postflight passed with all six
   integrity counts at zero. This installed compatible seller keys,
   invariants and generation-bound Stripe lease functions without changing
   RLS, policies or predecessor table grants.
2. PR #161, `agent/order-payment-shipping-app-conversion-20260805`, exact head
   `d2ef37b4c86a0ff174016be77113fa1b888131b4`, converts the signed Stripe
   route to the generation-bound begin/complete/fail functions and closes the
   duplicate-delivery lease race. Exact-head CI `31278958695` passed, and the
   head merged as main `0e2e1cce29089ab1418ff006b461d74b5f9804ca`.
3. PR #162, `agent/stripe-webhook-maintenance-authority-20260805`, exact head
   `8abaa36fafd989604a06aa2fee9f1a215e5763b1`, converts retention,
   aggregate health and the legacy stock-restore claim to three narrow fixed
   functions. It merged as main
   `1fbf17845d72403d8ff28cd038119114583eba04`.
4. PR #163 merged this audit-only head
   `73d302b85698d6af1e0a4e17abf0e590a091ef7a`, producing exact main
   `423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1`. Exact-main CI
   `31284293394` passed. Guarded migration run `31290691183` then applied only
   `20260805040000_prepare_stripe_webhook_maintenance_authority` and passed
   migration status plus the global grant/RLS audit.

The compatible source and functions are merged and live. The current canonical
production deployment is `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP`, whose official
Vercel metadata reports source `69c14c0618ea7ab9c74756422273d17d66db7efa`,
`READY`, and all reviewed canonical aliases; the canonical health endpoint
returned HTTP 200. That source is later than and contains the compatible
application release. Production deliberately retains the predecessor table
posture for `StripeWebhookEvent`: RLS/FORCE off, zero policies and broad
runtime CRUD. The remaining activation order is a release dependency, not
authorization to skip a boundary.

## Accepted predecessor release evidence (2026-08-10)

Draft PR #186 candidate `d9b637c6a76196579317de3b189046746ca19916`
passed exact-head CI run `31372665563`. The run applied the policyless
activation in disposable PostgreSQL, converged and audited grants, opened a
new connection authenticated directly as the restricted runtime role, proved
direct table denial plus all six fixed operations, rehearsed database-first
rollback/restoration, and passed the full test, type, lint, dependency-audit
and production-build gates.

From that exact clean candidate checkout, the historical compatible-state
postflight then connected through the actual pooled production
`grainline_app_runtime` credential in an engine-attested repeatable-read,
read-only transaction. It confirmed:

- `StripeWebhookEvent` still has RLS/FORCE off, zero policies and exact direct
  runtime SELECT/INSERT/UPDATE/DELETE with no grant option;
- PUBLIC and runtime column authority are absent;
- all four private integrity functions and all six runtime functions have the
  exact reviewed owner, signature, mode, pinned search path, ACL and source;
- all six aggregate relationship/claim-generation integrity counts are zero;
  and
- private helper execution is denied directly to the runtime role.

The postflight bound CI `31372665563` and maintenance migration run
`31290691183`, returned `productionChangedByPostflight=false`, and wrote only
sanitized mode-0600 local evidence. It ran no migration and changed no
database, deployment or provider state.

## Accepted Phase-A production evidence (2026-08-10)

PR #186 merged exact reviewed head
`654a730b575ddbcf954f6a6287f5aa6fa34c592a` as exact main
`f987645784a447604fcab2399dc8e7fd7bef9d7c`. Exact-main CI
`31408797498` passed the byte-pinned migration audit, disposable PostgreSQL
activation and rollback, direct runtime-login proof, grant/RLS audit, full
suite, TypeScript, lint, dependency audit and production build.

Guarded Production Migrations run `31410550315` then applied only
`20260805060000_enable_stripe_webhook_event_rls`. Migration status and the
global grant/RLS audit passed. The resulting production posture is policyless
ENABLE with NO FORCE, zero policies, zero direct runtime/PUBLIC table or column
authority, and runtime EXECUTE on exactly the six source-pinned functions.
There was no application deployment or Stripe/Vercel provider change.

The separate actual pooled-runtime postflight ran from the exact clean main
commit, bound to CI `31408797498` and migration run `31410550315`. PostgreSQL
attested the restricted `grainline_app_runtime` identity and a repeatable-read
read-only transaction. The proof confirmed the exact table/function/source/ACL
catalog, direct table-read denial, successful aggregate health, and SQLSTATE
`25006` when the write-capable begin function reached the engine's read-only
fence. It wrote sanitized mode-0600 evidence and returned
`productionChangedByPostflight=false`.

## Authority decision

`StripeWebhookEvent` is a service-owned mutable lease, not a participant data
table. Its activation target is:

- policyless `ENABLE ROW LEVEL SECURITY` first, with FORCE held for a later
  posture-only release;
- zero table or column privileges for `PUBLIC` and
  `grainline_app_runtime`;
- zero user, seller or staff row policies; and
- runtime EXECUTE on exactly these six fixed signatures:
  - `grainline_stripe_webhook_begin(text,text)`;
  - `grainline_stripe_webhook_complete(text,bigint)`;
  - `grainline_stripe_webhook_fail(text,bigint,text)`;
  - `grainline_stripe_webhook_prune_batch(integer)`;
  - `grainline_stripe_webhook_health_summary()`; and
  - `grainline_legacy_stock_restore_claim(text)`.

No generic lookup, insert, update, delete, arbitrary cutoff, event-id batch or
error projection is permitted. Trigger/internal functions remain
runtime-inaccessible. The global provisioning script must converge to this
same exact posture after activation; rerunning role provisioning must not
restore the predecessor CRUD grant.

## Authentication and threat boundary

The database does not authenticate Stripe. The application verifies the
Stripe signature before it calls `begin`; a holder of the runtime database
credential can still supply a fabricated event id and type to that fixed
function. The function provides immutable type binding, replay protection,
generation-bound lease ownership and narrow state mutation. It removes raw
row enumeration, deletion, arbitrary completion/failure and retained-error
access, but it does not replace the Stripe signing secret.

This limitation is accepted for this activation and must remain explicit in
security claims. A separate provider-worker database credential or attestation
design could strengthen ingress authenticity later.

## Access inventory

### Ordinary application source

The machine-scanned `src` tree has zero direct Prisma delegate or raw-table
access to `StripeWebhookEvent` after the PR #161 and PR #162 conversions.
Runtime consumers are partitioned as follows:

| Consumer | Fixed authority |
|---|---|
| Signed Stripe webhook route | generation-bound begin, complete and fail |
| Processed-event retention | fixed 90-day, stable-order prune batch |
| Ops health | fixed-window aggregate-only health summary |
| Legacy checkout stock restoration | canonical session-derived dedup claim |

### Proof and operator scripts

Direct table text outside `src` is not automatically a runtime authority
defect. Each remaining path is classified:

- `scripts/stripe-webhook-lease-compatibility-postgres-proof.mjs` is a
  loopback-only disposable PostgreSQL preparation proof. It executes as its
  synthetic proof owner and rolls back all fixtures.
- `scripts/stripe-webhook-maintenance-authority-postgres-proof.mjs` is the
  loopback-only disposable PostgreSQL proof for the three maintenance
  functions. It also rolls back every fixture.
- `scripts/order-payment-shipping-legacy-inspect.mjs` is the protected,
  owner-authenticated, aggregate-only production predecessor inspector. It
  runs in an engine-attested repeatable-read read-only transaction and exports
  no rows or provider identifiers. It is not an ordinary runtime path.
- `scripts/seller-payout-event-activation-postgres-proof.mjs` is the
  loopback-only disposable PostgreSQL proof for the later policyless
  SellerPayoutEvent activation. It uses separate synthetic owner and restricted
  runtime logins to prove exact fixed-function behavior and direct table denial;
  it cannot accept a provider or production endpoint and is not an application
  runtime path.
- `scripts/seller-payout-event-authority-postgres-proof.mjs` is the
  loopback-only disposable PostgreSQL proof for the later SellerPayoutEvent
  compatible-authority successor. It uses a synthetic owner plus restricted
  runtime roles, deliberately reads the source lease table to validate fixed
  function behavior, and removes every prefix-scoped fixture in `finally`. It
  is neither ordinary application access nor a production inspection path.
- `scripts/seller-payout-event-linked-production-proof.mjs` is the protected,
  exact-release-bound linked-seller proof. It uses the owner only for a bounded
  candidate query, exact source/projection relationship checks and exact
  cleanup; uses the actual pooled runtime for the recipient-visible check; and
  retains only the processed test-mode webhook lease. Its owner transactions
  are engine-read-only except for the one source-locked cleanup transaction,
  it exports only sanitized hashes, and it is neither ordinary application
  access nor reusable table authority.
- `scripts/stripe-webhook-event-activation-postgres-proof.mjs` is the
  loopback-only activated-boundary proof. It uses owner catalog reads and
  deliberately attempts direct operations after `SET LOCAL ROLE` to prove
  SQLSTATE `42501`, then rolls back every function fixture.
- `scripts/stripe-webhook-event-activation-production-postflight.mjs` is the
  actual pooled-production-runtime, repeatable-read/read-only postflight. It
  rejects owner and aliased URLs, verifies exact source and ACL catalog state,
  proves direct read denial and the write-function read-only fence, rolls back,
  and retains only sanitized mode-0600 evidence. It never uses owner
  `SET ROLE` and is not a migration path.
- `scripts/stripe-webhook-event-activation-postflight-postgres-proof.mjs` is
  the loopback-only PostgreSQL proof of that postflight's catalog and denial
  path. CI gives the ephemeral restricted role a disposable password and the
  proof opens a new connection as that role; it never uses owner `SET ROLE` and
  touches no persistent database.
- `scripts/stripe-webhook-event-activation-rollback-proof.mjs` is the
  loopback-only database-first rollback rehearsal. It temporarily restores
  predecessor CRUD in disposable PostgreSQL, proves old-runtime compatibility,
  and restores activation in a fail-closed cleanup path.
- `scripts/stripe-webhook-event-force-postgres-proof.mjs` is the loopback-only
  proof of the separately reviewed policyless FORCE posture. It reuses the
  exact Phase-A catalog and runtime-operation proof with FORCE required and
  rolls back every function fixture.
- `scripts/stripe-webhook-event-force-production-postflight.mjs` is the
  actual pooled-production-runtime, repeatable-read/read-only FORCE postflight.
  It repeats the exact six-function, direct-denial and write-fence checks with
  FORCE required, rejects privileged or aliased URLs, and writes only fresh
  sanitized mode-0600 evidence.
- `scripts/stripe-webhook-event-force-rollback-proof.mjs` is the loopback-only
  posture rollback rehearsal. It proves exact FORCE to NO FORCE rollback and
  the unchanged Phase-A authority boundary, then restores FORCE in a
  fail-closed cleanup path before closing its owner connection.
- `scripts/order-payment-shipping-compatible-production-postflight.mjs` is a
  historical compatibility-posture proof that directly reads the table under
  the pooled runtime role while predecessor CRUD remains present. It must run
  before activation and be excluded from post-activation CI/release phases;
  it is not evidence for the activated posture.
- `scripts/buyer-deletion-stripe-replay-postgres-proof.mjs` is a loopback-only
  disposable PostgreSQL proof of the real Prisma interactive-transaction
  rollback behavior. It proves missing-row inserts and stale reclaims roll
  back, processed/in-progress classification is preserved, type mismatch
  fails, and exact fixture residue returns to zero.
- `scripts/checkout-stock-reservation-production-smoke.mjs` is the protected,
  one-shot compatible-application checkout smoke. Its direct
  `StripeWebhookEvent` reads use only the protected owner connection to prove
  three exact signed expiry rows and one exact made-to-order legacy restore
  claim for its disposable session IDs. It never deletes those immutable
  audit/idempotency rows, grants no runtime table access, retains no IDs in its
  sanitized evidence, and is not an ordinary application path.
- `scripts/stripe-connect-signed-payout-proof.mjs` is the protected,
  exact-release-bound pre-activation Connect delivery proof. It uses the
  reviewed pooled runtime credential inside an engine-enforced read-only
  transaction to confirm one exact `payout.failed` lease and zero marketplace
  projection for its disposable account. It exports only counts and ID hashes,
  cannot mutate the database, and must be excluded from post-activation
  CI/release phases after runtime table SELECT is revoked.
- `tests/retention-and-ops-followups.test.mjs` contains only source assertions
  about the retired direct SQL and has no database access.
- `scripts/buyer-deletion-stripe-replay-proof.mjs` is a staging/local launch
  proof. Its former direct Prisma lookup was an activation blocker and is
  converted in this checkpoint as described below.

Owner/proof access does not justify restoring ordinary runtime SELECT after
activation.

## Buyer-deletion launch-proof conversion

The launch proof previously called
`prisma.stripeWebhookEvent.findUnique(...)` and asserted `processedAt` plus
`lastError`. That would fail closed after policyless RLS, but retaining it
would either strand a launch blocker or tempt a broad runtime read projection.

The corrected proof now:

1. derives the event id from the explicit fail-closed input or the exact
   checkout-created `SystemAuditLog.actorId`;
2. requires both values to match when both exist;
3. retrieves that exact event through the Stripe test API and verifies test
   mode, an accepted checkout-completion type and the exact proof Checkout
   Session;
4. calls `grainline_stripe_webhook_begin(event_id,event_type)` through the
   engine-attested staging/local runtime connection; and
5. deliberately throws inside the interactive transaction for every returned
   action so PostgreSQL rolls back any missing-row insert or stale reclaim.

Only `action=processed` passes. `process` or `in_progress` fails the launch
proof, and a type mismatch fails in PostgreSQL. This proves the exact
provider-bound row exists, has the immutable expected type and is terminally
processed without raw table visibility or durable verifier mutation.

The operator harness uses the dedicated
`BUYER_DELETION_REPLAY_PROOF_DATABASE_URL`, never ambient `DATABASE_URL` or an
owner/direct alias. Before connecting it requires an explicit `local` or
`neon-staging` target, the expected database and, for Neon, the exact staging
endpoint and region. It rejects the reviewed production endpoint, remote URLs
disguised as local, non-pooled Neon URLs, owner usernames, unreviewed connection
parameters, privileged database environment keys and every additional
PostgreSQL URL in the environment. After connecting, PostgreSQL must attest
`current_user=session_user=grainline_app_runtime`, the exact database, LOGIN,
NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION and
NOBYPASSRLS. Sanitized evidence records both the configured target and this
engine-attested identity, never the URL or credentials.

The converted proof no longer claims to independently read `lastError IS
NULL`. A successful `complete` operation clears `lastError`, the fixed `begin`
result proves terminal processed state, the protected 54-count predecessor
inspection reported zero webhook coherence errors, and ops health retains the
aggregate failed/stale contract. Adding a runtime row/error projection solely
for this launch harness would weaken production authority for no product need.

## Scale and locking conclusion

The ledger already has indexes on `(type,createdAt)` and `processedAt`.
Pruning uses the fixed `processedAt` cutoff plus stable `(processedAt,id)`
ordering, while health scans only unprocessed/released windows. Processed rows
are bounded by the fixed 90-day retention path and unprocessed rows should be a
small exceptional set. No new index is required for this activation. Revisit
with real plans and cardinalities if health or pruning latency grows; do not
add a speculative write-amplifying index at this boundary.

The begin function locks only the exact event row after a conflict. Complete
and fail compare the exact claim generation. Maintenance pruning uses bounded
stable batches while permanently excluding the finite legacy stock-restore
dedup class; the legacy claim takes the canonical checkout mutation lock.
Disposable PostgreSQL proof must retain stale-worker, block/wait,
concurrent prune/claim and rollback-zero-residue coverage.

## Mixed-deployment and activation sequence

RLS activation cannot precede the compatible application release. Old Vercel
instances and webhook retries still use direct table CRUD. The required order
is:

1. **complete:** merge and apply only the reviewed compatible preparation
   migrations from PR #160; run their predecessor-compatible owner and
   pooled-runtime proofs;
2. merge the exact app conversions from PR #161 and PR #162, then apply only
   PR #162's additive
   `20260805040000_prepare_stripe_webhook_maintenance_authority` migration from
   the resulting exact green main commit before deploying any PR #162 runtime
   call sites;
3. **test-mode complete:** migration status and the global grant/RLS audit
   passed; the exact compatible app is deployed; classic delivery/retry,
   rollback-only retention, expanded aggregate health and legacy restore
   passed. The three source-bound provider surfaces now have exact test-mode
   subscription evidence, and the separately signed classic Connect
   `payout.failed` delivery plus exact retry produced one unchanged
   generation-1 lease. Valid Connect v2 signed delivery remains open as a
   launch/provider gate. It is not a database-authority activation prerequisite
   because the platform, classic Connect and v2 routes all use the same fixed
   lease wrappers and the source gate proves zero direct table access. Live-mode
   topology and signed deliveries likewise remain separate launch evidence;
4. let the prior app deployment drain and verify no production route or job
   still uses direct table access;
5. run the historical compatibility postflight for the final predecessor
   record;
6. apply a separately reviewed, byte-pinned policyless ENABLE migration that
   revokes table/column grants and preserves only the six functions;
7. run actual pooled-runtime direct-denial and all-six-function postflights;
8. deploy no app change merely to activate RLS; rollback database posture
   first if the fixed-operation smoke fails; and
9. only after a stable observation window, prepare a separate posture-only
   FORCE migration and repeat owner plus pooled-runtime proofs.

No long arbitrary wait substitutes for proof, but the old/new application
coexistence boundary is still real even pre-launch because Stripe deliveries,
cron and maintenance jobs can execute without human traffic.

## Activation migration and rollback proof requirements

The later activation candidate must fail closed unless it proves:

- exact owner, runtime NOBYPASSRLS identity and allowed Neon bootstrap
  membership posture;
- the inspected predecessor RLS/FORCE/policy and table/column grant state;
- all six function owners, signatures, pinned `search_path`, SECURITY DEFINER
  posture, no dynamic SQL, exact PUBLIC/runtime ACLs and reviewed definitions;
- `claimGeneration` NOT NULL plus its positive check and the expected indexes;
- policyless ENABLE, NO FORCE, zero direct PUBLIC/runtime authority after the
  mutation; and
- exact migration-tree and byte pins in CI and the guarded production runner.

The Extra-High exact-head review found and closed one ACL-proof gap before
activation: the functions already granted ordinary runtime `EXECUTE`, but the
catalog predicate did not explicitly reject runtime `EXECUTE WITH GRANT
OPTION`. The activation preflight now rejects that drift, and the global grant
audit applies the same no-delegation rule to every `grainline_*` function.

The disposable PostgreSQL activation proof must demonstrate runtime denial of
direct SELECT, INSERT, UPDATE and DELETE; successful behavior of every fixed
function; immutable event type; stale-generation rejection; concurrent
begin/complete/fail and prune/claim lock behavior; rollback restoration of the
predecessor; and zero fixture residue. Production postflights are read-only and
must never simulate the runtime role through the owner connection.

## Current verdict

The six-function, policyless-table design is appropriate and proportionate.
The launch-proof direct read was a real compatibility blocker, not a reason to
add broader authority; the rollback-only fixed-lease conversion closes it.
The proof now also fails closed on database target and engine role identity and
has actual disposable-PostgreSQL coverage for the Prisma rollback mechanism.
Exact checkpoint `9d2d9d3a82252b991d5fa3f832bd9f629eb1ade9` passed CI
`31280779769`: the new PostgreSQL 16 step proved missing insert and stale
reclaim rollback through the real Prisma transaction with exact zero residue;
all migration, authority, grant/RLS, TypeScript, lint, 2,827-test, dependency
audit and production-build gates also passed. Vercel deployment
`dpl_2u3r9ip2soVEirdbLgQWbfZH8X41` failed at the intentional Preview runtime
database isolation guard (`DATABASE_URL_SHAPE`) before application build; it is
not contrary application-build evidence and nothing deployed.
PR #163 remains audit and proof work only; it contains no activation migration.
Production now runs the exact compatible application at deployment
`dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3`. The classic signed webhook and exact retry,
runtime fixed-function health, rollback-only retention, and both rollback-only
and route-level legacy claim replays passed with zero Listing mutation. The
current-hour ops-health request respected its predecessor cron lock and its
stored result reported zero aggregate Stripe webhook issues, but the expanded
split counts required the next UTC-hour run. That successor invocation passed
HTTP 200 with `skipped=false`, all four Stripe counts at zero and a healthy
SavedSearch canary; sanitized evidence is retained at
`archive/stripe-webhook-ops-health-compatible-production-20260809.json`.
Vercel's Sensitive-value readback mask prevented a synthetic valid Connect v2
signature; that route remains an explicit evidence gate rather than a claimed
pass. At that checkpoint the predecessor drain and final postflight still
preceded activation; both are now accepted in the dedicated evidence section
above. The earlier read-only provider proof retained at
`archive/stripe-webhook-subscriptions-compatible-production-20260808.json`
failed the exact-subscription contract: classic was missing 11 handled
events and has four unused events, while v2 has three unused
`v2.core.account_person.*` events. Provider configuration was not changed. The
old expected classic event set mixed platform-account and connected-account
sources and therefore cannot be applied safely as written. The replacement
three-surface contract and release order are retained in
`docs/stripe-webhook-provider-topology-audit.md`.

That test-mode topology has since been corrected and re-proved. Exact proof
release `b9444e3488db9276c0d9f895043fe1fc32c850d1`, CI `31366490630`,
preparation release `0b718171e71700990bf8f9106ee880b116707bd3` / CI
`31357207924` and compatible deployment
`dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` produced one processed generation-1
`payout.failed` lease under pooled runtime authority; the exact retry left the
lease unchanged. The disposable account and raw recovery records were deleted.
Sanitized signed evidence is retained at
`archive/stripe-connect-signed-payout-proof-test-20260810-b9444e34.json`, and
the subsequent exact 10/1/12 subscription proof is retained at
`archive/stripe-webhook-subscriptions-test-20260810-b9444e34.json`. The fresh
authenticated aggregate-health result also passed with all Stripe and other
operational issue counts at zero and is retained at
`archive/stripe-webhook-ops-health-connect-acceptance-20260810-b9444e34.json`.
Connect v2 signed delivery remains mandatory before launch, but the reviewed
shared fixed-function call graph means it does not add evidence about the
direct-table authority being removed by this activation. The predecessor drain
and hardened final compatibility postflight have since passed as recorded
above.

The isolated activation candidate now exists with byte-pinned activation and
rollback SQL, conditional role-provisioning convergence, global grant-audit
classification, direct-denial and rollback engine proofs, and guarded CI plus
production-release wiring. Its exact boundary and remaining gates live in
`docs/stripe-webhook-event-activation-release.md`.

This remains a candidate, not an activation claim. The historical activation
checkpoint
`fb0facf146e58123ddd2f4a727fda1b966669d5d` passed exact-head CI run
`31272188477`, including disposable PostgreSQL, the full suite, clean dependency
audits and the production build, and its Extra-High authority review completed.

The proof now also fails closed on database target and engine role identity and
has actual disposable-PostgreSQL coverage for the Prisma rollback mechanism.
Exact audit checkpoint `9d2d9d3a82252b991d5fa3f832bd9f629eb1ade9`
passed CI `31280779769`: the new PostgreSQL 16 step proved missing insert and
stale reclaim rollback through the real Prisma transaction with exact zero
residue; all migration, authority, grant/RLS, TypeScript, lint, 2,827-test,
dependency-audit and production-build gates also passed. Vercel deployment
`dpl_2u3r9ip2soVEirdbLgQWbfZH8X41` failed at the intentional Preview runtime
database isolation guard (`DATABASE_URL_SHAPE`) before application build; it is
not contrary application-build evidence and nothing deployed.

This is not an activation claim. PR #163 exact documentation head
`2c084d470df7805f9c5616044a2c58b7586b2650` passed exact-head CI run
`31281007479`; it remains audit and proof work only and contains no activation
migration. The synchronized PR #164 authority-hardening checkpoint
`7a57316bcd16daeef5ac9d595180284d1953e316` passed exact-head CI run
`31282060518`, including actual disposable direct-runtime-login proof, pinned
six-function source bodies, PUBLIC table/column rollback drift cases, restored
activation audit, TypeScript, lint, 2,846 tests with seven intentional skips,
dependency audits and production build. It remains isolated candidate evidence
only.

That current-main refresh, production Phase-A release, and actual pooled-runtime
postflight are now accepted. Preserve the database-first rollback through the
observation boundary. FORCE remains a separate posture-only release, while
Connect v2 signed delivery and live-mode provider evidence remain launch gates.
