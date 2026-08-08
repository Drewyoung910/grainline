# StripeWebhookEvent activation audit

Status: isolated audit and launch-proof conversion only on
`agent/stripe-webhook-activation-audit-20260805`. No activation migration,
merge, deployment, production query, grant change, provider change or RLS
change is authorized by this record.

## Exact reviewed stack

The activation candidate is stacked on three draft-only compatibility heads:

1. PR #160, `agent/order-payment-shipping-compatible-preparation-20260804`,
   exact head `2b624afe219bc982dd0945284895326ee6893a1e`, prepares the compatible
   seller keys, invariants and generation-bound Stripe lease functions.
2. PR #161, `agent/order-payment-shipping-app-conversion-20260805`, exact head
   `566edf0e301a475577d53b84776fe9ee375ed506`, converts the signed Stripe
   route to the generation-bound begin/complete/fail functions.
3. PR #162, `agent/stripe-webhook-maintenance-authority-20260805`, exact head
   `eb2c49d5d8a061ca410cd42e4da06d2a6b4cf806`, converts retention,
   aggregate health and the legacy stock-restore claim to three narrow fixed
   functions. Exact-head CI run `30975525699` passed.

All three PRs remain draft and production retains the inspected predecessor:
`StripeWebhookEvent` RLS/FORCE off, zero policies and broad runtime CRUD. The
stack order is a release dependency, not approval to merge or deploy it.

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
- `scripts/stripe-webhook-event-activation-postgres-proof.mjs` is the
  loopback-only activated-boundary proof. It uses owner catalog reads and
  deliberately attempts direct operations after `SET LOCAL ROLE` to prove
  SQLSTATE `42501`, then rolls back every function fixture.
- `scripts/stripe-webhook-event-activation-rollback-proof.mjs` is the
  loopback-only database-first rollback rehearsal. It temporarily restores
  predecessor CRUD in disposable PostgreSQL, proves old-runtime compatibility,
  and restores activation in a fail-closed cleanup path.
- `scripts/order-payment-shipping-compatible-production-postflight.mjs` is a
  historical compatibility-posture proof that directly reads the table under
  the pooled runtime role while predecessor CRUD remains present. It must run
  before activation and be excluded from post-activation CI/release phases;
  it is not evidence for the activated posture.
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
   staging/local runtime connection; and
5. deliberately throws inside the interactive transaction for every returned
   action so PostgreSQL rolls back any missing-row insert or stale reclaim.

Only `action=processed` passes. `process` or `in_progress` fails the launch
proof, and a type mismatch fails in PostgreSQL. This proves the exact
provider-bound row exists, has the immutable expected type and is terminally
processed without raw table visibility or durable verifier mutation.

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
stable batches and the legacy claim takes the canonical checkout mutation
lock. Disposable PostgreSQL proof must retain stale-worker, block/wait,
concurrent prune/claim and rollback-zero-residue coverage.

## Mixed-deployment and activation sequence

RLS activation cannot precede the compatible application release. Old Vercel
instances and webhook retries still use direct table CRUD. The required order
is:

1. merge and apply only the reviewed compatible preparation migrations from
   PR #160; run their predecessor-compatible owner and pooled-runtime proofs;
2. merge the exact app conversions from PR #161 and PR #162, deploy the exact
   compatible app, and exercise signed webhook, retry, ops-health, retention
   and legacy restore paths while direct table grants still exist;
3. let the prior app deployment drain and verify no production route or job
   still uses direct table access;
4. run the historical compatibility postflight for the final predecessor
   record;
5. apply a separately reviewed, byte-pinned policyless ENABLE migration that
   revokes table/column grants and preserves only the six functions;
6. run actual pooled-runtime direct-denial and all-six-function postflights;
7. deploy no app change merely to activate RLS; rollback database posture
   first if the fixed-operation smoke fails; and
8. only after a stable observation window, prepare a separate posture-only
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
The isolated activation candidate now exists with byte-pinned activation and
rollback SQL, conditional role-provisioning convergence, global grant-audit
classification, direct-denial and rollback engine proofs, and guarded CI plus
production-release wiring. Its exact boundary and remaining gates live in
`docs/stripe-webhook-event-activation-release.md`.

This is not an activation claim. Local static tests pass, but disposable
PostgreSQL, full-suite, dependency and build evidence must come from exact-head
CI before the candidate can receive its separate hard review. Production
remains unchanged.
