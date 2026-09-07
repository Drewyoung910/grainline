# Order zero-direct compatible packaging plan

Status: isolated compatible-prefix candidate. All sixteen byte-pinned migration
members are staged locally and none has been applied, no application candidate
has been deployed, and `Order` RLS plus predecessor runtime CRUD remain
unchanged.

Prepared: 2026-09-05 from isolated branch
`agent/order-staff-read-app-20260905` after zero-direct checkpoint `9ebd9293`.

## Decision

The current application candidate has zero direct `Order`, `OrderItem` and
`OrderShippingRateQuote` access under `src`. That is a conversion milestone,
not permission to activate RLS. The application now depends on fixed functions
and source columns that production does not yet contain, so the next release is
database-first compatible preparation.

Package the compatible database work as one exact byte-pinned migration prefix
and one guarded production workflow, not as sixteen independently approved
production deployments. Every member is additive and preserves predecessor
Order CRUD for old/new coexistence. The runner must still verify each member's
individual bytes, ordering, function identity and ACL; a partial run may resume
only from an exact applied prefix.

The dedicated staff-read login and secret remain a separate provider and
credential boundary. The migration prefix may install the dormant corrected
staff projections, but it must not grant them to an unproved login or install a
credential.

## Exact compatible prefix

The exact sixteen-member candidate is staged on the isolated branch. The first
two members were already migrations:

1. `20260905010000_correct_order_staff_read_charged_total`;
2. `20260905020000_prepare_order_account_deletion_authority`.

The remaining fourteen audited SQL sources are staged byte-identically as
immutable migration candidates in this dependency order:

3. `order-provider-claim-exclusion.sql`;
4. `order-refund-claim-clock-authority.sql`;
5. `order-seller-refund-preflight-authority.sql`;
6. `order-legacy-refund-lock-authority.sql`;
7. `order-legacy-stock-restore-fence.sql`;
8. `order-refund-reconciliation-commit-proof.sql`;
9. `order-staff-mutation-authority.sql`;
10. `order-ban-review-authority.sql`;
11. `order-checkout-source-snapshot.sql`;
12. `order-seller-deauthorization-authority.sql`;
13. `order-paid-checkout-authority.sql`;
14. `order-checkout-existing-authority.sql`;
15. `order-checkout-postpayment-authority.sql`;
16. `order-checkout-refund-review-authority.sql`.

Source snapshot precedes paid creation because the latter derives all protected
Order/OrderItem facts from the retained reservation witness. The three smaller
checkout operations follow creation and remain separate functions because
idempotency classification, post-payment delivery, and blocked-refund review
have different exposure and mutation boundaries.

## Required fail-closed scope

Before any runner can apply the prefix, it must prove:

- the exact predecessor migration ledger and byte hashes;
- `Order` remains owner-held with RLS and FORCE off, zero policies, PUBLIC CRUD
  absent, and predecessor ordinary-runtime CRUD still present;
- the already-live FORCE posture and direct-table denial remain unchanged for
  `CheckoutStockReservation`, `StripeWebhookEvent`, `OrderPaymentEvent`,
  `OrderRefundReconciliation`, Case and Notification;
- the only new table is the policyless FORCE
  `SellerDeauthorizationApplication` ledger with zero PUBLIC/runtime table
  authority and immutable-update/delete enforcement;
- every new runtime function is SECURITY DEFINER, has fixed
  `search_path=pg_catalog`, is owned outside restricted roles, exposes only its
  reviewed signature and grants EXECUTE only to its intended role;
- staff v2 projections remain dormant until the separately proved
  `grainline_staff_read_runtime` login is provisioned; and
- missing, unknown, duplicate, rolled-back, incomplete or checksum-drifted
  migration rows fail before mutation.

Disposable PostgreSQL must apply the whole prefix against the real predecessor
schema, execute every family proof, rerun the direct-access and grant audits,
and roll back or destroy the database without residue. The production workflow
must run migration status, the global grant/RLS audit and an exact read-only
post-application scope proof. A distinct actual pooled-runtime postflight is
still required.

The isolated CI candidate now removes all fourteen suffix migrations before
any predecessor deployment, restores them only after the two leading members,
and applies the complete prefix to the disposable PostgreSQL 16 service. Its
engine-read-only proof pins all sixteen migration-ledger rows and checks the
retained Order posture, private SellerDeauthorizationApplication posture,
function identities/ACLs, constraints and immutable trigger. This is CI proof
only; it is not production evidence or an actual pooled-runtime postflight.

Draft PR #429 publishes this complete candidate. During local engine validation
of its catalog reader, PostgreSQL rejected the reserved `constraint` alias
(`42601`); the reader now uses `catalog_constraint`. The same reader is covered
by disposable PGlite tests that reject misplaced constraints, disabled or
substituted triggers, unexpected function overloads, public/grantable/private
execution drift, and changed table RLS/grants. These local engine tests passed;
the PostgreSQL 16 CI run remains a separate acceptance gate.

CI run `33974736590` failed before the new prefix was applied: the expanded
legacy overlap inspection referenced `labelClaimStatus` at a historical schema
stage before label authority introduced it. The inspection now runs after the
compatible Order schema is applied. Its strict aggregate query is unchanged;
an ordering test pins its schema dependency.

The undeployed seller-deauthorization candidate was corrected after an engine
test proved that a timestamp with a NULL event ID passed its CHECK through SQL
three-valued logic. The event-present branch now explicitly requires a non-NULL
event ID. The draft and staged migration remain byte-identical with reviewed
SHA-256 `2c710864b4a2249a4bd3d1c40d66bdb26f7a7807576e2341fe5261117b68d7af`.
The regression rejects both partial witness directions; no applied migration
was rewritten.

The compatible schema now records the reservation `sourceSnapshot`, both Order
deauthorization witness fields, and the private immutable
`SellerDeauthorizationApplication` model. The coverage ledger therefore tracks
66 Prisma models. Historical CI omits the new model from grant inventory only
while its exact table-creating migration is physically isolated.

CI run `33975850753` then applied the complete prefix and failed closed in the
global grant audit. Four functions were intentionally absent from ordinary
runtime authority, but the audit had not classified the two private
trigger/helper functions or the two separately credentialed staff-read
projections as runtime-private. The inventory now makes all four exclusions
explicit and tests them. This correction grants no new authority; it prevents
the audit from requesting ordinary-runtime access that the design forbids.

The corrected grant audit and the complete PostgreSQL prefix proof passed in
CI run `33976265570`. That run then failed closed in the historical
18-migration Order scope proof because the reader rejected the exact later
Case correction and zero-direct prefix as unknown rows. The historical verdict
remains 18 migrations and is not weakened: its reader now accepts only the
fixed-checksum, contiguous reviewed successor prefix and rejects an unknown,
missing, duplicate, rolled-back, gapped or checksum-drifted successor.

CI run `33976821521` proved that corrected historical Order scope, then failed
closed in the downstream Case-correctness PostgreSQL reader because that reader
still classified the same exact reviewed successor rows as unknown. The Case
reader now delegates ledger validation to the unchanged strict Order verifier
and merely includes the fixed reviewed successor names in its query partition.
It still rejects every unreviewed row and every non-contiguous, duplicate,
rolled-back or checksum-drifted successor.

## Accepted candidate and staff-login CI

The complete candidate at `2958fbb1fd0b2d3bcc70f6ba57d7a3e9358653d6`
passed CI `33977320851`. Draft PR #430 includes that unmerged #429 candidate
plus isolated staff-role preparation at exact code head
`4e3a9ffcdb265e7c41701e53a346dbe04e104d15`. CI `34009391239` passed all
checks, including the PostgreSQL 16 separate-login/grant-convergence proof,
4,217 full-suite passes (seven skips, zero failures), and production build.
See `docs/order-staff-read-authority.md` for proof boundaries. Production role
provisioning, compatible-prefix execution and deployment remain separate pending
gates; accepted CI is not evidence that any of them has happened.

## Sequence after compatible preparation

### Checkout retry clock correction (2026-09-06)

Review of the exact #429 candidate `2958fbb1fd0b2d3bcc70f6ba57d7a3e9358653d6`
reproduced a correctness defect in `grainline_stripe_checkout_order_existing`:
`sellerRefundLockedAt` is a UTC-stored timestamp without time zone, but the
classifier compared it with `CURRENT_TIMESTAMP`. With identical UTC facts,
a 16-minute-old lock returned `processing` in America/Chicago, and a fresh
five-minute lock returned `retry` in Asia/Tokyo. UTC controls returned the
intended `retry` and `processing` respectively. This is a candidate defect,
not evidence of a production incident or a duplicate refund: downstream
legacy lock release rechecks staleness with a UTC-normalized clock under its
own fencing.

The isolated correction normalizes `clock_timestamp()` to UTC, matching that
release convention. It changes neither the 15-minute threshold nor generation,
source-object, refund-claim, or processed-lease checks. The undeployed draft and
staged migration stay identical, and only their compatible-prefix byte pin is
refreshed. No applied historical migration or historical verifier is changed.
The PostgreSQL regression exercises both fresh and stale locks under UTC,
America/Chicago, and Asia/Tokyo through the restricted runtime role; existing
forged-generation and processed-lease controls remain mandatory.

Validation: the first focused run had 56 passes and one fixture failure:
older fixture writes implicitly converted local `CURRENT_TIMESTAMP` into the
UTC-stored lock column. Those three lock fixtures now explicitly store UTC;
their expected outcomes were not relaxed. The final focused run passed all
61 checks with no skips. The full local suite passed 4,273 checks with 12
environment-gated PostgreSQL/service checks skipped and zero failures. These
local PGlite engine checks do not replace the separate PostgreSQL server/login
proofs in exact-head CI. Draft/migration byte equality and syntax checks passed.

The wider #429 review is still incomplete. The formal scan inventory helper
requires `git cat-file -Z`, unsupported by local Apple Git 2.39.5. Ordinary Git
can read the exact commits; this is a tooling limitation, not lost source.
Partial manual review and this correction do not certify the full candidate.
Complete the exact-range review before accepting the production release.

### Paid completion/repair lock-order correction (2026-09-07)

The larger candidate review subsequently reproduced **ORD-A16** in the
undeployed paid-checkout member. The paid writer held the reservation row
before its nested completion function requested the Session advisory lock,
while repair finalization used Session -> reservation. A deterministic
three-connection PostgreSQL 16.14 run with the exact real function bodies
returned repair SQLSTATE `40P01` before the correction.

Independent CI run `34088368605` then failed closed before schema setup when
the PostgreSQL service reported its private Docker bridge address rather than
the client-side loopback address. The corrected identity attestation permits
that private server address only under GitHub Actions while preserving the
exact numeric-loopback URL, database, role and PostgreSQL-major requirements.

The member now acquires Session after verifying and locking the signed event,
but before locking the reservation. This preserves the event-authority gate and
aligns every involved transition on event -> Session -> reservation. The
post-fix local server proof passes both forced schedules, final state and exact
replay. `docs/order-core-pre-rls-audit.md` records the threat boundary, complete
acceptance rubric and outcomes. The independent
`Order Paid Repair Lock Proof` PostgreSQL 16 CI job must pass at the exact head;
local evidence alone does not admit the compatible release.

Only the unapplied candidate member and its exact byte pin change. Historical
migrations and production remain untouched. The finding does not collapse any
of the ordered release gates below.

### Signed Stripe event-window alignment (2026-09-07)

The wider candidate review found one repeated route/database contract defect in
the undeployed seller-deauthorization and paid-checkout members. The signed
webhook route accepts Stripe events up to 30 days old with ten minutes of
positive clock skew, but both fixed writers still enforced an independent
8-day/5-minute window. An otherwise valid manual resend could pass signature,
age and durable-event reservation, then fail permanently at the state-change
boundary.

Both members now preserve the shared route window without relaxing active
event-generation, source-object, processing-lease or business-state checks.
The platform checkout writer preserves a two-minute database allowance around
its 60-second route ceiling; the separately signed Accounts-v2 closure writer
preserves a one-minute allowance around its 30-second route ceiling. Static
tests pin the shared constants and the applicable route ceiling to each SQL
predicate, and restricted-runtime engine tests prove accepted and rejected
boundary witnesses without
crossing UTC timestamp-without-time-zone values through the host timezone. The
two draft/migration pairs remain byte-identical and their prefix hashes are
updated. See **ORD-A22** in `docs/order-core-pre-rls-audit.md`. This is an
undeployed compatible-candidate correction, not a production migration or an
activation.

### Accounts-v2 terminal closure delivery (2026-09-07)

The same wider review found that the original seller-deauthorization
conversion hardened a provider path that Grainline could not actually receive.
The classic platform route was not subscribed to
`account.application.deauthorized`; Stripe defines that OAuth event's
`data.object` as the application while the connected account is top-level
`event.account`; and Grainline's current sellers are Accounts-v2 Express
accounts. Treating `data.object.id` as an `acct_...` identity would therefore
fail the fixed writer even if that event reached the route.

The candidate now retires the dead classic branch and binds the existing
restart-safe database operation to `v2.core.account.closed` on the separately
signed Accounts-v2 route. That event is already in the exact provider
subscription, and its signed `related_object` is the seller account ID already
used for lease reservation. The closure path runs before provider-account
retrieval so a terminally closed account cannot make cleanup depend on a
retrieval that may no longer succeed. Nonterminal Accounts-v2 updates retain
their existing `charges_enabled` mirror. Static tests prove route and provider
topology; restricted-runtime engine proof accepts only the terminal v2 event
and rejects the retired OAuth type. See **ORD-A23** in
`docs/order-core-pre-rls-audit.md`.

### Ordered release gates

The **ORD-A24** correction adds a server-written destination-account witness to
both checkout Session metadata payloads and uses a strict closure-only sweep.
Replacement accounts are excluded; expired sessions are revisited for stock
retry; unresolved provider/stock failures keep the signed lease retryable.
Unbound payable predecessor sessions remain untouched until their native expiry
or completion. Include these cases in the fresh route smoke and retain the
documented two-hour scan/repair-worker boundary. No SQL byte pins change for
this application-only correction.

The paid-checkout candidate also corrects the previously existing reserved-stock
completion defect recorded under **ORD-A15** and the paid/repair lock inversion
recorded under **ORD-A16**, while the paid and deauthorization writers share the
signed-event window corrected under **ORD-A22** in
`docs/order-core-pre-rls-audit.md`.
An exact, still-valid reservation may complete after another payment changes its
zero-stock IN_STOCK listing from ACTIVE to SOLD_OUT. This does not reopen new
checkout admission or relax hidden/rejected/private-recipient/seller checks.
The draft, staged paid-checkout SQL and its byte pin must remain identical.

1. Retain and reverify the accepted comprehensive credential-recovery boundary
   sealed at `7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89`; do not reintroduce a
   superseded credential epoch or deployment.
2. Provision and prove the separate authority-free staff-read login and isolate
   its credential. Do not grant the v2 functions before they exist.
3. Apply the exact compatible prefix while Order RLS remains off, then converge
   only the six separately reviewed staff-operation grants: two fixed reads,
   three fixed, audited mutations and one short-lived capability mint.
4. Run the distinct ordinary pooled-runtime compatibility postflight and the
   dedicated staff-login authority proof.
5. Deploy the zero-direct application, run the fresh complete authenticated
   Order smoke, then drain every deployment that can still use direct Order
   CRUD.
6. Prove zero direct database authority from deployed and operator trees.
7. Activate Order policyless ENABLE plus direct-grant revocation.
8. Run the actual pooled-runtime activation proof, then package FORCE as a
   separate posture-only release.
9. Audit and activate `OrderItem`, then `OrderShippingRateQuote`, separately.

No step in this plan authorizes a production workflow, deployment, provider or
credential change, table-grant revocation, Order RLS activation, or FORCE.

## Pre-launch acceleration decision

Grainline currently has no active human users, so the remaining Order rollout
must not inherit long production observation windows by habit. The safety floor
does not change: audit the product and authority model once, prove the exact SQL
in disposable PostgreSQL, preserve webhook/cron compatibility, deploy and smoke
the zero-direct application, and retain an exact rollback boundary. The faster
execution is:

- apply the complete additive compatible prefix as one reviewed batch;
- provision the staff-read credential in the same compatibility phase, while
  keeping its six exact operation grants and application deployment correctly
  ordered;
- remove exact predecessor deployments immediately after the fresh smoke rather
  than waiting through a traffic-drain window with no users;
- dispatch the already separate ENABLE and FORCE migrations in one controlled
  release session, with the engine-read-only activation postflight between
  them; and
- run immutable historical proofs independently from the active Order proof so
  CI can execute them in parallel instead of replaying one 400-step serial job
  for every small correction.

Stripe, Shippo, webhook and cron traffic still exists without human users.
Therefore pre-launch does not justify database-first activation, skipping the
compatible application, weakening replay/concurrency proofs, or combining
`Order`, `OrderItem` and `OrderShippingRateQuote` into one activation.
