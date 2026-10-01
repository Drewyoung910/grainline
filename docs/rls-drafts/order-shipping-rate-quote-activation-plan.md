# OrderShippingRateQuote policyless RLS release plan

This is a local review artifact. It does not authorize or apply SQL, publish a
branch, deploy an application, or change Production.

## Required predecessor

The quote-table release begins only after the separate `OrderItem` ENABLE and
FORCE releases have completed and their Production postflights are accepted.
The required table posture is:

- `Order`: RLS enabled and forced, zero policies;
- `OrderItem`: RLS enabled and forced, zero policies;
- `OrderShippingRateQuote`: RLS and FORCE disabled, zero policies;
- all three tables owned by the reviewed migration owner;
- zero non-owner table or column privileges on all three tables.

The source baseline for this plan is local stacked commit
`38ede9409f6596b8baec87bdf8d25d0f80ff7599`, which contains the unpublished
OrderItem FORCE successor. The quote work must be rebased onto the exact
accepted OrderItem FORCE main commit before publication.

## Exact authority inventory

Application code has zero direct Prisma or raw-SQL access to
`OrderShippingRateQuote`. The latest migration-tree definitions contain exactly
four functions whose bodies touch the table:

| Function identity | Source MD5 | Purpose |
| --- | --- | --- |
| `grainline_order_account_deletion_scrub(text,text[])` | `95b5fdf923f85bcc96e8e25ac8905295` | Deletes retained quotes when an account's Order data is scrubbed. |
| `grainline_order_buyer_pii_prune_batch(integer)` | `885f070bf1f4934fb8786b820672cfbe` | Deletes quotes while pruning expired buyer PII. |
| `grainline_order_seller_label_claim(text,text,text)` | `c1bc1cfe61a5bfd910df308300c80b03` | Reads a non-expired selected rate after locking and authorizing the seller's Order. |
| `grainline_order_seller_label_quote_replace(text,text,text,jsonb)` | `5487c98b0c8a574946d2ac997d31e79a` | Replaces the seller-authorized Order's bounded quote snapshot. |

All four are PL/pgSQL, volatile, parallel-unsafe `SECURITY DEFINER` functions
with a pinned `search_path=pg_catalog`; the activation preflight pins those
attributes per identity and must reject a changed identity, body, owner,
language, volatility, parallel safety, security mode, dynamic SQL, or
unreviewed EXECUTE grant. The table has no non-internal triggers. The preflight
must reject any trigger appearing before activation.

The migration tree and runtime-role convergence script grant all four functions
to `grainline_app_runtime`, revoke PUBLIC, and do not make them staff-read RPCs.
The eventual preflight should require that exact effective non-owner ACL rather
than merely accepting any subset of the allowed runtime/staff roles; otherwise
an accidentally missing runtime grant could pass catalog safety checks but
break the live cron, account-deletion, or label path after activation.

Manual call-path review found no direct end-user SQL surface:

- account deletion runs inside `withDbUserContext`, and the database function
  requires `app.user_id` to equal its actor argument before locking that user;
- buyer-PII pruning is reachable only through the authenticated cron route and
  accepts only a bounded batch size while deriving the fixed retention cutoff
  in the database;
- label quote replacement and claim receive `actor.id` from the authenticated
  Clerk-backed route, re-resolve its active seller profile in the database,
  lock the target Order, require that seller to own it, and validate payment,
  fulfillment, dispute, refund, case, deauthorization, claim, rate, currency,
  amount, and expiry state before quote mutation or use;
- application wrappers use parameterized Prisma SQL and do not expose a caller
  override for the authenticated actor ID.

The label functions intentionally trust the server-owned runtime executor to
pass the authenticated actor. They do not independently compare `app.user_id`.
That is acceptable for the current trusted-server boundary and is not widened
by policyless RLS, but it must remain explicit in the release review; any future
client-callable SQL/RPC surface would require session-context binding first.

The table structure is also bounded: the quote belongs to one Order with
cascade deletion, `shipmentId` is limited to 255 characters, `rates` is limited
to 64,000 serialized bytes, and the two existing indexes cover Order-plus-expiry
and expiry cleanup lookups. Quote replacement and claim both lock the parent
Order before deleting, inserting, or consuming a quote, so those two seller
paths serialize on the same row. The replace function accepts one to four rate
objects, rejects duplicate provider rate IDs, and bounds IDs, amounts,
currencies, labels, carriers, and services. The claim function requires an
unexpired quote for the same locked Order and revalidates amount and currency.

## Release shape

1. Create a policyless ENABLE migration that changes only
   `OrderShippingRateQuote`: `ENABLE ROW LEVEL SECURITY`, `NO FORCE ROW LEVEL
   SECURITY`, and defensive revocation from PUBLIC, runtime, and staff roles.
2. Pin the exact three-table posture, restricted-role posture and memberships,
   direct reviewed owner session, absence of other owner sessions, four-function
   catalog, zero-trigger catalog, and zero direct grants before changing the
   table.
3. Preserve a rollback that only disables quote-table RLS and never recreates a
   grant.
4. Isolate the migration in CI until the accepted OrderItem FORCE predecessor
   has passed, then prove it in disposable PostgreSQL and audit runtime grants.
5. Use a manual, exact-main, exact-CI, Production-reviewed, restart-safe
   migration workflow. Require a fresh read-only authority inspection and the
   successful exact OrderItem FORCE Production run.
6. After an accepted ENABLE postflight, use a second posture-only FORCE
   migration and separate authorization. Do not combine ENABLE and FORCE.

## Validation boundary

Focused source and disposable-database proofs are appropriate while this plan
is local. A broad CI run is required once on the exact public ENABLE head and
once on the exact merged main commit. Do not repeat full suites for unchanged
bytes. No quote activation may be dispatched from this local stacked branch.
