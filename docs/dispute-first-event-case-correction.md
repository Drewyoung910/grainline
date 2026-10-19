# Stripe dispute first-event Case correction (#662)

Status: restacked source candidate on current main
`30f13665fb156a0639fdae3685fc04d714232d89`. Nothing in this document is
merge, deployment, migration, or Production evidence.

Candidate migration:
`20261017010000_correct_dispute_first_event_case`

The candidate is byte-pinned to the exact Case-refund predecessor applied by
Production run `39113321452`. That predecessor already corrects #714 in
`grainline_order_payment_projection_state`; this successor does not redefine
the projection function and preserves that correction.

## Verified failure

The signed Stripe dispute authority orders observations by Stripe's signed
event time, but the predecessor creates or reopens a Case only for
`charge.dispute.created`. If a nonterminal
`charge.dispute.funds_withdrawn` event is recorded first, it becomes the
applied observation without creating a Case or authorizing the seller alert.
A later `created` event at the same provider second is classified as a conflict
only because its event type differs. It therefore cannot repair the missing
Case or alert.

The focused database test reproduces the predecessor result exactly:
`funds_withdrawn -> applied`, `created -> conflict_recorded`, zero Cases, and
zero authorized seller alerts.

The Case authority and the `grainline_case_relationship_valid` trigger also
require `metadata.stripeEventType = charge.dispute.created`. Changing only the
outer signed authority would therefore fail with SQLSTATE `23514` rather than
closing the gap.

## Candidate invariant

When the first signed observation for one Stripe dispute ID is nonterminal,
it opens or reopens the retained Case and authorizes exactly one seller alert,
regardless of its supported `charge.dispute.*` event type. A terminal first
observation remains ledger-only. A later `charge.dispute.created` delivery
retains predecessor recovery behavior and may open the Case once the dispute
becomes nonterminal; later non-`created` deliveries remain ledger-only.

Event type identifies the Stripe delivery, not the dispute's provider state.
Otherwise identical observations at one provider second therefore do not
conflict solely because one delivery is `created` and the other is
`funds_withdrawn`. Amount, currency, status, and reason differences continue to
classify the same-second observations as conflicting and require staff review.

## Patch boundary

The forward migration replaces four existing functions without changing
their signatures:

- `grainline_order_payment_signed_dispute_apply(...)` tracks whether no prior
  event exists for the dispute and applies that first event to Case when it is
  nonterminal;
- `grainline_case_stripe_dispute_apply(text)` accepts every supported signed
  dispute event type while retaining charge, dispute ID, signed-time,
  currency, ordering, participant, and nonterminal checks. Every source must
  carry `orderingAction=applied`; an exact existing Case application remains a
  stable replay, while a different source cannot create a second application
  for the dispute; and
- `grainline_case_relationship_valid()` permits the same supported event
  family for `openedByPaymentEventId` while retaining all other relationship
  checks; and
- `grainline_notification_create_core(...)` admits the same event family only
  when the exact payment event has a durable create/reopen Case application.

The migration also repairs retained predecessor rows transactionally. It
materializes one immutable transaction-local candidate set containing at most
one newest nonterminal signed `orderingAction=applied` event per order/dispute
with no Case application, excluding events superseded by a newer or
same-second terminal observation. It counts and loops only that materialized
set, and aborts before any repair write if it exceeds 100 order/dispute pairs
or if any candidate already has a full- or partial-refund Case resolution that
the generic reopen authority would erase. Within that bound, it applies the Case authority and creates the
source-validated deduplicated seller notification.

The builder pins the four reviewed predecessor files by SHA-256 and generates
the exact migration bytes. The migration snapshots and verifies each
function's owner, SECURITY DEFINER, volatility, parallel-safety,
`search_path`, and runtime/PUBLIC ACL posture.

## Acceptance evidence

The decisive proof passed locally on PostgreSQL 16 after building the
repository's full 350-migration candidate schema. Immediately before this
migration, it executed the
current post-#595 authority and reproduced `funds_withdrawn -> applied`,
`created -> conflict_recorded`, zero Case applications, and no authorized
seller alert. It then applied the candidate; the same database contained one repaired
Case application and one seller notification. A fresh funds-first flow creates
one Case, authorizes one alert, and records the same-second `created` delivery
without a conflict or duplicate side effect. The existing full-chain Case
suite also confirms that #714 remains fixed.

The source candidate additionally retains a fast PGlite behavior suite;
its 18 focused behavior and protected-release tests pass. That suite is
supplemental and does not substitute for the PostgreSQL 16 full-chain proof.

`tests/dispute-first-event-case-correction.test.mjs` covers:

1. the exact predecessor failure;
2. `funds_withdrawn` first creating one UNDER_REVIEW Case and authorizing one
   alert;
3. same-second `created` being recorded without a duplicate alert;
4. the reverse same-second permutation (`created` then `funds_withdrawn`)
   remaining non-conflicting and not duplicating the Case or alert;
5. a later-second `created` delivery not reopening or re-alerting the Case;
6. true same-second amount disagreement remaining a conflict;
7. stable replay of the opening source after later siblings, rejection of a
   later source's attempt to create a second application, and continued
   validity of later Case updates;
8. repair of one retained predecessor gap into exactly one Case application
   and one seller notification;
9. first-event reopening of an existing resolved Case;
10. unchanged ordinary `created`-first behavior;
11. terminal-first remaining ledger-only, a later non-`created` nonterminal
    delivery also remaining ledger-only, and a later `created` opening once;
12. rejection when a caller directly supplies a later non-`created` event to
    the widened Case authority;
13. a 101-candidate recovery set aborting before any Case, application, or
    notification write; and
14. the read-only Production preflight classifying a retained gap as
    repairable, then refusing it after account deletion nulls the buyer;
15. the Production preflight and migration refusing a retained gap whose
    existing full-refund Case would otherwise be reopened and stripped of its
    refund record, with no Case, application, or notification mutation; and
16. exact preservation of function owner, ACLs, SECURITY DEFINER, volatility,
    parallel safety, and `search_path` across the migration.

## Remaining release gates

- Publish this restacked candidate as a small PR and obtain an independent
  money/database diff review. Resolve or refute every blocker with recorded
  evidence, then require exact-head CI.
- The dedicated Production lane binds an exact main
  commit to the exact successful push-workflow set, accepts only this migration
  as pending, validates all four predecessor bodies and catalog attributes,
  counts the exact transaction-repair candidate set before deploy, and refuses
  more than 100 candidates or any row whose retained buyer, charge, dispute,
  event, or one-seller relationship can no longer satisfy the repair authority,
  or whose existing Case carries a full or partial refund resolution,
  and reads back exact replacement bodies, unchanged ACLs, the migration
  ledger, and zero retained eligible gaps. Production dispatch remains a
  separate approval after merge and exact-main checks.
- Confirm the real `created`/`funds_withdrawn` delivery timing in Stripe test
  mode during the planned post-#648 end-to-end pass. The source defect and its
  correction do not depend on that provider observation, but the observation
  determines how often this ordering occurs.

RLS expansion remains paused through #662 and the other named money blockers.
