# Case lifecycle correction — isolated candidate, 2026-09-07

Scope: CASE-04/05, independently traced from the September 7 audit against
`d4d51324025ae05e9e074fa836c6882adb1af4ea` on draft PR #432. No production
inspection, migration, deployment, grant/provider change or broad audit is part
of this pass. The two replacement bodies remain a draft outside migrations.

Exact code acceptance: `1f29f630679d46b2fdc1f33dc6e1a1e3b0914749`, full
CI/build `34190781473`, all 17 native scenarios and rollback checks passed.
Companion account-deletion `34190781539`, staff bootstrap `34190781519` and
paid-repair lock `34190781452` passed at the same head. Final local suite:
4,438 passed, 13 skipped, zero failed; focused 58/58. This supersedes only
pending-CI notes below, not the distinct runtime/authenticated/release gates.

## Reproduction and intended behavior

- CASE-04: the buyer page offers Open Case after confirmed DELIVERED/PICKED_UP,
  but `grainline_case_open` rejects a future estimate even after handoff. The
  pre-fix engine fixture reproduced SQLSTATE 23514 for both handoff states;
  an unreceived future shipment remained correctly rejected. Actual receipt
  satisfies the opening prerequisite; it does not waive the separate closing
  deadline, payment/ownership/refund checks or label-purchase exclusion.
- CASE-05: with a PENDING_CLOSE Case and suspended/deleted counterparty, replies
  are intentionally unavailable and both helper/SQL escalation reject the state.
  Buyer and seller engine fixtures reproduced this. Staff intervention already
  exists; no permanently stuck funds or absence of all support was established.
- The initial 13-test engine run against unchanged bodies had eight failures
  and five passing controls. Six failures directly reproduced the two reported
  paths; the remaining two exercised staff pending-close parity and the refund
  guard hidden behind the old status rejection. This is not evidence of eight
  independent vulnerabilities.

## Narrow policy and implementation

`build-case-lifecycle-correction.mjs` pins the exact historical SHA-256 of each
definition, makes counted replacements and emits before/after catalog, owner,
signature, search-path and ACL attestations. The generated SQL changes only
`grainline_case_open` and `grainline_case_escalate`; no applied migration is edited.
The fixed authority remains the write boundary. Route account/auth/origin/rate
limits and the staff session-bound PIN requirement are untouched.

Completed DELIVERED/PICKED_UP bypasses only the future-estimate opening check.
The existing actual-handoff/fallback-estimate 30-day close calculation stays
unchanged. Pending or unreceived orders retain their other prerequisites and
the existing unavailable-seller/review-needed exceptions. The UI's already
offered early-receipt action is not broadened to unrelated new states/reasons.

For PENDING_CLOSE, an available participant still objects through an ordinary
reply. An unavailable counterparty unlocks immediate escalation instead, without
allowing messages to that account. Staff may send an active pending-close Case
to review through the existing PIN-protected escalation endpoint. A pending-close
escalation clears both resolution marks; historical marks are not consent to
close a newly disputed Case. Existing locks, refund/staff-claim exclusions,
actor authorization and exact actor-bound audit replay remain.

Both buyer/seller pages use the existing availability helper. Escalation is
outside the waiting-for-confirmation branch, so even a party who previously
agreed can request review when the counterparty becomes unavailable. The exact
result validator and both user/staff audit replay readers accept PENDING_CLOSE
as the prior state, but not RESOLVED/CLOSED or foreign-actor receipts.

The status trigger already permits UNDER_REVIEW globally for external dispute
handling. Its partial pending-close clause was not a blocker; no trigger change
is necessary. Escalation does not issue a refund or notify an unavailable party.
Existing notification behavior and the cron implementation are unchanged.

## Objection deadline, compatibility and limits

- The existing seven-day inactivity auto-close policy remains. A successfully
  committed escalation is UNDER_REVIEW and cannot be selected by the unchanged
  pending-close cron, even after the old deadline. Without a committed objection,
  expiry can still resolve the Case. This pass does not promise indefinite holds
  on suspension, change the deadline, or decide the separate policy/legal wording
  findings. Those retain their launch-gate disposition in the audit triage.
- Escalation and cron retain User -> Order -> Case locking and final state checks.
  This package's engine scenarios prove ordered outcomes/cron exclusion, not new
  simultaneous-session schedules. The release needs the existing native lock
  suites plus an authenticated objection/cron acceptance scenario. Failures must
  not be relabeled as successful objections.
- Update the application's result reader before exposing the new SQL result to
  old readers; old validators reject PENDING_CLOSE after mutation. Deploying only
  the UI would still encounter the old SQL rejection. Package this as a compatible
  application/functions release, prove old/new overlap explicitly, and do not
  claim either finding live-fixed from this draft. Signatures/grants/RLS are not
  changed. No production release workflow is wired here.
- Role-switched calls in a disposable owner transaction prove SQL role behavior,
  not an actual production runtime login. Native full-schema, real runtime-login,
  authenticated browser/route and release acceptance remain distinct gates.

## Validation record and continuation

The small PostgreSQL-engine fixture executes the complete actual function
bodies and the unchanged real cron candidate selection. It is not the complete
Prisma schema; no stubbed notification function is used to claim cron delivery.
Tests cover early delivery/pickup, exact replay/drift, future/absent/expired
estimates, refund/actor/label guards, both unavailable counterparties, consent
withdrawal, staff review, ordinary discussion timers and post-objection cron
exclusion. Tests render the actual action-panel JSX from both pages and exercise
the real result validator.

`case-lifecycle-correction-postgres-proof.mjs` adds a rollback-only proof to
ordinary CI after the complete Order prefix. It accepts only loopback
`ci`/`grainline_ci`, verifies PostgreSQL 16 and engine identity, compares the full
catalog before/after the exact two-body change, runs the same scenarios against
the complete schema, rolls back all fixtures/DDL, and reruns the unchanged
complete-prefix verifier. Unknown targets, catalog drift or rollback failure
fail closed. Its local contract tests do not substitute for the native CI run.

Final recovered-checkout validation passed: 58 focused tests; 4,438 full-suite
passes, 13 skips, zero failures (4,451 total); full lint; TypeScript; syntax and
diff checks. The full suite used the unchanged test inventory with two workers
and completed in 327 seconds. Prisma generation had to be rerun after restoring
the checkout; preliminary missing-client errors are not application failures.
Exact-head native CI/build remains the next gate. The prior stock checkpoint
`d4d51324` is accepted by full CI/build `34186946233` and native concurrency proof.

At midnight September 8, the first full test/lint pass was invalidated by missing
baseline files and the `.git` pointer in `/private/tmp`; TypeScript also encountered
missing files. There was 6.6 GiB free, and no deletion was performed by this pass.
All 22 changed files were retained and SHA-256-verified in a persistent backup,
then restored onto the exact Git base in the persistent worktree recorded by
`order-rls-restart-checkpoint-20260907.md`. The failure cause is not established.
Full checks must rerun from that complete checkout; no assertions were relaxed.

Those recovered-checkout reruns subsequently passed as recorded above. A separate
solo bypass/regression review traced both pages, the helper/result validator,
route PIN/account/rate-limit checks, both historical function bodies, exact replay,
resolution marks and the cron's post-lock status recheck. No additional confirmed
bypass was found in this bounded change. Small-engine tests reject predecessor
source drift and PUBLIC execute drift before any draft replacement. Existing
native concurrency suites and fresh authenticated release tests remain required;
no owner-role test is represented as an actual runtime-login proof.

Tally: two confirmed lifecycle defects implemented as unreleased candidates;
zero false-positive closures; no new legal/financial incident claim. Continue
through `order-rls-completion-plan-20260907.md`; other financial/provider, legal,
scale and credential-recovery obligations remain linked, not waived.

### First native run and fixture-fidelity correction

Checkpoint `2f34459c688c40988e0d53604977fcad43a6db14` is pushed. CI
`34189974861` failed in the new proof at `scenario-9 [23514]`, after the preceding
historical/prefix proofs. Companion account-deletion `34189974842`, staff bootstrap
`34189974845` and paid-repair lock `34189974872` passed.

The small fixture lacked the real Case row checks. Adding the exact five checks
from the immutable invariant migration reproduced `Case_clock_order_check` locally
at the same scenario. Its pending-case helper mixed a fresh `clock_timestamp()`
opening with the earlier transaction `now()` for discussion, then tried to age
activity/unlock timestamps before creation. Those are invalid test states, not
evidence that the application correction should bypass a constraint.

The corrected pending-close fixture seeds an already-aged Case with a real opening
message and internally ordered timestamps, matching the existing native proof's
historical-fixture method. Opening-specific scenarios still exercise the actual
opening authority. The local harness now executes the exact five Case checks,
so the bad fixture cannot pass locally again. All 58 focused tests pass after
this correction. Application code, the generated two-body SQL draft, historical
bytes, grants and constraints are unchanged. Full final-revision validation and
corrected native CI remain required; the first failed run is not accepted.
