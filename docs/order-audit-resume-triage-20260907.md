# Order resume after the broad audit — 2026-09-07

## Decision and preserved work

Drew resumed normal implementation after the audit and explicitly requested no
agents. Finish the existing isolated Order candidate first; do not infer permission
to merge, deploy, mutate production or change provider state from that resumption.
The candidate remains no-go for Order ENABLE/FORCE under
[the ordered completion plan](order-rls-completion-plan-20260907.md).

The preserved pre-audit head is `bc1ff4d151572086f8d8ca6740256728e6da91e8` on
`agent/order-checkout-retry-clock-20260906`, draft PR #432. The four tracked
modifications and three untracked input-runtime-proof files were present after
the audit. Read-only GitHub verification confirmed the draft head and successful
full CI `34166065857` for code `be0eedf0f0a5ca8eeefd59c66d3d78023664d0f6`.
That accepted run does not include the newer native-login proof.

The audit made no application fixes or production changes. It produced six
source-review packets and a bounded security report. Coverage was partial;
proposed regressions are not passing tests, and code findings are not evidence
of actual production incidents or measured capacity. Historical live-table
counts were not re-attested during the audit.

## Durable evidence location

The full packets and their index are preserved locally in
`/Users/drewyoung/grainline/docs/audits/`, outside the temporary candidate:

- `2026-09-07-runtime-review.md`
- `2026-09-07-legal-architecture-review.md`
- `2026-09-07-shipping-operations-accessibility-review.md`
- `2026-09-07-checkout-discovery-batch-review.md`
- `2026-09-07-listing-inventory-settings-review.md`
- `2026-09-07-orders-cases-publishing-review.md`
- `2026-09-07-security-artifacts/report.md` and its canonical artifacts.

These full packets are local, not claimed committed/pushed with this resume note.
Preserve and package them separately; do not switch, merge or prune the dirty old
root/worktrees to move them. Each packet records source references, counterevidence,
coverage limits and proposed tests. This triage links them into the release and
deferred-work records so compaction does not silently discard their obligations.

## Resume sequence and finding disposition

1. Complete the pending disposable input runtime-login proof and exact-head CI.
   This accepts only five corrected input boundaries and absence controls, not
   authenticated application behavior or a production release. Keep the separate
   reservation repair release separate.
2. Reproduce and close financial/security blockers in cohesive follow-ups before
   compatible release acceptance. Preserve original audit IDs and record each
   implementation/test/remaining-evidence result rather than mark the entire
   audit closed. Recheck effective source before each fix.
3. Reclassify any remaining affected-domain product issues before activation;
   minor unrelated UI work need not block every RLS step. Then follow compatibility,
   authenticated/provider proof, predecessor overlap and ENABLE/FORCE gates in order.

| Findings / topic | Disposition | Closure needed |
| --- | --- | --- |
| Security `csf_990e02d7d42b736724a1b2be`: staff Order reads rely on layout-only PIN gating | `FIX_BEFORE_ACTIVATION` | Revalidate each effective data entry point, enforce session-bound staff step-up at the data-access boundary, and test missing/invalid/valid PIN without relying on layout rendering. Ordinary-user denial remains required. |
| FIN-01: label clawback initial/retry payload drift | `FIX_BEFORE_ACTIVATION` | One immutable provider request; prove recovery after lost response/local-finalization failure and bounded handling after provider idempotency age. Do not infer duplicate money movement merely from the source mismatch. |
| LISTING-F02/F03: stale content save restores stock; uncertain adjustment retry reapplies a delta | `FIX_BEFORE_ACTIVATION` for the affected Order stock lifecycle | Preserve newer inventory on unrelated edits, give adjustment retries a stable outcome, and prove checkout/reservation interleavings and post-commit failures. Do not replace delta handling with blind absolute overwrites. |
| JOB-01: label recovery deadline/batch budget | `FIX_BEFORE_ACTIVATION`, pending complete-path validation | Verify effective provider deadlines and worker limits, then prove bounded claims/attempts, ambiguous-outcome retention and continuation. Source-only worker report is not a measured timeout. |
| CASE-04/05 and existing Case/policy inconsistencies | `FIX_BEFORE_ACTIVATION` where Order/Case gates are affected | Align early-receipt eligibility, pending-close objections/escalation and documented timing; test suspended counterparties, staff fallback and cron exclusion. Staff can still intervene; permanently stuck funds were not proved. |
| ORDER-F01/F02: note draft loss/stale replacement | `DEFERRED_PRODUCT_WORK` until the affected seller-notes package | Preserve newer drafts, define append versus replace/clear intent, and test stale-tab plus pending-response races. No new principal/grant is implied. |
| ORDER-F03: missing historical wrapping/total in seller export | `DEFERRED_PRODUCT_WORK`; correct before advertising export as complete transaction accounting | Export immutable historical components/total and test after listing-price changes. Do not treat this technical review as tax/accounting certification. |
| Shipping quote/recovery findings | Existing Order smoke gate plus linked product decisions | Prove signed quote refresh, stale-address/recovery behavior and seller full-address re-quote. Document one-parcel/fallback pricing limitations; a packing engine is not implicitly part of RLS. |
| Other messaging, blog, discovery, account and accessibility findings | `DEFERRED_PRODUCT_WORK`, with each packet's closure tests | Preserve domain authority requirements; implement separately. Do not use this row to waive a separately identified security or paid-launch blocker. |
| Worker continuation, SSE/polling, large catalogs/history and export capacity | Conditional scale gates, not a throughput certification | Measure realistic concurrent workloads and failure recovery; bound client growth, expose complete pagination and preserve durable job progress before exceeding reviewed operating limits. |
| Terms/privacy and operational legal questions | Recorded decision/launch gates | Reconcile promises with behavior and obtain qualified counsel review where required. No assertion of complete legal compliance or lawsuit immunity. |

The existing comprehensive credential incident remains a separate production
release gate. Neither a successful isolated test nor this prioritization closes it.
No new table family starts while the current Order exit gates remain unresolved.

## Implementation follow-up

The five-body input-runtime proof completed native PostgreSQL and full CI/build
at `4574786557c5ac196267b1bbb5ba82e3a6aede76`, run `34178233977`.
The next isolated application candidate enforces session-bound PIN verification
on all fourteen sensitive staff pages; see
[its reproduction, implementation and verification record](admin-page-pin-boundary-fix.md).
This is not a deployed fix or closure of the other financial/security findings.

The staff candidate subsequently passed full CI `34179627726` at
`1dc274a5b3990536e0c38aa9998733676d5cc2d3`, plus all three companion proofs.
The next FIN-01/JOB-01 implementation and its remaining provider/release gates are
recorded in [label-cost reversal replay](order-label-clawback-replay-correction.md).
It retains manual reconciliation outside the proven idempotency window; historical
Order/amount metadata cannot safely identify a replacement label's reversal.

Label checkpoint `00c570b826dc421b6a349936ade97623cb5c65fe` passed full CI
`34183133619`, including native clock rollback and build, plus all three companion
proofs. Provider/runtime/release acceptance remains separate.
LISTING-F02/F03 were reproduced and their isolated implementation is recorded in
[stock consistency](listing-stock-consistency-correction.md). It preserves delta
semantics and existing stock editing through an explicit action; full exact-head
CI and release acceptance are still required before closure. Its full exact-head
CI/build and native stock schedules subsequently passed at `d4d51324`, run
`34186946233`; authenticated release acceptance remains separate.

CASE-04/05 are now reproduced and implemented as isolated candidates in
[the Case lifecycle correction](case-lifecycle-correction.md). The draft preserves
existing deadlines, refund/authority locks and unavailable-recipient restrictions,
while fixing opening/objection access and response/UI parity. Native full-schema,
actual-runtime and release acceptance remain distinct. The other rows and the
separate policy/legal timing findings are not closed by this package.
