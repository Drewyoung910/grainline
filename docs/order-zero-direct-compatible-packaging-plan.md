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
SHA-256 `1c1ea888e503ba8572c563a16aa18187b70ebb34c016feabec33340a89345467`.
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

## Sequence after compatible preparation

1. Retain and reverify the accepted comprehensive credential-recovery boundary
   sealed at `7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89`; do not reintroduce a
   superseded credential epoch or deployment.
2. Provision and prove the separate staff-read login and two-function ACL.
3. Apply the exact compatible prefix while Order RLS remains off.
4. Run the distinct pooled-runtime compatibility postflight.
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
  keeping its two grants and application deployment correctly ordered;
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
