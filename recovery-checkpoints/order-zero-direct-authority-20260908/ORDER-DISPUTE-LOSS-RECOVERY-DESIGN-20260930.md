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
- Current source draft is committed at
  `4515da45ef16b9784ede47f4b6cedd21c2f12b57` and backed up privately on
  `recovery/order-dispute-loss-recovery-draft-20260930`. The exact commit is
  also published on public deployment-disabled branch
  `codex/order-dispute-loss-recovery-20260930`. No PR is open. It has not been
  merged, deployed, applied to Production, or used against Stripe.

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

- Provider and retry tests: 8/8 passed.
- Source-contract and disposable PostgreSQL authority tests: 4/4 passed.
- The PostgreSQL proof caught and corrected an extra table-definition closing
  parenthesis and two enum-valued `CASE` expressions that otherwise resolved
  as `text`.
- Prisma validation, focused ESLint, TypeScript no-emit, and diff checks passed.
- No broad repository suite was run during this pass.

## Approval boundary

The user explicitly approved the source-only webhook connection and named the
future automatic seller-transfer reversal/restoration effect. Source
implementation is complete. The later one-word approval allowed the exact
public branch push, but automatic approval review rejected draft-PR creation
because the message did not literally restate publication and conditional
merge. Exact authorization is still required to open and conditionally merge
the PR. Later Production approval is required to apply its migration, deploy
it, and allow it to affect live Stripe transfers.
