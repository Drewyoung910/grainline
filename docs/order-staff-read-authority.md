# Order staff read authority

Status: isolated dormant compatibility candidate. It has not been merged,
applied, granted to a login role, deployed or used by application pages.
`Order` RLS remains off.

Prepared: 2026-08-31

## Decision

Staff Order queues and support details contain a materially broader data class
than participant projections: buyer PII and addresses, internal review notes,
refund identity and operational reconciliation state. They must not be
callable by the shared `grainline_app_runtime` credential merely because the
caller supplies the ID of an EMPLOYEE or ADMIN.

Migration `20260901020000_prepare_order_staff_read_authority` therefore adds
two dormant fixed functions:

- `grainline_order_staff_page(text, text, integer, integer)`; and
- `grainline_order_staff_detail(text, text)`.

Both require `SESSION_USER = grainline_staff_read_runtime` and independently
revalidate that the supplied actor row exists, is not banned or deleted, and
has role EMPLOYEE or ADMIN. The migration revokes `PUBLIC` and ordinary
runtime execution and grants execution to no login. A separate later release
must provision and prove the dedicated login before it can grant these
functions or convert application readers.

The Clerk session, staff role and Admin-PIN checks remain mandatory application
controls. The dedicated database role is an additional credential boundary:
ordinary marketplace queries and SQL mistakes using `DATABASE_URL` cannot call
staff projections. Arbitrary code execution that can exfiltrate every
application secret remains outside what database RLS alone can solve.

## Fixed exposure boundary

The queue accepts only `ALL` or `REVIEW_NEEDED`, pages from 1 through 1000 and
page sizes from 1 through 50. It returns totals, fulfillment/review state,
buyer and seller labels, internal review note, and only the first three fixed
historical item summaries plus a total item count. It returns no Stripe,
Shippo, refund, claim or label-provider identifiers.

The detail projection returns the fields currently needed by the PIN-gated
support page: retained buyer/address, totals, fulfillment timeline, quoted
shipping comparison, internal review note, derived refund/claim state, a
completed provider refund ID for reconciliation, label state, and at most 100
fixed-key historical items. Raw checkout, charge, transfer, application-fee,
Shippo and claim identifiers not used by that screen remain excluded. Payment
event and Case information stay in their already protected fixed projections.

Current Listing data is limited to `listingActive` and
`currentListingType`. The first is catalog-link context; the second is needed
by the staff Case refund screen to determine whether the current inventory row
can be restored. Historical title, image, seller and selected options continue
to come from the stripped checkout snapshot.

## Proof and release boundary

Disposable PostgreSQL proves ordinary-runtime execution denial, exact
dedicated-session enforcement, live staff-row revalidation, fixed queue scope,
provider-ID exclusion from queues, JSON key stripping, malformed-input
rejection and the 100-item detail cap. TypeScript parsers validate every
result and intentionally require a caller-supplied database client; there is
no fallback to the ordinary Prisma runtime connection.

Before application conversion, a separate release must:

1. provision `grainline_staff_read_runtime` as LOGIN, NOINHERIT,
   NOBYPASSRLS, membership-free and without table privileges;
2. install its secret outside the ordinary `DATABASE_URL` and migration-owner
   paths;
3. grant only the two reviewed functions;
4. prove the ordinary runtime cannot execute either function and the staff
   role cannot read base tables;
5. bind the PIN-gated pages to a dedicated client with bounded pooling; and
6. rotate/revoke and remove that credential if the isolated proof aborts.

State-changing admin actions, refund reconciliation, participant export,
eligibility and aggregate operations remain separate O2/O3 families. This
candidate does not authorize a role, credential, migration run, deployment,
RLS activation, table-grant change or provider mutation.
