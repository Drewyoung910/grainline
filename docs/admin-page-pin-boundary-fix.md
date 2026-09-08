# Staff page PIN boundary — isolated implementation

Finding: `csf_990e02d7d42b736724a1b2be`, from the bounded September 7 security
report. Parent rechecked the shared helper, Order list/detail/flagged consumers,
all helper call sites, middleware GET exception, layout and PIN form/verifier.
Under Drew's no-agent instruction the compatibility investigation was done solo.

The historical helper returned a staff actor with no PIN. A new isolated TypeScript
source harness reproduced this (two failed tests, two legitimate controls passed),
without an application server, provider call or production database. The RED
reproduction was preserved in the prior checkpoint, then restored to
`tests/admin-page-pin-boundary.test.mjs` with the implementation. It now passes.
This is a helper/direct-page test, not an executed browser/RSC request.

The narrow shared enforcement adds PIN verification to the page helper,
retaining current-role, suspended/deleted account and session identity checks.
A missing/invalid PIN returns the existing challenge at the page before any
sensitive query, rather than redirecting through the admin landing page (which
redirects to flagged Orders and could disrupt PIN entry). Valid staff must reach
the same authorities and ADMIN-only pages must stay ADMIN-only. Preserve the
original requested URL and the existing PIN form's reload/lockout behavior.

Eight existing callers handle that challenge result. Six concrete role-only
sibling pages (audit, users, reviews, review queue, reports, support) now use the same
boundary; audit/users retain their stricter ADMIN role. All fourteen data pages
are inventoried by a regression so a new page needs explicit classification. APIs/actions
already have explicit/middleware PIN guards; do not weaken or replace those.

Implementation paused before source edits while the earlier native Order input
proof CI was corrected. The corrected input-runtime step passed in native CI
`34178233977` at `4574786557c5ac196267b1bbb5ba82e3a6aede76`; implementation
then resumed. This is not acceptance of a subsequent application revision.

## Separate bypass and compatibility review

The parent rechecked every helper caller and the six former role-only copies as
a separate review pass. Neither missing/expired/forged PIN nor a PIN issued to a
different Clerk user/session reaches the sensitive page queries. Possession of a
valid cookie does not replace current role, banned/deleted status or authentication.
The role-only root page only redirects to the independently guarded flagged page;
layout counts remain behind their own PIN check. No new unlock route, cookie
format, session lifetime, provider setting, SQL grant or mutation authority is added.

The direct-page harness executes all fourteen default page functions without a
layout and expects only the existing PIN component. Unmodeled dependency use
throws, so an attempted data call does not silently pass. Verified staff still
call Order list/detail/flagged authorities with the same local actor, scope and
dedicated client; controlled missing-order results retain notFound behavior.
The existing PIN component is unchanged: a successful verification reloads the
same URL, retaining its server lockout/error behavior. Reusing previously authorized
client content is not claimed to be erased retroactively when a cookie expires.

## Verification and release boundary

- Historical reproduction: two failures (missing PIN accepted and missing page
  challenge), two passing authentication/legitimate-access controls.
- Syntax/import and type: focused harness transpiles/executes the real helper and
  pages; TypeScript is run against the entire candidate.
- Security trigger and alternate inputs: the four new tests exercise missing,
  malformed, legacy, expired, cross-user and cross-session cookies; absent sessions;
  nonstaff, suspended/deleted accounts and ADMIN-only role restrictions.
- Legitimate behavior and neighboring tests: the focused page/PIN/action/Order/Case
  suites passed 34/34, including unchanged API/action PIN controls.
- The full local suite passed 4,373 tests with 13 skips and zero failures
  (4,386 total). Lint, whole-candidate TypeScript and whitespace checks passed.
- Exact-head CI/build and authenticated browser verification remain release
  evidence gates until their results are recorded. No production
  deployment or canonical finding closure has occurred. The broader audit is not
  closed by this one fix.

Source changes: `src/lib/adminPageAccess.ts`, all fourteen data pages under
`src/app/admin`. Middleware is byte-identical to the accepted predecessor.
Regression changes:
`tests/admin-page-pin-boundary.test.mjs` and `tests/admin-action-guardrails.test.mjs`.
The latter now checks the centralized account/role guard and all page consumers,
rather than requiring six copies of identical inline role SQL.

The first full run rejected an explanatory-only middleware comment edit because
historical production artifact verifiers seal that file. The comment was restored
without changing any historical pin or verifier. The full rerun passed as recorded
above; no failed evidence was treated as acceptance.

Exact candidate `1dc274a5b3990536e0c38aa9998733676d5cc2d3` passed full CI/build
`34179627726`; companion account-deletion `34179627723`, staff-bootstrap
`34179627749` and paid-repair `34179627806` also passed. The authenticated browser
and production release gates remain open. No canonical scan finding was closed.
