# Case and Order correctness corrections — 2026-09-01

Status: isolated implementation; not merged, migrated or deployed.

## Why this precedes the next Order RLS activation

RLS should protect an authority model that is already correct. The Order and
shipping audit found a small set of existing Case/Order defects whose effects
cross the same payment, fulfillment and retention boundaries that the next RLS
group will protect. These corrections therefore come before Order Phase A; the
lower-value hardening ideas remain explicitly deferred so they do not turn into
an unbounded prerequisite program.

The candidate migration is additive. It does not edit sealed historical
migrations, enable or FORCE RLS, add policies, change table grants, or change
provider state. It replaces existing functions only after byte-derived
function-body preflight checks and reconverges their current activation-aware
EXECUTE partition. In particular, it must not revive the retired
`grainline_case_seller_refund_apply` entry point after `OrderPaymentEvent`
Phase A replaced that predecessor authority.

## Corrected in the candidate

1. The accepted Case-message invariant rejects null `authorKind` and the live
   column is `NOT NULL`, so Claude's claim was not a current production P1.
   As restore/drift defense, an impossible legacy row with a null kind and an
   author who is neither Case participant now projects as `STAFF`, rather than
   the UI fallback `Participant`.
2. Six Case money-path functions derive timestamp-without-time-zone values by
   explicitly converting `clock_timestamp()` to UTC. Session timezone can no
   longer shift dispute, seller-refund, staff-prepare, provider-record,
   finalization or reconciliation evidence.
3. A replayed staff refund claim in `PROVIDER_PENDING` revalidates its exact
   lease, Stripe payment identity, label posture, derived open-dispute state,
   and absence of another effective refund before the application may call the
   provider again. Other claim states receive state-specific evidence checks.
4. Staff finalization re-reads `fulfillmentStatus` under the Order lock and
   refuses a nonempty stock-restoration plan after shipment, delivery or
   pickup.
5. Buyer-PII retention refuses Orders whose trigger-maintained
   `paymentOpenDisputeBlocked` projection is true. `FOR UPDATE SKIP LOCKED`
   already serializes the canonical Case/dispute writers; the missing durable
   dispute predicate—not the previously alleged wait-snapshot race—was the
   actual defect.
6. Account deletion locks every Order involving the target buyer or durable
   `Order.sellerProfileId` in canonical id order before its final active-Case
   check. It does not re-derive historical authority through mutable Listings.
   This closes the seller-side race without introducing the User/Order
   inversion that the Case-open function deliberately avoids.

## Separately corrected in the shipping candidate

Draft PR #382 (`agent/order-label-product-authority-audit-20260901`) contains
the buyer quote corrections and the complete claim-by-claim audit record:

- city, state and country are required for a shippable quote;
- malformed or duplicate provider rate identities are rejected;
- provider rate identities are never invented in the browser;
- pickup remains available during carrier fallback but is not selected over a
  valid shipping service;
- a failed quote can be retried without reloading checkout;
- estimated delivery bounds share one contract with webhook validation.

## Confirmed but deliberately sequenced next

- Add an immutable `chargedTotalCents` witness and migrate the staff/seller
  refund authorities to it before Order RLS.
- Present refund/payment state independently from fulfillment state so a full
  refund does not continue to read as `Preparing` or `Pending`. Do not invent a
  `CANCELLED` fulfillment state: an already delivered order remains delivered
  even when refunded.
- Finish label/fulfillment compatibility proofs, then activate Order Phase A
  and FORCE separately. Continue with `OrderItem`, followed by
  `OrderShippingRateQuote`.

## Not prerequisites for this sequence

- Dedicated service roles for cron-only Case transitions and fixed seller
  aggregate readers are defense-in-depth follow-ups, not evidence of a current
  caller-controlled target.
- `checkoutGroupId`, friendly support order numbers, historical tax-reversal
  column retirement and a continuous all-table RLS canary remain documented
  launch/operations work.
- SellerProfile broad-select regression coverage remains a gate for the later
  SellerProfile RLS group, not for Order activation.

## Known limits and where they are gated

- The shipping candidate proves source behavior and browser state handling,
  but not live Shippo availability, address normalization accepted by the
  account, or the exact production credential topology. A real test-mode quote
  smoke with one valid shipping address and one pickup fallback remains a
  launch-evidence gate; it is not a reason to postpone the Case corrections or
  actor-bound Order conversion.
- The Case correction has local deterministic and PGlite coverage. Its
  authority, lock-wait and current FORCE-posture claims still require the real
  PostgreSQL 16 CI proofs before merge. PGlite is not concurrency evidence.
- The shipping UI cannot guarantee that a carrier returns a rate for every
  valid address. A provider no-rate/error state must remain explicit and
  retryable; the application must never invent a rate identity to conceal it.
- Continuous production RLS canaries for every accepted live table are launch
  operations hardening. They do not replace table-specific activation and
  pooled-runtime postflights, and their absence does not reopen already
  accepted RLS posture.

## Required evidence before merge or production use

- deterministic builder/output equality and static fail-closed tests;
- real PostgreSQL 16 migration application after every sealed predecessor;
- runtime proof for legacy staff projection, staff replay refusal, fulfillment
  stock-restoration refusal, PII dispute retention and seller-deletion locking;
- full TypeScript, lint, repository tests and build;
- an exact migration byte pin plus separate production migration gate.

GitHub CI run `33556027456` failed closed when the first candidate re-granted
the retired seller-refund Case function. No migration or production change
occurred. The corrected builder now encodes runtime EXECUTE as part of both the
predecessor and postflight catalog, keeps that one function runtime-ungranted,
and has a class-specific regression test against future revival.

Replacement CI run `33559078992` then failed before exercising the Case source
trigger because this older Case proof still generated pre-ledger dispute rows:
it used the obsolete `dp_` object prefix and omitted the now-required signed
`stripeEventCreatedSeconds` witness. PostgreSQL correctly rejected that fixture
under the promoted immutable `OrderPaymentEvent` source-shape constraint. This
was proof drift, not evidence that the Case relationship trigger accepted a
forged charge. The proof fixtures now use ledger-valid `du_` dispute identities,
matching signed event-time fields and valid local refund evidence, so the
negative Case test reaches the intended boundary: a structurally valid dispute
event whose `chargeId` does not match the locked Order must be rejected by
`grainline_case_relationship_valid`. Production remained unchanged.

The next CI run, `33563825398`, proved a second historical-boundary issue: the
same rollback-only Case harness runs before the signed-event identity migration
and again after the complete current migration chain. The first invocation
correctly has no `OrderPaymentEvent.stripeEventCreatedSeconds` column, while the
second must satisfy that column and the promoted source-shape constraint. The
proof now reads the local disposable database catalog and inserts the same
canonical dispute evidence through one of two explicit schemas. It never
weakens or removes the current signed-event witness; it merely keeps the
predecessor invocation valid enough to reach the Case invariant being tested.
Static coverage requires both catalog branches and all seven dispute fixtures
to use the shared helper. No production state changed in either failed run.

CI run `33564458000` confirmed the dual-schema selection advanced past the
missing-column failure, then PostgreSQL rejected the helper because its dispute
identifier parameter was inferred as both `varchar(255)` by the table column
and `text` by a JSON metadata cast. The helper now gives every shared parameter
one explicit type matching the real table schema in both branches, including
`varchar(255)` for the dispute identifier everywhere. A focused regression test
rejects a future mixed cast. This remains proof-only correction work; the
candidate migration and production were unchanged.

CI run `33564722371` passed the repaired proof in the predecessor phase and the
entire historical migration/authority matrix, then failed after applying this
candidate because the proof still assumed ordinary runtime could directly call
`grainline_case_seller_refund_apply`. That entry point is intentionally retired
from runtime after `OrderPaymentEvent` activation; the reviewed public refund
operation invokes it only as an internal database-owned helper. The proof now
reads the actual function grant, proves direct runtime denial in the retired
posture and retains the predecessor runtime path when that historical grant is
present. The shared rejection helper now includes the sanitized PostgreSQL
message in assertion failures so a label cannot hide the next root cause.

CI run `33565418901` then showed that resetting the simulated runtime role does
not itself grant the CI migration session execution authority over the retired
private helper. That was a proof-harness error, not an application or migration
failure. The rollback-only proof now temporarily grants the runtime role
EXECUTE only after proving the real retired denial, exercises the helper's
forged-actor, valid, replay and forged-source paths under its real
`SECURITY DEFINER` body, and revokes that temporary grant before the catalog
assertions. The surrounding transaction is always rolled back, so neither the
temporary proof grant nor any fixture can persist. Production remained
unchanged throughout.

CI run `33566222495` advanced through that retired-helper body proof, then
PostgreSQL refused the next rollback-only `ALTER TABLE "Order" ... DISABLE
TRIGGER` because the preceding fixtures had left deferred foreign-key or
invariant events pending on `Order`. The harness now makes those deferred
checks immediate, then restores deferred mode, before toggling the trigger that
models a later signed dispute. This strengthens the proof: queued constraints
must pass before the later-state simulation can begin. It does not change the
candidate migration, runtime grants or production state.

CI run `33566765556` passed the corrected seller-refund and staff-finalization
sequence, then reached the harness's historical Case Phase-A replay while the
disposable database was already at the current FORCE posture. The old harness
assumed it was always running before activation. It now classifies the exact
three-table posture and, only inside the outer rollback transaction, uses the
reviewed FORCE rollback and Phase-A rollback releases to normalize FORCE or
ENABLE back to the pre-activation state before replaying Phase A. The original
pre-activation invocation remains unchanged, while mixed or unknown posture
still fails closed. The entire normalization is rolled back and cannot affect
production.

CI run `33567378660` reached the normalized historical Case activation
preflight and reported 26 of the 27 original runtime function grants. The
single absent grant was the same seller-refund helper that `OrderPaymentEvent`
Phase A intentionally retired after Case activation. A current-era replay now
restores only that exact historical EXECUTE grant after table-posture
normalization, runs the original Case Phase-A and FORCE proofs, then revokes it
again after the activation rollback. The historical pre-activation invocation
does not use this compatibility branch. Production grants remain unchanged.
