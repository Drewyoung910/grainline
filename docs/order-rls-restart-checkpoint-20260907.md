# Order RLS restart checkpoint — 2026-09-07

Active worktree: `/private/tmp/grainline-clerk-legal-provenance-20260903`.
Branch: `agent/order-checkout-retry-clock-20260906`, draft PR #432.
Leave the old, dirty `/Users/drewyoung/grainline` worktree untouched.

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

The next bounded input correction is the tested Order label-outcome draft in
`docs/order-label-outcome-correction.md`. It remains outside migrations and
production workflows. Receipt and refund-reconciliation NULL hardening and
the separate reservation repair release remain unresolved.
