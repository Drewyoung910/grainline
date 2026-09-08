# Order RLS completion plan — 2026-09-07

## Scope and current decision

Finish the current Order candidate, not another RLS domain. The isolated
candidate has a zero-direct-access inventory, but Order production ENABLE and
FORCE acceptance remain outstanding. A saved checkpoint is not release proof.
The current decision is **no-go for activation** until the gates below pass.

The broad audit is finished as a bounded review and Drew has resumed solo
implementation. Its financial/security blockers, product decisions and evidence
locations are linked in `order-audit-resume-triage-20260907.md`. The input runtime
proof is now accepted in CI; close affected-domain blockers next. Do not
equate resuming work with accepting the audit or authorizing production changes.

## Ordered exit gates

1. **Restore reliable CI.** Prove the historical 18-migration Order catalog
   before source-replacing successors, then apply and prove the complete
   candidate. Keep historical SQL and source pins unchanged. Exit only with
   full exact-head CI and applicable disposable PostgreSQL proofs green.
2. **Close the bounded activation blockers.** Reconcile the independently
   verified findings in `order-core-pre-rls-audit.md`; finish the separate
   reservation NULL-outcome integrity correction and classify the remaining
   input-hardening items. Additive drafts are recorded in
   `checkout-reservation-repair-outcome-correction.md`,
   `order-label-outcome-correction.md` and
   `order-reconciliation-input-corrections.md`; passing their focused tests
   does not finish their full-schema release and runtime gates.
   Keep unrelated product improvements in the linked
   deferred backlog. Do not call a candidate fix live before its release.
3. **Accept the compatible release.** Review the complete final diff, inspect
   the credential-recovery acceptance records first, then production aggregates
   and exact schema/grant state. The umbrella incident runbook still records
   active recovery; do not infer closure from individual recovered families or
   a green CI run. Resolve that release boundary before production mutations.
   Apply only the reviewed
   compatible prefix, and deploy its matching application. Prove the final
   successor catalog through the actual runtime login; the historical runtime
   proof does not attest successor bodies. Establish the separate staff login
   boundary where required. Exit with matching source and database evidence.
4. **Prove product behavior and finish compatibility overlap.** Complete fresh
   authenticated buyer/seller/staff checks, checkout and shipping quotes,
   fulfillment/labels, refunds and provider retry/failure behavior. Specifically
   close the previously failing shipping fixture and timestamp round-trip
   checks. Verify bounded fixture cleanup and drain only reviewed predecessors.
5. **Order ENABLE.** Apply the separate policyless activation and direct-grant
   revocation, then accept the global grant/RLS audit and actual pooled-runtime
   denial/allowed-operation proof. Stop on any unclassified state.
6. **Order FORCE.** Apply only the posture change after ENABLE acceptance; repeat
   the owner and actual runtime proofs. Only then mark Order complete and begin
   the separately audited OrderItem and OrderShippingRateQuote releases.

These are release gates, not authorization to dispatch production actions.
Existing exact-commit production boundaries remain in force.

## Avoiding repeated work and regressions

- No new domain, cosmetic refactor or general repository scan during this
  release. Add a new blocker only with a reproduced safety/correctness failure
  or evidence that an existing exit gate cannot pass.
- For each failure, record the failing run and exact state; reproduce locally
  when practical, add regression coverage, and test the complete affected path
  before spending another CI cycle. Do not interpret a failed verifier as a
  production defect without tracing its expected state.
- Keep historical release checks strict. A successor needs its own composed
  proof or the correct chronological CI stage, not an expanded list of arbitrary
  accepted bodies. Never amend applied migrations to silence a check.
- Batch cohesive edits and run full checks after the final edit. Keep one
  current checkpoint identifying what is saved, tested, pushed and live.
- Defer only with closure criteria in `deferred-launch-backlog.md` or a linked
  runbook. Preserve exact failed evidence and unresolved release gates.
- Keep the old dirty root worktree and reconciliation task separate. Commit
  and push checkpoints so active work is not dependent on temporary storage.

## Historical CI failure disposition and current acceptance

Run `34161435943` at `691b91915226a973024c2634e17aa5426f02e780`
failed at the historical runtime catalog: review eligibility expected source
SHA-256 `609a946ad5b67d76f0ea31688125bf3ee2c84e846af036d85461194be43ef8cf`
but saw the composition successor
`ec90693904c30eb6eba6299593002f19414d8db6a657964e3928917655ac7bd1`.
CI had restored and applied all successors before invoking that historical
postflight. The correction places its application, grants and real runtime
proof before restoration of Case and Order successors. The later complete
prefix application, catalog/constraint checks and functional suites remain.
The historical production reader and all sealed migrations stay unchanged.
This is a CI sequencing correction, not new production acceptance.

Accepted CI checkpoint: `af88c01d0388d16487853976d68e21c324d0ad17`,
run `34163378239`, passed the full workflow including tests and production
build. Separate paid-repair lock `34163378229`, account-deletion concurrency
`34163378213` and staff-bootstrap `34163378216` runs also passed. Gate 1 is
closed for that exact revision. Any further draft/release change still needs
its own applicable checks; this is not acceptance of an untested successor.

Earlier accepted code checkpoint: `be0eedf0f0a5ca8eeefd59c66d3d78023664d0f6`,
full CI `34166065857`. It adds tested receipt/reconciliation input drafts and
a rollback-only PostgreSQL 16 composition proof for those and the label draft.
The five reviewed bodies changed exactly; catalog/ACL/table posture and the
unchanged complete-prefix proof were restored afterward. Full tests and build
passed, as did account-deletion concurrency `34166065873`, paid-repair locking
`34166065871` and staff bootstrap `34166065850`. Failed first attempt
`34165481370` and the narrow identity-reader correction are retained in the
input-correction runbook. Gate 2 still needs release packaging/actual-runtime
evidence and the independently released reservation-repair correction;
code-CI acceptance is not production activation.

The distinct disposable actual-runtime input proof is implemented and tracked
in `order-input-correction-runtime-proof.md`; full native CI/build `34178233977`
passed at `4574786557c5ac196267b1bbb5ba82e3a6aede76`.
Its missing-source controls are intentionally narrower than the fresh
authenticated route/provider smoke required by gate 4.

The fourteen-page staff PIN boundary in `admin-page-pin-boundary-fix.md` passed
full CI/build `34179627726` at `1dc274a5b3990536e0c38aa9998733676d5cc2d3`;
authenticated release verification remains separate. The current financial retry
follow-up is recorded in `order-label-clawback-replay-correction.md`, including
the unapplied clock draft, bounded replay and remaining provider/release gates.
The remaining stock and affected Case blockers retain their triage dispositions.
Do not restart a broad audit or begin another RLS family.

Label replay's exact checkpoint `00c570b826dc421b6a349936ade97623cb5c65fe`
passed full CI `34183133619` and its companion proofs. Stock consistency is now
the cohesive local follow-up in `listing-stock-consistency-correction.md`;
Case lifecycle blockers follow after its exact-head checks. Code candidates
remain distinct from compatible release and authenticated/provider acceptance.

Stock checkpoint `d4d51324` passed full CI/build `34186946233` and native
concurrency schedules. The current CASE-04/05 follow-up is tracked in
`case-lifecycle-correction.md`, including exact draft composition, UI/result
parity, unchanged objection deadlines and its outstanding release evidence.
