# Order dispute-loss recovery design — 2026-09-30

## Boundary

This is a separate post-Order launch correction. Order zero-direct RLS is live
and complete; this work must not repeat its migrations, FORCE operations,
deployment smoke, or alias cutover.

- Public source base: `6ed0476659327961170fc186389a0d055da7f2be`.
- Isolated source worktree:
  `/private/tmp/grainline-order-dispute-loss-recovery-20260930`.
- Branch: `codex/order-dispute-loss-recovery-20260930`.
- Finding: audit item `#108`.
- The first public source candidate was
  `4515da45ef16b9784ede47f4b6cedd21c2f12b57` on deployment-disabled branch
  `codex/order-dispute-loss-recovery-20260930` and draft PR `#487`.
- Three required checks passed on that head. Main CI run `36758747603` failed
  before behavioral tests because the new `20260930040000` migration remained
  visible while CI replayed a historical release verifier whose accepted tree
  must end at `20260830030000_enable_order_payment_event_rls`.
- The focused CI correction is committed locally at
  `724682c63fe29d1abb3ab4c9a136f29ca44c2e84` and backed up privately on
  `recovery/order-dispute-loss-recovery-draft-20260930`. It verifies the new
  package, isolates its migration before historical proofs, restores it only
  after the accepted ops-health successor, re-verifies it, and applies only
  that migration in disposable CI before the production build.
- The public branch and PR still point to `4515da45`; main remains
  `6ed0476659327961170fc186389a0d055da7f2be`. Publishing the amended exact head
  requires a new approval. Nothing in this work has been deployed, applied to
  Production, or used against Stripe.

## Verified current behavior

1. New Stripe Connect accounts set `losses_collector: "application"`.
2. Checkout uses a destination charge with `transfer_data.amount`, so the
   seller share transfers at payment time.
3. Signed dispute webhooks record immutable `OrderPaymentEvent` evidence, set
   Order review state, and open/reopen a Case.
4. No dispute path reverses the seller transfer or records a recovery claim.
5. Stripe can debit Grainline for the dispute while the seller keeps the
   transferred amount.
6. Existing refund and Shippo-label recovery code already demonstrates the
   required generation fencing, provider idempotency, retries, and manual
   reconciliation posture.

Stripe's provider contract permits partial transfer reversals up to the
unreversed transfer amount. A reversal credits the platform and debits the
connected account; it can fail when the connected balance/reserve cannot cover
it. A Dispute amount can be smaller than the original charge.

## Proposed financial behavior

For each Stripe dispute:

1. Treat `needs_response`, `under_review`, `charge.dispute.funds_withdrawn`,
   and `lost` as seller-funds recovery states.
2. Do not reverse for warning-inquiry states such as
   `warning_needs_response`, `warning_under_review`, or `warning_closed` unless
   Stripe separately reports funds withdrawn.
3. Recover `min(dispute amount, Stripe transfer amount still unreversed)`.
   This prevents an over-reversal after a refund or label-cost reversal and
   never claims tax/platform money beyond the seller transfer.
4. Discover an already-created matching reversal from provider metadata before
   POSTing. Use a stable idempotency scope for the POST.
5. If Stripe reports `funds_reinstated` or status `won`, restore exactly the
   amount Grainline previously reversed—never the full order or dispute amount.
6. Discover an existing matching restoration transfer before POSTing and use a
   stable idempotency scope.
7. Retry provider failures with 15-minute, 1-hour, 6-hour, and 24-hour delays;
   after five attempts, stop automation and require staff reconciliation.
8. Treat conflicting amounts, duplicate matching provider objects, more than
   the bounded provider-history window, or a second loss after restoration as
   manual-review conditions.
9. Grainline bears the Stripe dispute fee under this correction. Charging the
   seller a dispute fee or deducting debt from future payouts requires a
   separate explicit policy and ledger; this change does not invent one.

## Draft architecture

- A private `OrderDisputeRecovery` table stores one recovery lifecycle per
  Stripe dispute. It is FORCE RLS with no policies and no direct runtime table
  privileges.
- A fixed event-claim function accepts only an immutable signed dispute payment
  event, preserves provider ordering, and returns an opaque generation-fenced
  claim.
- Provider code retrieves the original transfer, inspects bounded reversal
  history, and creates or rediscovers one exact reversal/restoration.
- A fixed finalizer accepts only the exact claim generation and provider
  evidence.
- A bounded SKIP LOCKED batch retries durable pending work.
- A separate count-only health function reports manual-review and overdue
  recovery work without exposing dispute rows.
- The signed Stripe webhook records the immutable event and claims first work
  in one transaction only for a newly applied event. Provider settlement runs
  after that transaction. Replayed Stripe events cannot reset retry backoff.
- A protected cron route and Vercel schedule are present in the private draft.
  They are inert because no deployed webhook creates recovery claims, no
  migration has been applied, and the draft has not been deployed.
- Runtime provisioning grants only the four exact claim/finalize/health
  functions. Ops health reports manual-review and overdue-retry counts through
  the count-only function.

## Recovery and ordering cases

- Duplicate or stale signed dispute events cannot create a second claim.
- Provider success followed by a lost database acknowledgement is recovered by
  listing exact metadata before reusing the stable idempotency key.
- A refund or label reversal that consumes transfer balance first reduces the
  dispute reversal cap.
- A win received while a reversal is in flight changes the post-finalize state
  to restoration pending.
- A win before any provider reversal closes as no reversal required.
- A repeated loss after a completed restoration stops in manual review because
  the original seller transfer is already reversed and the restoration is a
  distinct transfer.

## Proportional testing policy

This correction should receive:

1. focused provider tests for partial balance, replay discovery, no-op,
   restoration, ambiguous evidence, and provider failure;
2. one focused disposable PostgreSQL proof for generation fencing, event
   ordering, retry claims, finalization, FORCE/no-policy posture, and runtime
   denial;
3. relevant TypeScript/lint/build checks once;
4. one exact-head required PR CI run before merge.

Do not manually rerun the repository's 27–31 minute full suite after it passes.
The automatic merged-main run is readback only.

## Focused source evidence

- Provider, retry, source-contract, CI-ordering, and disposable PostgreSQL
  authority tests: 13/13 passed both with the migration in its repository path
  and with it physically isolated at the CI holding path.
- The PostgreSQL proof caught and corrected an extra table-definition closing
  parenthesis and two enum-valued `CASE` expressions that otherwise resolved
  as `text`.
- Prisma validation, focused ESLint, TypeScript no-emit, Prettier, workflow YAML
  parsing, and diff checks passed.
- No broad repository suite was run during this pass.

## Approval boundary

The user explicitly approved the source-only webhook connection and named the
future automatic seller-transfer reversal/restoration effect. The user then
approved public draft PR `#487` and conditional merge of exact head
`4515da45ef16b9784ede47f4b6cedd21c2f12b57` against unchanged main
`6ed0476659327961170fc186389a0d055da7f2be`. That exact head failed CI for the
historical-tree staging reason above, so it cannot be merged under the stated
condition. Exact authorization is required to publish amended head
`724682c63fe29d1abb3ab4c9a136f29ca44c2e84` to PR `#487` and conditionally
merge it if its required exact-head checks pass against unchanged main. Later
Production approval is required to apply its migration, deploy it, and allow
it to affect live Stripe transfers.

## PR #487 second exact-head correction — 2026-09-30

The user authorized amended head
`724682c63fe29d1abb3ab4c9a136f29ca44c2e84`. It was published to PR `#487`
against unchanged main `6ed0476659327961170fc186389a0d055da7f2be`.
`postgres-lock-order`, `review-note-concurrency`, and `tls-login` passed. The
monolithic CI check failed in 3m28s at the first historical-prefix runtime
grant audit because the branch-tip Prisma schema named
`OrderDisputeRecovery` and `OrderDisputeRecoveryStatus` while their sealed
migration was intentionally isolated from that earlier database prefix.

The focused correction is local commit
`a5fb870ac1a2569d91f7b8b6fea97f6182bd97e9`. It:

- excludes both successor-only objects from the derived grant inventory only
  while their exact create migration is absent;
- classifies the table as a private policyless FORCE ledger once present;
- converges optional type usage, table revocation, dispute RPC execution, and
  the count-only Order ops-health function in runtime-role provisioning;
- reconciles source-derived catalog assertions with already-landed Core Order
  FORCE and email-safe seller projections; and
- adds a regression proof for absent, partial, and fully restored sealed
  migration states.

Focused verification passed: 38 tests plus one environment-skipped live
PostgreSQL fixture across grant inventory and dispute recovery, with zero
failures; diff whitespace validation passed. The exact corrected commit is
backed up privately at
`recovery/order-dispute-loss-recovery-draft-20260930`.

The public PR still points to failed head `724682c63...`; no new public push or
merge is authorized by this record. Publishing corrected head `a5fb870a...`
requires a new exact-head approval. No migration, deployment, or Stripe action
occurred.

## PR #487 third exact-head correction — 2026-09-30

The user authorized exact head
`a5fb870ac1a2569d91f7b8b6fea97f6182bd97e9`. It was published to PR `#487`
against unchanged main `6ed0476659327961170fc186389a0d055da7f2be`.
`postgres-lock-order`, `review-note-concurrency`, and `tls-login` passed. CI run
`36768062542` reached the full test step after passing the corrected historical
catalog phase, then failed after 25m50s with 4,952 passing tests, three failed
assertions, and nine skips.

The three failures were branch-state integration defects:

- grant-inventory totals and the four dispute-recovery functions remained
  unconditional while the exact migration was intentionally held outside the
  historical tree;
- the site-wide RLS matrix still declared 67 models and omitted the new
  private ledger; and
- the schema-drift reader could not inspect the sealed migration from its CI
  holding path. This failure also exposed a real pre-Production mismatch: the
  migration named the parent constraint `OrderDisputeRecovery_order_fkey`,
  while Prisma's relation contract requires
  `OrderDisputeRecovery_orderId_fkey`.

Local correction commit
`921b1d59022d825a6cb991c525608583eb3e3067` fixes all four seams. It keeps the
grant inventory fail-closed while the migration is absent, reads the exact
sealed migration for schema-drift comparison, updates the 68-model RLS ledger,
and corrects the unapplied FK name. Focused verification passed in both source
states: the normal tree produced 41 passes plus one expected live-PostgreSQL
skip, and the exact CI-isolated migration state produced 36 passes plus one
expected live-PostgreSQL skip. No second full suite was run.

The corrected head is backed up privately at
`recovery/order-dispute-loss-recovery-draft-20260930`. Public PR `#487` still
points to `a5fb870a...`, and public main remains `6ed04766...`. Publishing
`921b1d59...` and conditionally merging it requires a new exact-head approval.
No migration, deployment, or live Stripe effect occurred.

## PR #487 fourth exact-head correction — 2026-09-30

The user authorized exact head
`921b1d59022d825a6cb991c525608583eb3e3067`. It was published to PR `#487`
against unchanged main `6ed0476659327961170fc186389a0d055da7f2be`.
`postgres-lock-order`, `review-note-concurrency`, and `tls-login` passed. CI run
`36772445063` passed every historical migration step and reached the full test
suite, then failed after 25m54s with 4,954 passing tests, one failed assertion,
and nine skips. The conditional merge did not run.

The single failure was another historical-tree inventory seam. While CI held
the already-reviewed seller buyer-email projection and Order ops-health
migrations outside the active migration tree, the expected function list still
required `grainline_order_seller_detail_v5`,
`grainline_order_seller_recent_sales_v2`, and
`grainline_order_ops_health_summary`. The source-derived inventory correctly
omitted those later functions.

Local correction commit
`b2a27d38accf1d55a5e68939441f87dee36ce90c` binds those three function names
and their PUBLIC-revoke counts to the presence of their exact migrations. The
final commit is a minimal one-file change with 32 insertions and four deletions;
an accidental whole-file formatter rewrite was detected and removed before any
public push. The grant-inventory suite passed both with the full migration tree
and with the seller projection, predecessor retirement, ops-health, and dispute
recovery migrations isolated: 25 passes plus one expected local PostgreSQL
skip in each state, with zero failures. No second full suite was run.

The corrected head is backed up privately at
`recovery/order-dispute-loss-recovery-draft-20260930`. Public PR `#487` still
points to `921b1d59...`, and no merge, migration, deployment, or live Stripe
effect occurred. Publishing `b2a27d38...` and conditionally merging it requires
a new exact-head approval.

## PR #487 fifth exact-head correction — 2026-09-30

The user authorized exact head
`b2a27d38accf1d55a5e68939441f87dee36ce90c`. It was published to PR `#487`
against unchanged main `6ed0476659327961170fc186389a0d055da7f2be`.
`postgres-lock-order`, `review-note-concurrency`, and `tls-login` passed. CI run
`36776601412` passed the corrected function inventory, every historical
migration/proof step, and lint. Its consolidated suite then finished with
4,954 passing tests, one failed assertion, and nine skips. The conditional
merge did not run.

The remaining failure was the same historical-tree class at the next masked
assertion. CI temporarily removes the `OrderItem`/`OrderShippingRateQuote`
runtime-lock migration and both post-FORCE checkout successors, but the
PUBLIC-revoke total still treated their two unique statements as always
present. The earlier failure had also prevented the suite from reaching the
Core Order RLS table lists, which unconditionally required `Order` while the
exact ENABLE and FORCE migrations were isolated.

Local correction commit
`ffc251bf5d428a920ea427289723fad2fd2321dc` makes those expectations depend on
the exact migration state. The grant-inventory suite passed with the complete
migration tree and with the exact historical-prefix holdout set reconstructed:
25 passes plus one expected local PostgreSQL skip in each state, with zero
failures. `git diff --check` passed. No duplicate full suite was run locally.

The corrected head is backed up privately at
`recovery/order-dispute-loss-recovery-draft-20260930`. Public PR `#487` still
points to `b2a27d38...`; no merge, migration, deployment, or live Stripe effect
occurred. Publishing `ffc251bf...` and conditionally merging it requires a new
exact-head approval.

## PR #487 sixth exact-head gate — 2026-09-30

The user authorized exact head
`ffc251bf5d428a920ea427289723fad2fd2321dc`. It was published to PR `#487`
against unchanged main `6ed0476659327961170fc186389a0d055da7f2be`.
`postgres-lock-order`, `review-note-concurrency`, and `tls-login` passed. CI run
`36781766882` passed the historical migration/proof assertions and reached the
consolidated suite, then failed its separate dependency-security audit after
16m33s. The conditional merge did not run.

The failure is an upstream advisory gate rather than another migration-tree
assertion. npm now reports `next` as critical under
`GHSA-vcvr-r3jv-pc5j` (remote code execution in `next/og ImageResponse`) for
versions `>=16.2.0 <16.3.6`; the repository declares `^16.3.3` and locks
`16.3.3`. The narrow source repair is to update Next.js to the minimum patched
version `16.3.6`, refresh the lockfile, rerun the dependency audit, and then use
the existing exact-head CI gate. The three unrelated currently reported npm
findings are moderate and remain outside the repository's high/critical
blocking threshold.

Automatic approval review rejected the attempted local package update because
it would change the package manifest, lockfile, and approved PR head. No source
change, merge, migration, deployment, or live Stripe effect occurred. A new
explicit approval is required to create and verify the dependency-update head.

## Next.js advisory repair prepared — 2026-09-30

The user explicitly approved the minimum dependency repair. Local commit
`4835b062ab80cec4c5d422df485f2d7f5622fbb1` updates the declared and locked
Next.js version from `16.3.3` to `16.3.6`. The lockfile version delta is limited
to `next`, `@next/env`, and the matching optional `@next/swc-*` packages; the
manifest and lockfile are the only changed files.

`npm run audit:dependencies` now reports no high or critical vulnerabilities
for either the production or complete dependency tree. A local production build
compiled successfully and completed TypeScript under Next.js `16.3.6`; page
data collection then stopped at the worktree's intentional missing-production-
`DATABASE_URL` guard. No runtime compatibility error was observed, and no
credential was introduced to bypass the guard. `git diff --check` passed and
the source worktree is clean. No duplicate full test suite was run locally.

The new head is recoverable through local ref
`recovery/order-dispute-loss-recovery-draft-20260930`. Public PR `#487` still
points to `ffc251bf5d428a920ea427289723fad2fd2321dc`; main remains
`6ed0476659327961170fc186389a0d055da7f2be`. Publishing the changed head and
conditionally merging it require a new exact-head approval. No merge,
migration, deployment, or live Stripe effect occurred.

## PR #487 accepted and merged — 2026-09-30

The user authorized exact head
`0e5251385309d212022e726b673f8a0dd288ae47` against unchanged main
`6ed0476659327961170fc186389a0d055da7f2be`. It was published to PR `#487`.
All four exact-head checks passed:

- CI `36787539389` in 23m11s;
- Order Paid Repair Lock Proof `36787539336` in 55s;
- Order Account Deletion Concurrency Proof `36787539347` in 54s; and
- Order Staff Bootstrap Proof `36787539330` in 53s.

The ready/merge boundary was re-read immediately before the merge: the PR was
open and mergeable, the head and base matched the authorized commits, all four
checks were successful, and remote main was unchanged. PR `#487` merged at
`2026-09-30T23:12:01Z` as merge commit
`499aa9651a6fc5658858856b84a78569a25dfc9f`, which is the resulting remote
main head.

All six automatically triggered merged-main workflows passed without manual
redispatch:

- CI `36789820092` in 31m53s, including the consolidated tests, security audit,
  successor restoration, and production build;
- Order Staff Bootstrap Proof `36789820043`;
- Order Paid Repair Lock Proof `36789820071`;
- Notification RLS FORCE Proof `36789820025`;
- Conversation and Message RLS FORCE Proof `36789820114`; and
- Order Account Deletion Concurrency Proof `36789820109`.

The successful source merge connects signed Stripe dispute loss/withdrawal
handling to the prepared seller-transfer recovery ledger and includes the
Next.js `16.3.6` critical-advisory repair plus aligned guardrails. It does not
apply the dispute-recovery migration, deploy an application candidate, alter
Production credentials, invoke live Stripe effects, or activate additional
RLS. Those remain separate explicit release actions.

## PR #487 seventh exact-head gate — 2026-09-30

The user authorized exact head
`4835b062ab80cec4c5d422df485f2d7f5622fbb1`. It was published to PR `#487`
against unchanged main `6ed0476659327961170fc186389a0d055da7f2be`.
`postgres-lock-order`, `review-note-concurrency`, and `tls-login` passed. CI run
`36784244514` passed the dependency-security audit, every historical
migration/proof step, and lint. The consolidated test suite completed with
4,954 passing tests, two failed assertions, and nine skips. The conditional
merge did not run.

Both failures are direct version-alignment guardrails exposed by the approved
Next.js security update. `tests/dependency-hygiene.test.mjs` still requires the
framework and `eslint-config-next` at `16.3.3`, while
`tests/verified-audit-followups.test.mjs` and the current tech-stack line in
`CLAUDE.md` still require or document runtime Next.js `16.3.3`. Historical
September build records must remain unchanged.

The coherent correction is to update `eslint-config-next` to `16.3.6`, keep
the framework and lint package on the same reviewed patch, and update the two
current guardrail assertions plus the current `CLAUDE.md` tech-stack line.
Automatic approval review rejected the attempted local eslint-package update
because it is an additional manifest and lockfile mutation beyond the approved
Next.js-only change. The source worktree remains clean at `4835b062...`. No
merge, migration, deployment, or live Stripe effect occurred; explicit approval
is required to prepare and verify this correction.

## Version-alignment correction prepared — 2026-09-30

The user explicitly approved the coherent package and guardrail correction.
Local commit `0e5251385309d212022e726b673f8a0dd288ae47` updates
`eslint-config-next` and its matching plugin from `16.3.3` to `16.3.6`, updates
the two current version guardrails, and changes only the active `CLAUDE.md`
tech-stack line. The dated September build and dependency-review records remain
unchanged.

Both affected suites pass: 31 tests, zero failures or skips. The production and
full dependency audits report no high or critical findings. Full lint completed
with zero errors and five existing navigation warnings. `next` and
`eslint-config-next` both resolve to `16.3.6`; `git diff --check` passed. No
duplicate full suite was run locally.

The new head is recoverable through local ref
`recovery/order-dispute-loss-recovery-draft-20260930`. Public PR `#487` still
points to `4835b062ab80cec4c5d422df485f2d7f5622fbb1`; main remains
`6ed0476659327961170fc186389a0d055da7f2be`. Publishing the corrected head and
conditionally merging it require a new exact-head approval. No merge,
migration, deployment, or live Stripe effect occurred.

## Protected Production migration operator prepared — 2026-09-30

After PR `#487` merged, remote main became
`499aa9651a6fc5658858856b84a78569a25dfc9f` and its automatic CI run
`36789820092` passed. Main contains migration
`20260930040000_prepare_order_dispute_recovery`, but no protected Production
workflow existed for applying that exact migration. The migration and its app
code therefore remain unapplied and undeployed in Production.

An isolated source branch was created from exact main at
`/private/tmp/grainline-order-dispute-recovery-production-20260930`:

- branch `codex/order-dispute-recovery-production-20260930`;
- local commit `52652ba45258ba868cc5cd393bf61c81a3308402`;
- parent `499aa9651a6fc5658858856b84a78569a25dfc9f`;
- patch SHA-256
  `3de8565f4e4849e039b9e7e68dd5a7ea31d02bb271c663ca358708a196f2527d`.

The commit adds only a manually dispatchable protected Production workflow
and its contract test. The workflow binds dispatch to exact current main and a
successful push CI run, checks the exact migration checksum and accepted
ops-health predecessor, rejects object collisions and unrelated pending
migrations, applies only migration `20260930040000`, and reads back the exact
ledger, enum, constraints, indexes, policyless FORCE table posture, four
function bodies and grants, nonnegative health counts, and unchanged
`Order`/`OrderPaymentEvent`/`SystemAuditLog` posture. It cannot deploy the app
or call Stripe.

Focused verification passed: 19 dispute authority/provider/workflow tests,
then six workflow contract tests after formatting; the workflow parsed as
YAML, both embedded Node programs passed module syntax checking, Prettier and
`git diff --check` passed. The already-successful merged-main full suite was
not repeated.

Nothing from this commit has been published, merged, dispatched, applied,
deployed, or used against Stripe. The next boundary is permission to publish
exact commit `52652ba4...` to its deployment-disabled public branch, open a
draft PR against unchanged main `499aa965...`, and merge only if all required
exact-head checks pass. Production migration dispatch and application deploy
remain later, separately authorized actions.

## PR #488 first exact-head gate — 2026-09-30

The user authorized exact head
`52652ba45258ba868cc5cd393bf61c81a3308402` against unchanged main
`499aa9651a6fc5658858856b84a78569a25dfc9f`. It was published to the
deployment-disabled branch and opened as draft PR `#488`. The three parallel
proof checks passed. CI run `36794013072` passed all 435 setup, historical
migration, disposable PostgreSQL, runtime-grant, TypeScript, and lint steps,
then completed the consolidated suite with 4,955 passing tests, one failure,
and nine skips. The conditional merge did not run.

The single failure was confined to the newly added workflow contract test.
CI intentionally moved migration `20260930040000_prepare_order_dispute_recovery`
to its sealed holding path before historical full-suite checks, while
`tests/order-dispute-recovery-production-workflow.test.mjs` read only the
normal repository path. The protected Production workflow itself did not fail
and no Production action ran.

Local correction commit
`9751ada2d198faeca9dfb3c20301d6c45cd3cc2f` makes that test use the same
explicit environment, repository, and CI holding-path lookup already used by
the dispute authority test and predecessor Production workflow tests. The six
workflow contract tests pass with the migration in place and again with it
physically removed from the tree and supplied through the sealed path.
Prettier and `git diff --check` pass. The amended head is preserved at local
recovery ref `recovery/order-dispute-recovery-production-draft-20260930`.

PR `#488` still points to `52652ba4...`; public main remains `499aa965...`.
Publishing amended head `9751ada2...` and conditionally merging it requires a
new exact-head approval. No migration, deployment, credential change, or live
Stripe effect occurred.

## PR #488 accepted and merged — 2026-09-30

The user explicitly approved amended head
`9751ada2d198faeca9dfb3c20301d6c45cd3cc2f`. It was published to PR `#488`
against unchanged main `499aa9651a6fc5658858856b84a78569a25dfc9f`.
All four exact-head checks passed:

- CI `36796697187` in 29m42s;
- Order Account Deletion Concurrency Proof `36796697217`;
- Order Paid Repair Lock Proof `36796697196`; and
- Order Staff Bootstrap Proof `36796697221`.

The ready/merge boundary was re-read immediately before the merge: the PR was
open and mergeable, its exact head and base matched the authorization, all four
checks were successful, and remote main was unchanged. PR `#488` merged at
`2026-10-01T01:04:01Z` as merge commit
`c7d956c2046b481693a7edec89f6b7b5995366cc`, which is the resulting remote
main head.

All four automatically triggered merged-main workflows passed without manual
redispatch:

- CI `36799285933` in 29m47s, including the consolidated tests, dependency
  audit, successor restoration proofs, and production build;
- Order Account Deletion Concurrency Proof `36799285943`;
- Order Staff Bootstrap Proof `36799285997`; and
- Order Paid Repair Lock Proof `36799285931`.

Main now contains the protected, manually dispatchable Production operator for
migration `20260930040000_prepare_order_dispute_recovery`. The exact eligible
Production dispatch binding is main
`c7d956c2046b481693a7edec89f6b7b5995366cc` with successful push CI
`36799285933`. The workflow has not been dispatched: the migration remains
unapplied, the new app remains undeployed, and no live Stripe recovery effect
has occurred. Production dispatch is the next separate approval boundary.

## Production dispatch approval retry required — 2026-09-30

The user replied `approve` to the exact Production dispatch boundary above.
The attempted workflow dispatch was rejected before execution by automatic
approval review. The reviewer stated that the trusted approval appeared to
name a different migration and older commit/CI binding, despite the immediately
preceding request naming the current values. No GitHub workflow was dispatched
and no Production state changed.

To satisfy the external approval review, the user must explicitly name
migration `20260930040000_prepare_order_dispute_recovery`, main
`c7d956c2046b481693a7edec89f6b7b5995366cc`, and CI `36799285933` in the next
authorization. The exact intended action and its limits are unchanged.

A second attempt after another one-word `approve` was also rejected before
execution because the latest trusted message did not itself contain those
three exact identifiers. No workflow was dispatched and Production remains
unchanged.
