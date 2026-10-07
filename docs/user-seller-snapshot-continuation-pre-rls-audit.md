# User seller snapshot continuation pre-RLS audit

## Source boundary and intended behavior

This isolated continuation is stacked on the seller/review successor recorded
in `docs/user-seller-relation-reuse-pre-rls-audit.md`. It reuses the already
installed, trigger-maintained `SellerProfile.userId` and
`SellerProfile.ownerAccountActive` fields in seven remaining seller preflight
relations. It adds no migration, operation, grant, policy or public identity
surface.

An active `User` row is not automatically a public profile. This continuation
therefore does not introduce a table-wide active-user read policy or a generic
public identity projection. Each conversion remains bound to an existing
seller, listing, commission, broadcast or Stripe-account source row.

The intended behavior is unchanged:

- new-conversation listing context requires the durable seller owner to be an
  active account, an orderable seller and an actual conversation participant;
- commission interest notifications select only active seller accounts;
- scheduled commission expiry uses the same active-seller filter;
- a queued broadcast rechecks the current seller activity, payments and
  vacation state before fanout;
- Stripe account mirroring may never re-enable an inactive local seller and
  retains the durable seller owner id for security telemetry; and
- listing edit reads and writes remain bound to the authenticated active local
  owner, with rate limiting before the identity lookup.

## Operation and principal matrix

| Operation | Principal | Bounded authority |
| --- | --- | --- |
| Attach a listing to a new conversation | Authenticated participant | Existing Listing plus durable seller owner/activity snapshot |
| Notify commission interests | Current commission owner or expiry job | Existing CommissionInterest rows whose SellerProfile owner is active |
| Deliver a seller broadcast | Existing queued broadcast | Current SellerProfile activity, payment and vacation snapshots |
| Mirror Stripe account availability | Signed webhook or reconciliation job | SellerProfile matched by exact Stripe account id |
| View or update a listing draft | Authenticated active seller owner | Clerk gate plus exact Listing to durable SellerProfile owner id |

## Product, authority and concurrency review

`ownerAccountActive` is written by the accepted User-to-SellerProfile snapshot
trigger in the same database transaction as lifecycle changes. Reusing it
removes a cross-table `User` relation without weakening the existing source
predicate. The conversation helper is fail closed when the snapshot field is
present but not exactly `true`; its legacy nested-user fallback remains only
for callers not converted in this continuation.

The listing server action resolves the local actor through the existing fixed
Clerk gate and binds its final Listing lookup to `SellerProfile.userId`.
Rate limiting remains ahead of that database lookup. The server-rendered edit
page uses the same active-actor and durable-owner boundary. Neither path grants
staff impersonation or public access.

Stripe mirroring still derives effective availability as provider
`charges_enabled` AND local account activity. It retains the existing
transactional SellerProfile update, system audit row, checkout-session expiry
and cache revalidation behavior. This continuation changes only the source of
the local lifecycle fact and owner id.

No new blocking product defect was found in this bounded continuation. The
separate seller/review predecessor fixes the verified concurrent reply
overwrite described in its audit. Remaining buyer/reviewer identity relations,
raw User SQL, service ledgers, opaque query composition and installed catalog
comparison still block User activation.

## Decision and validation

GO for the seven bounded snapshot/owner-id conversions in a combined source
PR with the seller/review successor. NO-GO for User grants, policies, ENABLE,
FORCE, migration execution or Production deployment from this evidence.

Focused validation passed 45/45 cases across the new inventory contract,
conversation state, seller/review successor, seller operational hardening,
follower notification fanout, Stripe Connect mirroring and system audit logs.
Targeted ESLint and `git diff --check` pass. The schema-aware inventory reports
zero direct User delegate calls, 64 visible User relation edges across 30 files,
ten raw User SQL calls across nine files, two typed relation factories, 222
opaque caller shapes and fourteen opaque factory-return shapes. The stacked
seller work removes thirteen visible relation edges in total, from 77/37 to
64/30. No broad test suite or database release proof was repeated.
