# Remaining RLS table prioritization audit

Date: 2026-10-12 (America/Chicago)

## Scope and evidence boundary

This is a source and retained-release-evidence audit updated after the accepted
AccountDeletionSideEffect and ClerkWebhookEvent FORCE releases, with the next
SellerProfile boundary audited on exact public main
`311fc18835ccdfac87b64b5c60584b2de3f85b49`. It validates the proposed
remaining-table plan; it does not activate RLS, change grants, or claim a fresh
whole-database Production catalog read.

Each conclusion below was checked against five questions:

1. What does the exact current Prisma schema contain?
2. What do committed migrations enable and force?
3. What direct table privileges does the runtime grant audit currently expect?
4. Which application, worker, staff, export, deletion, cleanup, and provider
   paths access the table?
5. Can the proposed control be deployed and recovered without breaking those
   paths?

## Corrected inventory

The supplied `24 forced / 2 staged / 42 without RLS` count is stale for this
source. Exact-main parsing finds 68 Prisma models:

- 28 have committed `ENABLE ROW LEVEL SECURITY` and
  `FORCE ROW LEVEL SECURITY` migrations; and
- 40 have no committed RLS enable migration.

The 28 source and retained-Production FORCE models are:

`User`, `UserEmailAddress`, `Conversation`, `Message`, `Order`,
`OrderShippingRateQuote`, `OrderPaymentEvent`, `OrderDisputeRecovery`,
`OrderRefundReconciliation`, `OrderStaffCapability`, `SellerPayoutEvent`,
`OrderItem`, `CheckoutStockReservation`, `SellerDeauthorizationApplication`,
`Case`, `CaseResolutionClaim`, `CaseStripeDisputeApplication`,
`CaseSellerRefundApplication`, `CaseOpenApplication`, `CaseMessage`,
`CaseMessageAttachment`, `SavedSearch`, `DirectUpload`,
`DirectUploadReference`, `StripeWebhookEvent`, `Notification`,
`AccountDeletionSideEffect`, and `ClerkWebhookEvent`.

The two Case application tables described in the supplied assessment as
no-RLS tables with revoked grants are therefore not exceptions: both already
have committed ENABLE and FORCE migrations.

The 40 no-RLS models are:

`SellerProfile`, `SellerFaq`, `FoundingMakerGrant`, `Listing`, `Photo`,
`Favorite`, `Review`, `ReviewPhoto`, `ReviewVote`, `Cart`, `CartItem`,
`ListingVariantGroup`, `ListingVariantOption`, `SiteConfig`,
`StockNotification`, `MakerVerification`, `BlogPost`, `BlogComment`,
`NewsletterSubscriber`, `EmailSuppression`, `ResendWebhookEvent`, `CronRun`,
`SystemAuditLog`, `EmailFailureCount`, `EmailOutbox`, `SupportRequest`,
`SellerMetrics`, `SellerRatingSummary`, `SiteMetricsSnapshot`,
`ListingViewDaily`, `SellerProfileViewDaily`, `Follow`, `SavedBlogPost`,
`SellerBroadcast`, `CommissionRequest`, `CommissionInterest`, `Metro`,
`AdminAuditLog`, `Block`, and `UserReport`.

Production claims remain tied to retained run and catalog evidence.
`AccountDeletionSideEffect` FORCE is accepted from exact main
`7510a371adfb02a82727f4acb00ee36d8ce11386`, CI `38334674654`, read-only
preflight `38337628141`, and guarded Production run `38338019810`.
`ClerkWebhookEvent` FORCE is accepted from exact main
`311fc18835ccdfac87b64b5c60584b2de3f85b49`, exact-head CI `38379489904`,
merged-main CI `38383903381`, read-only inspection `38387534568`, and guarded
Production run `38387919313`. Production is therefore at 28 FORCE and 40
without RLS.

## Runtime exposure

The risk is real. `scripts/provision-runtime-db-role.sql` grants the ordinary
runtime role SELECT, INSERT, UPDATE, and DELETE on the broad predecessor table
set. `requiredRuntimeTablePrivileges()` in
`scripts/audit-runtime-db-grants.mjs` continues to expect all four privileges
unless an explicit activated-table exception applies. The global grant audit
passed after the AccountDeletionSideEffect ENABLE release, so current retained
evidence is consistent with broad runtime CRUD remaining on the 40 no-RLS
tables.

RLS is defense in depth: route and action authorization remains mandatory. But
leaving all 40 tables in this state is not a safe final architecture. A runtime
credential compromise or an exploitable arbitrary-query path would retain a
large cross-domain blast radius.

## Disposition of the proposed plan

### Valid priorities, with stronger boundaries required

- `SupportRequest` is high priority. It contains legal/data-request contact
  data and free text, but also supports anonymous submission, authenticated
  export/deletion, staff queues, retention, and ops-health. It needs a narrow
  submission operation, requester projection, and staff/worker operations;
  one owner policy is insufficient.
- `EmailOutbox` is high priority and contains rendered message bodies and
  delivery state. It has many producers plus claim/retry, provider, export,
  deletion, and ops paths. Treat it as a policyless service ledger with fixed
  producer/worker operations and zero ordinary direct table authority.
- `UserReport`, `Block`, and `MakerVerification` contain private trust-and-
  safety or applicant data. Their cross-user, staff, cron, export, and deletion
  paths require explicit operations and projections before grant revocation.
- `SellerProfile` is the largest mixed-row privacy problem. Public profile
  fields share a row with shipping-origin address and phone data, coordinates,
  Stripe identifiers, reconciliation state, and review notes. Row policy alone
  cannot make the same row both public and private. Move private columns into a
  separate owner/staff/service table; use a bounded public projection for the
  profile.
- `CommissionRequest` similarly mixes discoverable request data with buyer
  identity, reference media, and exact location. Split or project private
  location/identity data before RLS.

### Grant hardening is useful but is not an immediate one-line change

- `SystemAuditLog` is structurally append-only in current source and should
  lose ordinary UPDATE and DELETE. Preserve narrow append and reviewed read
  paths.
- `AdminAuditLog` has legitimate undo and account-deletion redaction updates.
  Replace those mutations with narrow operations before revoking UPDATE and
  DELETE.
- `EmailSuppression`, `EmailFailureCount`, and `NewsletterSubscriber` are
  service-oriented, but anonymous subscription/confirmation, webhook, mail,
  export, and deletion paths mean they need explicit functions or a dedicated
  role rather than only a blanket revoke.

### Owner-scoped tables can be grouped, but a plain policy is incomplete

`Cart`, `CartItem`, `Favorite`, `Follow`, `SavedBlogPost`,
`StockNotification`, and `ReviewVote` are cheaper than Order to isolate, and
several already have centralized owner-access helpers. They also participate in
checkout restore, public aggregates, seller analytics, listing cleanup,
fanout, export, and account deletion. Each group needs those service paths made
explicit before an owner policy such as
`userId = current_setting('app.user_id', true)` can safely become authoritative.
`withDbUserContext()` already provides a transaction-local, server-derived
identity primitive; protected callers must actually use it.

### Do not skip public, derived, or operations tables

Public website visibility justifies bounded SELECT, not broad INSERT, UPDATE,
and DELETE. `Listing`, `Photo`, variants, `BlogPost`, and `BlogComment` also
contain draft, private, moderation, or seller-write states. `CommissionInterest`
is private. `CronRun` and `ResendWebhookEvent` are service ledgers. Metrics and
snapshot tables may be publicly readable, but their writes should be limited to
reviewed service operations. These tables can use public projections, read-only
runtime grants, or policyless service boundaries; they should not remain a
permanent broad-CRUD exception.

## Recommended sequence

1. Remove the highest-impact mixed-row exposure: follow
   `docs/seller-profile-private-boundary-pre-rls-audit.md` to add a compatible
   one-to-one private operational row, convert application and effective SQL
   function callers, drain predecessors, then retire old private columns.
   Keep CommissionRequest separate because its principals and lifecycle differ.
2. Close the recursive SellerProfile projection guard while converting callers;
   the current narrow public projections do not substitute for a class-wide
   future-change guard.
3. Isolate service ledgers in two small groups: email delivery/provider tables,
   then SystemAuditLog/AdminAuditLog. Preserve only fixed producer, worker,
   undo, redaction, and reviewed-read operations.
4. Isolate private workflow tables: SupportRequest, then
   UserReport/Block/MakerVerification.
5. Convert owner tables in bounded groups: Cart/CartItem/SavedBlogPost first;
   Favorite/Follow/StockNotification/ReviewVote second after aggregate and
   fanout paths have explicit authority.
6. Close public and derived tables by giving ordinary runtime only bounded
   public reads and moving writes to owner or service authority.

These releases can be smaller than Order. They still need a caller inventory,
an authority matrix, disposable PostgreSQL proof, a guarded grant transition,
and one relevant postflight. They do not need the full historical Order suite
or a separate multi-week workflow for every individual table.

## Immediate next boundary

The User family and both separately tracked service-ledger FORCE releases are
accepted in Production. The next boundary is SellerProfile Phase 0 additive
preparation. Its audit permits a compatible private companion, backfill,
temporary synchronization and public-safe availability snapshot only. It does
not permit predecessor column removal, grant revocation, RLS activation or a
combined CommissionRequest release.
