# Audit records

## 2026-09-07 — paused implementation, read-only review

- [Runtime, financial and scalability findings](2026-09-07-runtime-review.md).
- [Bounded Codex Security report](2026-09-07-security-artifacts/report.md), with
  canonical findings, coverage and manifest in the same directory.
- [Terms/privacy accuracy, legal decisions and architecture assessment](2026-09-07-legal-architecture-review.md).
- [Shipping checkout, operations monitoring and accessibility follow-up](2026-09-07-shipping-operations-accessibility-review.md).
- [Checkout recovery, discovery, batch delivery and analytics follow-up](2026-09-07-checkout-discovery-batch-review.md).
- [Listing inventory/prices, commissions, seller settings and account follow-up](2026-09-07-listing-inventory-settings-review.md).
- [Seller Orders/exports, Case actions and blog publishing follow-up](2026-09-07-orders-cases-publishing-review.md).

All records identify their actual reviewed candidate. They do not describe the
older root checkout as current main or certify production behavior. Findings are
open unless an explicit remediation/verification record says otherwise.

Drew subsequently resumed normal implementation and requested no agents. The
individual packets retain their historical audit-only scope; no finding became
fixed merely because implementation resumed. The active candidate's
`docs/order-audit-resume-triage-20260907.md` links the evidence and affected Order
release gates. These full records remain local audit artifacts, not committed/
pushed releases. Preserve the Order work, byte-sealed evidence and deferred
worktree cleanup.

Priority on resume: financial/security blockers, stock mutation/retry correctness,
variant prices and stale-address cart checkout;
accurate product/legal contracts; shipping provider reliability; truthful worker
health; accessible core journeys; measured load/recovery readiness. RLS alone
does not close those product/operational obligations. See individual findings
for conditions, counterevidence, proposed regressions and counsel decisions.

The checkout/discovery follow-up adds twelve source-backed product/runtime issues plus
explicit capacity/modeling observations. No proposed fix or regression test was
executed. Its checkout recovery and pre-outbox delivery findings belong in the
same resume work packages as the earlier checkout/worker issues, not in an
unrelated architectural rewrite.

The listing/settings follow-up adds source-backed inventory lost-update/retry,
variant identity, commission lifecycle, seller configuration, feed retry and
preference accessibility findings. It also records further occurrences of the
existing address-race/discovery classes and explicit geographic/capacity decisions.
All remain open. The two P1 inventory findings belong with pre-paid-launch
correctness work; minor presentation findings do not individually block every
unrelated RLS step. Source-only reasoning is not a production incident or load-test
result. See the packet for proposed tests, counterevidence and coverage limits.

The Orders/Cases/publishing wave adds participant-action mismatches, seller note
lost updates/drafts, historical wrapping-charge export omissions, order-history
boundary failure, blog stale-save/truncation and reader-interaction issues. It
explicitly narrows an older blog closure claim: submission-time concurrency
protection is not stale-editor protection. Case staff intervention remains possible;
no permanently stuck funds or actual production incident is asserted. The packet
also records smaller account/form contracts and remaining test/scale requirements.
