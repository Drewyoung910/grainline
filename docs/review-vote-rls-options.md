# ReviewVote RLS options

Date: 2026-10-28  
Source: `adcfdde69a8c5651b30532ba15b161e218300f46`

`ReviewVote` stores a private relationship between one voter and one review.
The public product consumes only `Review.helpfulCount`; it never needs the
identities behind that count. The final design must therefore isolate vote
rows without changing public review ordering or exposing voter identities.

## Option comparison

| Option | Read boundary | Write boundary | Advantages | Risks and cost | Rollback |
| --- | --- | --- | --- | --- | --- |
| **A. Direct owner policies** | Owner `SELECT`; optionally owner `DELETE` | Owner `INSERT`/`DELETE` under policies, with a trigger for target eligibility and count maintenance | Small policy surface | A policy cannot by itself validate review/listing/seller visibility, self-vote rules, reciprocal blocks, and the cached helpful count atomically. A trigger would become the real authorization layer and duplicate the existing target authority. | Restore predecessor grants, disable RLS, remove policies/trigger |
| **A2. Owner `SELECT` plus fixed mutation operations (recommended)** | Owner `SELECT` for the bounded rendered-review lookup; owner export may use the same context or a bounded function | One actor-bound toggle operation validates the target, locks the review, toggles the exact row, and returns the authoritative count. A separate deletion operation removes all votes during account deletion while repairing counts. No direct `INSERT`, `UPDATE`, or `DELETE` | Keeps the simple private read simple while putting the cross-table invariant in one place. Public pages continue reading the scalar `Review.helpfulCount`. The operation is naturally idempotent under duplicate requests and can share the exact block/visibility rule | Adds two purpose-bound functions and requires the route and account-deletion conversion. Existing count drift must be inventoried and repaired first | Restore predecessor CRUD before disabling RLS; compatible app can continue using the fixed operations |
| **B. Policyless table** | Fixed owner-list/export functions only | Same fixed mutation/deletion functions as A2 | Strongest default-deny table boundary | Adds functions for a bounded owner read that an exact owner policy can safely express. More SQL and source catalog without a meaningful privacy gain over A2 | Restore predecessor CRUD and disable FORCE/RLS |
| **C. Public read view or companion table** | Public projection of vote rows or split identity/value tables | Mixed | None for this domain | Voter identity is not public product data. A public view would expand exposure; a split table adds joins and lifecycle risk without reducing the sensitive payload | Not selected |

## Decision

Select **A2**: owner-only `SELECT`, no direct row mutation after activation,
one fixed toggle operation, and one account-deletion operation. Keep
`Review.helpfulCount` as the public aggregate and reconcile it from
`ReviewVote` rows inside every compatible writer.

The compatible preparation candidate is implemented without an RLS or table
grant change and has passed the full 437-migration PostgreSQL 17 behavior and
mixed-version concurrency proof. Its predecessor insert guard uses the same
sorted `User`-first protocol as account deletion, then re-reads the mutable
review/listing/seller eligibility before retaining target locks. It does not
install a general count trigger:
the predecessor route still increments/decrements the scalar itself, so doing
that before predecessor traffic is drained would double-count. The final
activation candidate now installs delete-side count maintenance only after the
predecessor is drained, installs the exact owner `SELECT` policy, revokes direct
mutations, and exercises the denial, hard-delete, rollback and reactivation
matrix. Exact-head full-chain PostgreSQL 17 CI and independent review remain
gates. No release or Production workflow is included.

This decision authorizes isolated preparation only. It does not authorize an
RLS migration, grant change, merge, deployment, or Production action. See
`docs/review-vote-pre-rls-audit.md` for the remaining activation gates.

## Required fixed-operation properties

- Derive the actor only from transaction-local `app.user_id` established by
  the authenticated server wrapper; never accept an actor id as authority.
- Lock the active actor and exact review before deciding.
- Re-check current review visibility, reviewer identity, seller identity, and
  reciprocal blocks inside the mutation transaction.
- Reject self-votes, seller votes on their own listing, banned/deleted actors,
  unavailable targets, and malformed ids.
- Toggle only `(reviewId, actorId)` and return the count read after the same
  atomic mutation.
- Preserve one-row uniqueness and enforce `value = 1` at the database boundary.
- Account deletion must repair every affected review count in the same
  transaction and must not touch another user's votes.
- No seller, staff, public, cron, or analytics principal receives vote-row
  identities. They use only the public aggregate already stored on `Review`.

