# Order eligibility authority

Status: isolated compatible-preparation candidate; not applied or deployed.

The Order pre-RLS audit found four application decisions that read Order rows
even though none needs a general Order projection. This release replaces them
with fixed `SECURITY DEFINER` operations:

- `grainline_order_review_eligibility_lock` returns at most one OrderItem and
  durable seller key for a delivered, paid, non-refunded Order owned by the
  actor. It locks the parent Order in the caller's transaction so a concurrent
  refund/dispute transition and review creation retain deterministic ordering.
- `grainline_order_report_target_access` returns one boolean and requires both
  the reporter and reported account to be durable participants in the exact
  Order.
- `grainline_order_seller_verification_sales` returns only completed-sales
  cents and emits no row unless the supplied seller profile belongs to the
  actor.
- `grainline_listing_order_archive_blocked` returns only the existing
  active/recent/case-window blocker boolean and emits no row unless the listing
  belongs to the actor.

All inputs are bounded, `search_path` is pinned to `pg_catalog`, every object
reference is schema-qualified, PUBLIC execution is revoked, and only
`grainline_app_runtime` receives EXECUTE. The functions expose no buyer PII,
provider identifiers, Order rows, or cross-seller aggregate oracle.

This remains preparation only. The migration does not enable RLS, revoke
predecessor table grants, change rows, or authorize Order activation. Seller
analytics, public aggregates, maintenance scoring, and every Order mutation
remain separate follow-on authority families.
