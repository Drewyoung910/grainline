# StockNotification RLS options

Date: 2026-10-26

Status: **Option A2 selected for isolated source preparation.** This decision
authorizes an audit-backed candidate only. It does not authorize a Production
migration, grant change, deployment, or RLS activation.

Reviewed source baseline:
`ab927b134dc3e77af4477a59972331423a0118b7`.
Production catalog state remains a separate read-only release check.

## Domain shape

`StockNotification` has four columns: a row id, listing id, subscribing user id,
and creation timestamp. The row belongs to the subscriber, but the table is not
owner-only in operation:

- a buyer creates, reads, and removes their own subscription;
- a seller sees counts for listings they own, but must never see subscriber
  identities;
- a manual restock discovers and atomically claims every eligible subscriber;
- seller deletion/archive and staff listing removal delete subscriptions owned
  by other users;
- account export and deletion operate on all rows for the current account;
- user blocking must prevent both creation and delivery in either direction;
- hard listing and user deletion rely on foreign-key cascades.

The public catalog does not need any direct access to this table. A subscription
is private relationship data even though the target listing is public.

## Invariants every option must preserve

1. Only an active signed-in account can subscribe itself.
2. A subscription is accepted only for a public, non-archived, orderable,
   `IN_STOCK` listing whose quantity is zero and whose detail status is
   `ACTIVE` or `SOLD_OUT`.
3. A maker cannot subscribe to their own listing.
4. Neither side of a reciprocal block may create or receive a stock alert. The
   subscription/block race must serialize on the same sorted user pair.
5. A subscriber can read and remove only their own rows. There is no direct
   update operation.
6. Sellers receive only aggregate counts for listings they currently own.
   Subscriber ids and timestamps are not seller-visible.
7. Restock candidate discovery returns only opaque subscription ids and is
   bound to the exact committed `MANUAL_LISTING_RESTOCKED` audit record. The
   existing claim remains the final authority and rechecks all mutable state.
8. Seller archive/delete, admin removal, account deletion, and FK cascades keep
   their current cleanup behavior after FORCE RLS.
9. Account export returns only the actor's subscriptions and a bounded listing
   projection; it cannot expose other subscribers.
10. Activation changes authority only. It does not rewrite rows or drop a
    column.

## Options

| Option | Shape | Caller conversion | Protection | Rollback | Limits |
| --- | --- | --- | --- | --- | --- |
| **A1. Plain owner policies** | Owner `SELECT`, `INSERT`, and `DELETE`; no `UPDATE`. | Wrap owner calls in `app.user_id`; add functions for seller aggregates, fanout, and cleanup. | Good cross-user row isolation. | Restore predecessor grants and disable RLS. | An insert policy alone cannot atomically validate listing state, self-subscription, and reciprocal blocks. A trigger would duplicate a purpose-bound subscribe operation and still need a shared pair lock. |
| **A2. Owner read/delete policies plus fixed subscribe/service operations** | Owner `SELECT` and `DELETE`; no direct `INSERT` or `UPDATE`. A fixed subscribe operation validates the public listing and serializes with Block. Fixed functions handle aggregate/fanout/cleanup work. | Convert the owner UI to one centralized helper. Convert three seller-count surfaces, restock discovery, two listing cleanup paths, account export/deletion, and block cleanup. | Keeps simple owner reads/deletes while making the only complex owner write atomic. Sellers never receive subscriber identities. Cross-owner jobs expose only their minimum result. | Deploy predecessor-compatible callers first. For rollback, restore predecessor grants and disable FORCE/RLS before rolling the app back. No data move is involved. | More functions than A1, but each corresponds to a real non-owner operation. The shared runtime credential can still call granted functions, so argument and actor derivation remain security boundaries. |
| **B. Policyless table with functions for everything** | Zero direct table authority and functions for owner read/delete as well as all service paths. | Every access converts, including simple owner state and account cleanup. | Strongest default-deny surface and no accidental future column exposure. | Restore broad predecessor grants and disable RLS before app rollback. | Adds functions without adding meaningful protection for the two simple owner operations. It increases SQL drift and maintenance cost for a four-column relationship table. |
| **C. Grant-only hardening without RLS** | Revoke `UPDATE`, retain broad runtime `SELECT`/`INSERT`/`DELETE`. | Few conversions. | Prevents an unused mutation only. | Restore the old grant. | Any missed app ownership check can still enumerate or remove everybody's subscriptions. It does not meet the defense-in-depth goal. |

## Recommendation

Choose **Option A2**.

This is the smallest design that matches the actual domain. Owner state remains
simple, but subscription creation is not simple: it must validate changing
listing state and win or lose atomically against a new reciprocal block. A
fixed subscribe operation is clearer and safer than a permissive insert policy
plus a security-definer trigger. Cross-owner operations are already distinct
product actions, so bounded functions do not create artificial ceremony.

The planned runtime table grants after activation are `SELECT` and `DELETE`
only. Two owner policies bind those operations to transaction-local
`app.user_id`. There is no direct runtime `INSERT`, `UPDATE`, `TRUNCATE`,
`REFERENCES`, or `TRIGGER` privilege.

## Release shape

1. An additive preparation migration installs or updates the fixed operations
   while predecessor table grants remain.
2. The compatible app moves every direct and relation-based caller to the
   owner/service helpers. It also fixes C-759 and C-708 and prevents
   self-subscription.
3. Full-chain PostgreSQL behavior tests prove the predecessor and candidate
   behavior, block races, aggregate privacy, cleanup, cascades, and direct
   cross-user denial.
4. After the compatible app is live and predecessors are drained, one generic
   owner-table activation migration revokes predecessor authority and applies
   ENABLE plus FORCE together.
5. Production activation still requires its own precise request naming the
   workflow, exact main commit, successful exact-head CI run, sole migration,
   and expected effect.

## Decision record

- [x] Select Option A2 for isolated preparation (Codex, 2026-10-26, based on
  Drew's instruction to choose the best long-term safety/scalability design).
- [ ] Production activation approved.
