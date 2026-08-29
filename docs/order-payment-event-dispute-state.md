# OrderPaymentEvent latest-dispute state correction

Status: compatible application correction merged and live in the currently
deployed source. Commit `374c650f23cdc0738be8ca1a41ba26712a0488d2`
is an ancestor of deployed source
`3431bb83fa16fabb9b9e18a729a7d138d48764d9`. The typed signed-event-time
column, deterministic equal-provider-second rule and supporting index remain
pre-activation schema gates.

Audited: 2026-08-23 after the seller refund product correction.

## Corrected boundary

Every application consumer that asks about current Stripe dispute state now
uses one canonical latest-per-dispute SQL family in
`src/lib/refundLedgerSql.ts`:

- seller refund, fulfillment and label locks use the latest state and treat all
  Stripe terminal statuses as closed;
- blocked-checkout refund handling uses the same latest-state ordering and no
  longer diagnoses a historical open row as current; and
- quality-score and site conversion aggregates use the same latest-state row
  selection while retaining their narrower product rule: only `won` and
  `warning_closed` are clean conversion outcomes. `lost`, `prevented`, open,
  null and unknown outcomes remain excluded.

The removed Prisma predicates were history-insensitive: they could match an
old `needs_response` row even after a later signed `won` or `warning_closed`
row for the same Stripe dispute. No runtime path may reintroduce an
any-historical-open query as a shortcut.

## Remaining schema prerequisite

This correction deliberately retains the compatible predecessor ordering:
signed `metadata.stripeEventCreated`, then application `createdAt`, then row
ID. Before RLS activation, a migration must add and validate the typed signed
event-time column and supporting latest-per-dispute index.

If two conflicting signed states share one provider second, application
arrival time must not silently choose the winner. The fixed dispute writer
must fail closed, retain both signed observations and put the Order into the
reviewed reconciliation state unless Stripe supplies a deterministically
confirmed current state.

## Proof and rollback

Focused tests pin the single helper, both distinct status sets, the absence of
history-insensitive helpers, seller/blocked-checkout diagnostics and both
aggregate consumers. The later schema/fixed-authority proof must exercise
open to won, open to warning-closed, open to lost, unknown, multiple disputes,
missing dispute IDs and equal-provider-second conflicts in disposable
PostgreSQL.

Rolling back this application change restores only the older predicate logic;
it has no database rollback. Do not do so merely to preserve a stale aggregate.
