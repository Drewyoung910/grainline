# Order release readiness — September 8, 2026

This is a bounded release review of the saved candidate, not a new repository
audit or a statement that production was inspected. Verified candidate base:
`58e8a2adc6fcaf6151aa7ff0eccf77c7f3948bee`, draft PR #432. Keep source in
`/Users/drewyoung/grainline/.worktrees/order-case-lifecycle-20260908`; preserve
the root's local audit packets. Worktree reconciliation is separate.

## What is accepted versus outstanding

| Package | Accepted code evidence | Still required before release acceptance |
| --- | --- | --- |
| Five Order input corrections | Native actual-runtime proof and full CI `34178233977` at `45747865` | Final compatible SQL packaging and actual production scope/runtime proof; missing-source controls are not successful provider flows |
| Staff-page session-bound PIN | Full CI `34179627726` at `1dc274a5` | Authenticated missing/invalid/valid PIN checks on the matching deployed app; separate staff database credential boundary remains a release dependency |
| FIN-01/JOB-01 label reversal | Full CI/native clock proof `34183133619` at `00c570b8` | Apply the clock-return successor before expecting automated batch retries; final runtime and provider ambiguity/replay acceptance; no inference outside the 23-hour window |
| LISTING-F02/F03 stock consistency | Full CI/native lock schedules `34186946233` at `d4d51324` | Matching app/versioned-route deployment, authenticated retry/stock acceptance and receipt-retention limits |
| CASE-04/05 lifecycle | Full CI `34190781473` at `1f29f630`, 17 native scenarios; account-deletion `34190781539`, staff `34190781519`, paid-repair `34190781452` | Compatible result readers before new SQL results; actual-runtime/authenticated objection and overlap acceptance; separate deadline/legal alignment is not silently changed |
| CheckoutStockReservation NULL-outcome repair | Full CI `34198555971` at `58e8a2ad`, full-schema clone and actual-login proof, 20 invalid/12 legitimate outcomes, all companion proofs | Independently packaged integrity successor and final runtime/production acceptance; do not replay its old RLS activation |
| Combined six-draft/nine-function candidate | Proof-only fixed manifest and local composition/scenario/rollback coverage in `order-correction-composition-proof.md` | Exact-head full/native CI, then actual production packaging and composed runtime acceptance; this is not activation |

These are isolated candidates, not newly deployed fixes. Source references:
`order-input-correction-runtime-proof.md`, `admin-page-pin-boundary-fix.md`,
`order-label-clawback-replay-correction.md`,
`listing-stock-consistency-correction.md`, `case-lifecycle-correction.md`,
`checkout-reservation-repair-outcome-correction.md`.

## Next sequence, with explicit exit conditions

1. **Accepted at `58e8a2ad` / CI `34198555971`:** independent reservation repair proof: exact full-schema clone,
   true runtime login, old NULL reproduction/new rejection, all legitimate
   outcomes, paid-order protection, unchanged parent/authority and owned cleanup.
   Keep its failed evidence; do not repeat this accepted checkpoint as pending.
2. Review the complete final candidate and assemble a single compatibility
   manifest of source, draft/migration hashes, order, grants and rollback/restart
   states. Tests of each draft separately do not attest their final simultaneous
   catalog. Use a successor-specific composition proof; never loosen sealed
   historical verifiers to accept arbitrary bodies. The reservation integrity
   correction retains its separate release boundary even if proofs share CI.
   The active proof-only composition is `order-correction-composition-proof.md`;
   it does not stage production migrations or replace the actual-runtime gate.
3. Resolve the umbrella credential-recovery acceptance from sanitized evidence.
   `comprehensive-credential-exposure-recovery-20260902.md` remains the incident
   gate; individual accepted families are not blanket incident closure. This
   pass reads no credential values and does not attest current provider state.
4. Accept the compatible database/application release and actual runtime/staff
   login boundaries. Observe the Case reader-first and label-clock DB-first
   dependencies. Keep automated RLS activation out of application builds.
5. Complete fresh authenticated buyer/seller/staff, checkout and shipping-rate,
   label/fulfillment/refund/retry proof and exact fixture cleanup. Prior Shippo
   credential/quote recovery evidence does not substitute for the final deployed
   Order source or certify current rates/provider operation.
6. Finish explicitly reviewed predecessor overlap/drain, then Order ENABLE and
   its exact grants/runtime postflight, then separate FORCE and owner/runtime
   postflights. Only after acceptance start OrderItem and OrderShippingRateQuote.

No merge, production workflow dispatch, database mutation, deployment, credential
change or provider action is authorized by this document. The current user
continuation authorizes isolated implementation/verification only. Do not equate
prelaunch/no human traffic with no cron, webhook or predecessor writes.

## Avoiding another loop

Keep one current checkpoint in `order-rls-restart-checkpoint-20260907.md` and
post-push CI evidence on the draft PR. Update source evidence in the next cohesive
commit instead of creating a docs-only CI chain after every successful run.
Keep failures and their actual causes: a permissive fixture or catalog reader
error is not itself a production defect. Re-open a code finding only on new
source-backed/reproduced evidence. Keep actual runtime/provider proof distinct
from owner role-switching, and legal/scale launch gates distinct from RLS posture.

No throughput percentage or 50,000-user certification is inferred from tests.
The measured workload, provider timeouts and bounded-worker continuation gates
remain in `deferred-launch-backlog.md` and the original audit packets.
