# Order RLS restart checkpoint — 2026-09-07

Active worktree: `/private/tmp/grainline-clerk-legal-provenance-20260903`.
Branch: `agent/order-checkout-retry-clock-20260906`, draft PR #432.
Leave the old, dirty `/Users/drewyoung/grainline` worktree untouched.

## Current checkpoint — read this first

The staff PIN candidate is saved/pushed at `1dc274a5b3990536e0c38aa9998733676d5cc2d3`.
Full CI `34179627726`, account-deletion `34179627723`, staff-bootstrap
`34179627749` and paid-repair `34179627806` passed. Browser/release acceptance is
still separate; it is not deployed.

The active isolated follow-up is `order-label-clawback-replay-correction.md`:
one canonical bounded Stripe replay/acknowledgement boundary in all three callers,
plus a one-body UTC purchase-clock draft, engine tests and native CI-only rollback
proof. It is not a production migration or provider operator execution. Do not
restart the broader audit or begin stock edits until this candidate's checks pass.
Final local checks passed: 4,393 tests, 13 skipped, zero failures, plus lint,
TypeScript and diff checks. Native exact-head CI remains the next acceptance
gate; verify its result on draft PR #432 before broadening this candidate.

### Earlier input-proof and staff implementation state

The corrected input-runtime proof passed complete CI, including native PostgreSQL
and the production build, in
`34178233977` at pushed checkpoint `4574786557c5ac196267b1bbb5ba82e3a6aede76`.
The active local follow-up implements the staff-page PIN boundary, documented in
`admin-page-pin-boundary-fix.md`; its 34 focused tests pass, as do the full local
suite (4,373 passing, 13 skipped, zero failed), lint and TypeScript. The preserved RED
draft is now the executable regression at `tests/admin-page-pin-boundary.test.mjs`.
Finish exact-head CI/build and authenticated checks for this application change before release;
no merge, deployment or production state change has occurred.

## Earlier checkpoints and preserved failed evidence

The statuses below are historical, superseded by the current checkpoint above.
The intentionally RED staff test mentioned below was moved to the executable
test suite with the subsequent implementation; it is no longer a draft file.

Runtime-proof checkpoint `0e737b000bd0b0909bf88d16b3a5a0dd21ecaf02` is pushed
to draft PR #432. Native CI `34177187482` failed after actual runtime login at
the input-boundary matrix; the old proof mistook Notification's RLS-filtered
SELECT for a table-privilege denial. The local correction and real-policy fixture
are recorded in `order-input-correction-runtime-proof.md`. Its corrected local
suite passed 4,369 tests with 13 skips; focused tests, lint and TypeScript passed.
Finish exact-head native CI before broadening implementation. No production change occurred.
The staff PIN reproduction is preserved separately in
`docs/security-drafts/admin-page-pin-boundary.test.mjs`; it is intentionally RED,
not part of the passing test suite or a claim that the security issue is fixed.

Solo implementation resumed after the bounded audit. Preserve its findings via
`order-audit-resume-triage-20260907.md`, linked from the completion plan, strategy
and deferred backlog. The pending input runtime proof is the current cohesive
work package; no new domain, agent work or production action is authorized by
the resumption. Expanded teardown/target tests pass locally. A new exact-head
native CI result is still required before recording runtime proof acceptance.

Accepted pre-audit code checkpoint: `be0eedf0f0a5ca8eeefd59c66d3d78023664d0f6`.
Main CI `34166065857` has passed its historical runtime-login proof, complete
Order successor-prefix proof and the new five-function draft-composition/
rollback proof in PostgreSQL 16. The full CI workflow completed successfully,
including tests and production build. All three companion concurrency/bootstrap
runs passed (exact IDs below). This is the current accepted code-CI checkpoint.

Local full suite, lint and TypeScript passed for the correction batch. The
one-line identity-reader follow-up passed its nine focused checks. The real
PostgreSQL run now confirms that follow-up and the new composition harness.
No applied migrations, production workflows, provider state or credentials
were changed. No new Order RLS posture is claimed.

Next: package the bounded input corrections with
their distinct actual-runtime and release proofs. The separate reservation
repair draft still needs its own full-schema/release gate. Do not begin a new
RLS domain or reinterpret owner-transaction composition as real-runtime proof.
Continue through `order-rls-completion-plan-20260907.md`; credential-recovery
acceptance and existing exact production boundaries remain mandatory.

Current isolated follow-up: `order-input-correction-runtime-proof.md` records
the new native-login proof. It clones only the disposable CI database, commits
drafts only in that copy, checks the actual runtime login/input boundaries,
then removes its copy and restores the CI role password to NULL. Local tests
pass; exact-head native CI acceptance is still pending. No production release
packaging or migration dispatch has happened during this proof preparation.

This is a preservation checkpoint, not a release acceptance. The prior pushed
commit is `691b91915226a973024c2634e17aa5426f02e780`. Its main CI run
`34161435943` failed at **Prove Order compatible postflight through the runtime
login**: the expected source for
`grainline_order_review_eligibility_lock(text,text,bigint)` does not match the
composed candidate. Account-deletion concurrency, paid-repair locking and
staff-bootstrap proof runs passed in the preceding pass. Full CI is not green.

Resume by tracing the postflight's effective function catalog through the
byte-pinned Order composition successor. Fix the exact expected-source
selection and add regression coverage; do not loosen historical pins or accept
arbitrary function bodies. Rerun focused checks and CI before broadening scope.

The reservation repair NULL-outcome correction is saved separately as a tested
draft, builder, regression test and runbook in
`docs/checkout-reservation-repair-outcome-correction.md`. It is not a staged
migration or production workflow. Preserve it while repairing Order CI.

Order still needs compatibility acceptance, deployment and fresh authenticated
checkout/shipping proof, predecessor drain, then separate ENABLE and FORCE
acceptance. Remaining audit findings and release gates live in
`docs/order-core-pre-rls-audit.md`, `docs/rls-coverage-matrix.md` and
`docs/deferred-launch-backlog.md`.

No merge, deployment, production SQL, provider mutation, credential change or
cleanup is part of this app-restart checkpoint. Do not read or print private
credential files or restart journals when resuming.

Restart follow-up: the ordered exit gates and current CI failure disposition
are now recorded in `docs/order-rls-completion-plan-20260907.md`. The source
mismatch was traced to a historical postflight running after successor
application; preserve its strict reader and correct the CI stage order.

The sequencing correction is pushed at `af88c01d0388d16487853976d68e21c324d0ad17`.
CI `34163378239` completed successfully, including the historical runtime
postflight, complete successor-prefix PostgreSQL proof, full tests and build.
All three separate concurrency/staff-bootstrap jobs passed. This accepts that
exact candidate CI checkpoint, not the newer label draft or production release.

The bounded input corrections include the tested Order label-outcome draft in
`docs/order-label-outcome-correction.md`. It remains outside migrations and
production workflows. It is pushed at `0fbe37fdf90c9fe2275c3d607c6fda7722089dd0`;
its full CI run `34164274285` passed tests and production build. The next
cohesive draft adds explicit receipt type and refund
reconciliation input rejection in `docs/order-reconciliation-input-corrections.md`.
Historical constraints/source filters already contain some of these inputs;
the runbook distinguishes those from the mutating ambiguous-reason defect.
The new refund/receipt focused suites passed 26/26 and the full local suite
and lint passed. A later rollback-only full-schema composition harness is wired
in ordinary disposable CI after complete-prefix application; its focused
tests cover rejected targets, exact-body comparison and success/failure
rollback. Exact-head CI acceptance of that harness and actual runtime proof
for the correction drafts remain open, as does the separate reservation
repair release. No production workflow is wired or dispatched by this pass.

The correction bundle is saved/pushed at `e060c84797b7711c26d8b5cd5fc9aae5559f57eb`.
Its CI `34165481370` stopped at the new disposable proof's identity check,
before draft application: the reader supplied inet text with a `/32` mask to
the strict plain-IP guard. The bounded follow-up uses PostgreSQL `host()` and
proves the representation difference without changing the allowlist. Preserve
the failed evidence; do not report full-schema acceptance until corrected CI
passes.

Corrected checkpoint `be0eedf0f0a5ca8eeefd59c66d3d78023664d0f6` is pushed.
CI `34166065857` passed the historical runtime-login postflight, complete
successor prefix and the new PostgreSQL 16 draft-composition/rollback proof.
Companion account-deletion concurrency `34166065873`, paid-repair locking
`34166065871` and staff-bootstrap `34166065850` runs passed. The full CI
workflow subsequently passed tests and build at this same revision. None of
these results closes the actual runtime-login proof for the corrected drafts,
the independent reservation repair release or production activation.
