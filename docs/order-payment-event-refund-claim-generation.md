# Order refund claim generation preparation

Status: compatible preparation merged through exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739`; not deployed or applied to
production. `OrderPaymentEvent` RLS remains off.

Prepared: 2026-08-23 after the accepted SellerPayoutEvent FORCE boundary and
the `OrderPaymentEvent` domain audit. The exact prepared migration is
`20260824010000_prepare_order_refund_claim_generation`, SHA-256
`2e08ec8c8c5c8d1c6aa85f59e3d914ad8f5b401100d5e79241f3043b2a52854b`.

The provider-authorized clock is stored explicitly as UTC at the SQL boundary.
Do not restore a session-time-zone cast: the reconciliation safety windows are
measured from this value and must be identical in local, CI and production
sessions.

## Decision

Seller full refunds and blocked-checkout automatic full refunds may call
Stripe only after PostgreSQL creates a database-derived claim. The claim owns:

- a random claim ID and monotonically increasing per-Order generation;
- one fixed source family (`SELLER` or `BLOCKED_CHECKOUT`);
- the seller actor, or the exact active signed webhook event generation and
  Checkout Session source;
- the Order-derived payment intent, amount, currency, transfer posture and
  component totals; and
- the Stripe idempotency scope derived from the claim ID and amount.

The runtime does not provide the claim ID, generation, payment target,
idempotency identity or transfer posture. Every success, orphan record and
ambiguous outcome compares the complete active tuple. A stale worker therefore
cannot finalize over another generation.

`refundClaimProviderAuthorizedAt` is stamped before the function returns to
application code. It means a provider call was authorized, not that Stripe was
contacted or succeeded. Once present, elapsed time alone can never release the
claim. Recovery must inspect provider and local payment evidence and either
finalize the exact claim or prove no provider effect through a later bounded
reconciliation operation.

## Coexistence boundary

The migration is additive and leaves `Order` RLS and predecessor table grants
unchanged. Old application versions can continue their legacy sentinel path.
The active-claim tuple constraint requires `sellerRefundId` to remain exactly
`pending` or `ambiguous_refund_pending_reconciliation` until the complete tuple
is cleared during a durable finalization. This database constraint rejects an
old stale-lock cleanup or `charge.refunded` update that would detach only the
legacy sentinel from an active claim.

The shared stale-lock cleanup also requires both `caseResolutionClaimId` and
`refundClaimId` to be null. Signed `charge.refunded` and terminal dispute
handlers retain their ledger behavior but cannot steal or clear an active
generation-fenced claim. Existing claims also block checkout-event retry from
being mistaken for an elapsed legacy lock.

Both checkout completion source families are accepted:
`checkout.session.completed` and
`checkout.session.async_payment_succeeded`. Any other event type, changed
claim generation, processed event, mismatched source object/session, mismatched
Order or changed amount fails closed.

## Scope and residual risk

This release closes OPE-A03's ABA/concurrency defect. It is not the complete
`OrderPaymentEvent` authority conversion:

- `Order` still has predecessor direct ordinary-runtime CRUD, so this is an
  application-correctness and coexistence fence, not a claim that a fully
  compromised runtime cannot rewrite Order state;
- final provider recording still uses exact conditional application writes;
  later fixed Order/payment operations must co-write the payment event, Order,
  stock, Case and audit evidence atomically before direct table authority is
  revoked;
- ambiguous or crash-before-provider-call claims intentionally remain blocked
  until evidence-based reconciliation exists; and
- typed dispute ordering, replay equality, append-only/taxonomy/currency/source
  invariants, actor-bound projections and the fresh production aggregate
  inspection remain separate activation gates.

Do not weaken these residual gates by adding a timer-based claim release, a
generic caller-targeted finalizer or participant access to base payment rows.

## Proof retained

Focused tests execute the real migration in disposable PostgreSQL and prove:

- seller ownership, active-account checks, replay and generation fencing;
- exact webhook generation/session/Order/amount source binding;
- both synchronous and asynchronous successful checkout event families;
- refund/dispute conflict denial and runtime/PUBLIC function ACLs;
- the tuple constraint rejects legacy sentinel detachment while permitting the
  exact ambiguous state; and
- signed refund/dispute handlers preserve an active claim.

The release verifier seals the exact migration bytes above and nests it only
after the retained SellerPayoutEvent FORCE predecessor. CI isolates this new
migration while replaying every sealed predecessor, then restores and applies
it only to the disposable CI database before the repository-wide tests. The
guarded Production Migrations workflow is intentionally not wired in this
preparation checkpoint.

## Next sequence

1. Complete Extra-High SQL/authority review and merge only the isolated
   compatible preparation after its stacked application corrections.
2. Wire a separately byte-pinned, restart-safe production preparation release;
   inspect production first and do not activate RLS in that run.
3. Deploy and smoke the converted seller and blocked-checkout paths while old
   and new deployments remain compatible.
4. Retain the compatible evidence-based reconciliation successor documented in
   `docs/order-payment-event-refund-reconciliation.md`; it closes the ambiguous
   claim recovery path but remains unapplied with this stack.
5. Prove the complete catalog with separate owner/runtime logins, drain the
   predecessor, then release policyless ENABLE and FORCE separately.
