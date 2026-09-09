# Order refund claim provider-clock authority

Status: **isolated compatible candidate; database function is a draft and the
application conversion must not deploy first**.

Prepared: 2026-09-05

## Why this exists

Refund replay must compare Stripe evidence to the exact database time at which
the active claim authorized a provider call. The application currently reloads
the full `Order` delegate solely to obtain that timestamp. That read would fail
after policyless Order RLS and unnecessarily leaves the ordinary runtime with
base-table authority before activation.

The fixed function
`grainline_order_refund_claim_provider_clock(text,bigint,text,text,bigint,text)`
returns at most one `timestamp(3) without time zone`. It requires the complete
active-claim identity: claim id and generation, source family and source id,
source generation semantics, idempotency scope, the `pending` refund sentinel,
and a non-null provider authorization time. A well-formed forgery returns no
row; a malformed source/generation shape fails closed.

It exposes no Order id, participant, money, address, provider object id or
general existence oracle. `PUBLIC` execution is revoked, only
`grainline_app_runtime` receives `EXECUTE`, and the role receives no Order
table privilege through this candidate.

## Proof

- static tests pin all claim predicates, the one-column return shape, function
  posture, grants and the absence of RLS/table-grant changes;
- disposable PostgreSQL proves the exact seller and blocked-checkout shapes,
  rejects every identity-field forgery, rejects malformed generation shapes,
  permits execution through the restricted runtime role and denies that role
  direct `Order` reads; and
- the executable source inventory falls from 16 to 15 direct `Order` files.

## Release order

1. Promote only the reviewed SQL into a byte-pinned compatible migration and
   prove it against the complete migration tree.
2. Run the aggregate-only production scope check, apply only that migration,
   converge the exact function grant and run the pooled-runtime proof.
3. Only then merge/deploy the application conversion and exercise an exact
   replay path. A code-first deployment would call an absent function and is
   prohibited.
4. Retire no predecessor function and change no Order RLS/table grant in this
   release. Continue with the remaining bounded mutation/maintenance families.

This conversion does not authorize Order Phase A by itself.
