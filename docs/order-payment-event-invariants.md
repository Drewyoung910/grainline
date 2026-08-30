# OrderPaymentEvent compatible invariant release

Status: production compatibility accepted. Guarded run `33296358390`, bound to
exact main `513053dc6f2f6fb527f85e45fe3a18a8317fa701`, main CI
`33295803412` and aggregate inspection `33296114340`, applied only this
migration and passed migration status, the global grant/RLS audit and the exact
post-application scope proof. `OrderPaymentEvent` RLS remains off, predecessor
runtime CRUD remains intact, and this is not deployment or activation evidence.

Candidate migration:
`20260829010000_prepare_order_payment_event_invariants`

SHA-256:
`e5da430056c32d2a4d754f08e5ea3fa79dfb0ab401f71375d73ae6d14e39943c`

Reviewed predecessor:
`20260828020000_correct_order_payment_signed_dispute_identity`, SHA-256
`7bd8c9be14e8095f0d4952401a2331abde3149e87a4bce8a9e44235ae2ec2bcd`.

## Why this release exists

`OrderPaymentEvent` is retained financial evidence, not mutable application
state. Its current application and fixed database writers already intend an
append-only two-family ledger, but the predecessor database still permits a
malformed or later-mutated row. RLS cannot repair that integrity gap: RLS
decides who may reach an operation, while constraints and triggers decide what
the operation is allowed to mean.

This compatible release establishes the ledger semantics before direct table
authority is removed. It deliberately leaves RLS off and preserves predecessor
runtime table CRUD so the current and previous application deployments remain
compatible during the database-first window. The later predecessor drain and
policyless RLS activation are separate releases.

## Fresh production evidence

Protected inspection run `33296114340`, bound to exact main
`513053dc6f2f6fb527f85e45fe3a18a8317fa701`, ran in an engine-attested
repeatable-read, read-only transaction. Sanitized artifact SHA-256
`cf41611f392668a778a73f0dfce4038f1f431813c8cf1467360c45d78a794866`
reported zero `OrderPaymentEvent` rows and zero payment-specific defects. The
same snapshot retained the already-classified privacy-redacted historical
label-reference count and released synthetic webhook lease; neither is an
`OrderPaymentEvent` defect or permission to weaken this release.

The same investigation separated one released synthetic
`charge.dispute.funds_withdrawn` proof lease from genuinely active-stale work.
That test-only StripeWebhookEvent residue is an operations-health item, not an
`OrderPaymentEvent` row and not permission to weaken the signed Order-source
check. Its eventual finalization remains a separately bounded mutation.

## Database contract

The migration atomically adds and validates six constraints in addition to the
existing signed-provider-time check:

1. event taxonomy is exactly `REFUND | DISPUTE`;
2. amount is null or nonnegative;
3. currency is lowercase ISO-shaped three-letter text;
4. source IDs, types and optional text are trimmed and bounded, while metadata
   is a non-null JSON object;
5. signed and local source families have canonical identities and metadata;
   local refunds also bind the action-specific reason and exact refund ID; and
6. `updatedAt` equals `createdAt`.

Three trigger functions complete the invariant:

- `grainline_order_payment_event_validate_insert()` locks the parent `Order`
  and rejects a payment currency that differs from the Order currency;
- `grainline_order_payment_event_immutable()` rejects every update and delete;
  and
- `grainline_order_currency_payment_immutable()` rejects changing an Order's
  currency after retained payment evidence exists.

All three functions pin `search_path=pg_catalog`, are `VOLATILE` and parallel
unsafe, and have EXECUTE revoked from PUBLIC and
`grainline_app_runtime`. The two source-reading functions are
`SECURITY DEFINER`; the raise-only immutable trigger is not. Trigger execution
does not require a caller EXECUTE grant.

## Concurrency and lock order

Every payment insert takes the parent Order row lock. An Order currency change
takes the same row lock before checking payment evidence. The required lock
order is therefore Order before payment evidence, matching the current fixed
refund and signed-webhook functions.

The parent-currency trigger must be `VOLATILE`. A `STABLE` trigger lookup could
reuse the UPDATE statement's pre-wait snapshot and miss payment evidence that
committed while the UPDATE waited on the Order lock. The isolated hard review
caught and corrected that declaration before byte pinning. The real PostgreSQL
proof holds the insert lock, observes the competing currency UPDATE waiting,
commits the insert, and requires the awakened UPDATE to fail with SQLSTATE
`23514`.

## Compatibility and retention consequences

- The current source-bound seller, staff Case, blocked-checkout, signed refund
  and signed dispute writers produce rows accepted by these constraints.
- No function signature, table privilege, policy, RLS bit or provider state is
  changed.
- `OrderPaymentEvent` already has a restrictive parent foreign key. After this
  migration, even the owner cannot casually delete evidence through an Order
  cascade; retention or legal deletion requires a separately reviewed bounded
  operation.
- Historical proof operators that delete temporary payment rows cannot be run
  after this release without a new rollback-only or explicitly retained-ledger
  design. Prior successful proof evidence remains valid; old cleanup scripts do
  not justify weakening append-only production semantics.
- The Prisma `@updatedAt` annotation remains schema metadata, but no update is
  permitted after insert. New writers must set one immutable creation time for
  both timestamps.

## Proof and release gates

The isolated package includes:

- a five-case disposable PGlite suite for valid families, malformed/null
  bypasses, currency agreement, append-only behavior and atomic validation;
- a loopback-only real PostgreSQL owner/runtime proof that creates and destroys
  one random schema, verifies ACL/catalog posture, and proves the lock race;
- an exact byte and predecessor verifier;
- an engine-read-only restart scope verifier accepting only exact predecessor
  or exact applied catalog state; and
- a dedicated exact-main/CI/inspection-bound production workflow.

CI isolates this newest migration until the signed-refund and signed-dispute
predecessors have applied, then restores it, deploys the local CI migration,
runs the global grant audit and executes the real-login race proof. The generic
Production Migrations runner also isolates it so an unrelated dispatch cannot
apply it accidentally.

Before production application:

1. full exact-main CI, including the real PostgreSQL race, must pass;
2. a fresh aggregate-only production inspection must pass from the same exact
   main commit;
3. the migration and scope verifier receive an Extra-High authority review;
4. the dedicated migration workflow may apply only this migration; and
5. the final read-only scope and global grant/RLS audit must pass.

Participant/staff/export/aggregate projections, predecessor drain, policyless
ENABLE, pooled-runtime isolation proof and separate FORCE remain later named
gates. This invariant preparation must not be described as RLS being live.

## CI grant-inventory correction (2026-08-29)

Initial branch CI run `33291321871` reached the post-migration global grant
audit and failed closed because the three new trigger helpers were absent from
the audit's runtime-private function inventory. PostgreSQL had the intended
least-privilege state: PUBLIC and `grainline_app_runtime` EXECUTE were revoked.
The audit incorrectly treated the newly discovered functions as application
RPCs and reported those missing grants as defects.

The correction imports the byte-pinned invariant function catalog into the
global runtime-private inventory. A direct regression assertion requires every
cataloged helper to remain in that inventory, while the existing provisioning
and live-audit checks continue to require its EXECUTE revokes. The migration
bytes and SQL behavior are unchanged. After the correction, the focused suite
passed 28 tests with one environment-specific PostgreSQL-service skip, and the
full local suite passed 3,523 tests with seven environment-specific skips and
zero failures. The real PostgreSQL grant audit remains a fresh CI gate on the
corrected commit.
