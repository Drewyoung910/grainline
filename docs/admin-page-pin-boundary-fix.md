# Staff page PIN boundary — pending fix

Finding: `csf_990e02d7d42b736724a1b2be`, from the bounded September 7 security
report. Parent rechecked the shared helper, Order list/detail/flagged consumers,
all helper call sites, middleware GET exception, layout and PIN form/verifier.
Under Drew's no-agent instruction the compatibility investigation was done solo.

The actual helper returns a staff actor with no PIN. A new isolated TypeScript
source harness reproduced this (two failed tests, two legitimate controls passed),
without an application server, provider call or production database. Preserved RED
test: `docs/security-drafts/admin-page-pin-boundary.test.mjs`. Restore it to `tests/`
when implementing; its imports intentionally assume that final test location.
This is a helper/direct-page test, not an executed browser/RSC request.

The proposed narrow shared enforcement adds PIN verification to the page helper,
retaining current-role, suspended/deleted account and session identity checks.
A missing/invalid PIN should return the existing challenge at the page before any
sensitive query, rather than redirecting through the admin landing page (which
redirects to flagged Orders and could disrupt PIN entry). Valid staff must reach
the same authorities and ADMIN-only pages must stay ADMIN-only. Preserve the
original requested URL and the existing PIN form's reload/lockout behavior.

Eight current callers must handle that challenge result. Six concrete role-only
sibling pages (audit, users, reviews, review queue, reports, support) need the same
boundary; audit/users retain their stricter ADMIN role. Do not say all admin pages
are protected while leaving those copies dependent on layout alone. APIs/actions
already have explicit/middleware PIN guards; do not weaken or replace those.

Implementation paused before source edits because the earlier native Order input
proof CI failed. Fix that gate first. Then restore the RED test, implement the
shared helper and caller checks, run the separate bypass/compatibility review,
syntax/type checks, negative/positive tests and full checks. Browser/build
verification and final CI remain required before reporting complete remediation.
The finding stays open; no application fix, deployment or canonical scan closure
has been performed.
