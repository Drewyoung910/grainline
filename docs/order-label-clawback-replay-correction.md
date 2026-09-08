# Label-cost reversal replay — isolated correction

Scope: FIN-01 and the directly coupled JOB-01 worker budget, revalidated against
`1dc274a5b3990536e0c38aa9998733676d5cc2d3`. Solo implementation; no agent,
production/provider execution, migration staging, deployment or credential access.
The current candidate is not a deployed fix or accepted provider proof.

## Reproduction and invariant

The initial label route and ambiguous-label operator sent metadata reason
`label_cost_deduction`; the worker used `label_cost_deduction_retry` under the
same key. The worker/route/operator also caught local acknowledgement failures
as provider failures, even when Stripe had returned a reversal. The actual worker
test reproduced both errors: two failures, with legitimate helper controls passing.

Exactly one intended deduction may be created per label transaction and amount.
Initial, recovery and worker requests must have identical parameters/key. Known
provider success must never be downgraded because its local write failed. Ambiguous
money movement needs retained state, not another guessed payment effect.

Stripe documents parameter comparison and possible key pruning after 24 hours:
[idempotent requests](https://docs.stripe.com/api/idempotent_requests).
The existing SQL retry schedule exceeds that retention floor. This is a source-
and contract-confirmed risk, not proof of an actual production duplicate debit.

## Selected implementation and compatibility

`labelClawbackProvider.ts` owns the canonical request and settlement boundary,
used by the purchase route, retry worker and ambiguous-label operator. It keeps
the existing original metadata and idempotency key; no new key is minted to work
around a conflict. Exact replay is permitted only within 23 hours of the immutable
label purchase time (the existing refund recovery margin), never the retry clock.
Stripe's retained idempotent response recovers an earlier successful request.
Returned identity, transfer, amount, currency and metadata are validated before
success is recorded. A failure of that success write propagates without writing
FAILED; stale-claim recovery retries the same key within the window.

Missing, malformed, future or expired purchase time issues no Stripe POST. The
existing fenced FAILED/backoff path retains the review hold and eventually enters
MANUAL_REVIEW; it does not invent an immediate manual transition or new SQL outcome.
Orders whose historical cached request used the incompatible retry metadata may
still need manual reconciliation. Never vary parameters/keys until one works.

The separate review rejected metadata-search recovery: historical reversal metadata
binds Order/amount, not the exact label. A voided/expired label can be replaced on
the same Order. Even matching money and a nearby timestamp do not prove identity.
The implementation deliberately uses no list-based inference and refuses automatic
replay beyond retention. Future late-recovery automation needs an immutable
versioned provider intent and exact label identity, designed as its own release.

The worker claims one row near execution, admits new claims only with 10 seconds
remaining in its 45-second work budget, and disables implicit SDK network retries
with a five-second per-request timeout. Current generation fencing, status counters,
due scheduling and staff review remain. This removes preclaiming ten rows behind a
slow request. It is not a load test or proof that arbitrary database stalls finish
inside the host deadline; an interrupted single claim still uses existing recovery.

## Additive database draft, not an applied migration

`docs/rls-drafts/order-label-clawback-clock.sql` changes only the fixed claim
function's returned JSON: immutable `labelPurchasedAt`, explicitly interpreted as
UTC. Historical migration bytes, signatures, locks, counters, ACLs, policies and
table posture remain unchanged. Its generator pins the complete predecessor
definition and the draft attests owner, source and ACL before/after replacement.
Both source/ACL drift fail closed. Timestamp-free predecessor batch responses are
accepted as recovery-unproven, never treated as fresh. **Package/apply this reviewed
clock successor before deploying the app if automatic batch retries are expected.**

The native CI-only proof reuses the existing complete-catalog rollback harness,
accepts only the loopback `ci`/`grainline_ci` PostgreSQL 16 target, proves the full
unchanged Order prefix before/after, and permits exactly one changed body before
rollback. It is separate from the accepted five-function input bundle; no historical
proof is broadened. Production workflow wiring is absent.

## Validation and remaining release gates

- The original two worker failures pass after the correction. Tests cover response
  loss, local-write loss, exact payload replay, expired-provider retention, invalid
  clocks/results, replacement labels and bounded worker admission.
- Local PostgreSQL-engine fixtures exercise the real draft in both historical and
  NULL-guard-corrected label catalogs, two non-UTC session zones, source/ACL drift,
  unchanged fencing and exact catalog restoration after rollback. PGlite role
  simulation is not represented as an actual production runtime login.
- Final `npm test` passed: 4,406 tests, 4,393 passing, 13 skipped, zero failures.
  `npm run lint`, `npx --no-install tsc --noEmit --incremental false` and
  `git diff --check` passed. The local disk guard passed with 5.5 GiB free.
  Native PostgreSQL CI and release evidence remain outstanding. No real Stripe
  request, payment, refund, reversal, operator or production database migration
  was executed by this implementation pass.
- The first full run found three static contracts still requiring batch preclaiming
  or an inline idempotency helper. They were updated to the single-row claim and
  shared settlement boundary while retaining their currency, hold, locking and
  observability assertions. The complete final source/test edit set passed the
  full rerun and lint/TypeScript checks above. Documentation-only result recording
  followed that run; it does not replace native CI or provider acceptance.
- Remaining release gates: native full-schema proof, exact compatible packaging,
  actual-runtime claim/clock evidence, fresh authenticated/provider smoke (including
  response/local-finalization loss), and any required production authorization.
  FIN-01 remains open until those gates pass. JOB-01 source budgeting is addressed;
  operational throughput/backlog and host-timeout behavior remain unmeasured.

The audit remains a bounded report, not a whole-codebase or legal certification.
Stock-update and other affected Order blockers stay in the resume triage.
