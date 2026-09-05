# Order staff read authority

Status: isolated database-first application-conversion candidate. It has not been merged,
applied, granted to a login role or deployed. `Order` RLS remains off. The
converted pages intentionally cannot run until the separately proven credential
boundary is installed.

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

The original functions predate the later nullable, signed
`Order.chargedTotalCents` witness. Migration
`20260905010000_correct_order_staff_read_charged_total` adds dormant `*_v2`
wrappers which preserve the original fixed projections and include that exact
witness. The wrappers grant nothing; the original variants remain revoked and
are not application entry points. This avoids editing a previously applied
migration while preventing staff pages from silently falling back to a
component reconstruction when provider evidence exists.

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

## 2026-09-05 application conversion checkpoint

The all-Orders queue, review-needed queue and staff Order detail page now call
the corrected `*_v2` fixed projections through a lazy, server-only Prisma client
backed only by `ORDER_STAFF_READ_DATABASE_URL`. The client requires a direct
`grainline_staff_read_runtime` login on the same pooled database as the
ordinary runtime and has an independent two-connection cap. It has no fallback
to `DATABASE_URL`; missing or malformed credential state fails closed.

The Vercel database isolation guard now treats this one exact additional URL as
reviewed only when it is pooled, authenticates as the dedicated role and maps
to the same reviewed endpoint, region and database as `DATABASE_URL`.
Production builds require it. Every other PostgreSQL URL-shaped variable and
all owner/migration variables remain rejected.

This conversion also makes the two queues consistent: both render title and
seller identity from the immutable checkout snapshot. Previously the flagged
queue joined mutable current Listings while the ordinary admin queue used the
snapshot. Detail links are offered only when the current Listing is still
active, while historical display data remains snapshot-backed.

The conversion preserves exact payment display semantics: both queues and the
detail screen prefer the signed nullable `chargedTotalCents` witness and use
the legacy component reconstruction only when that witness is absent. This was
caught during the pre-RLS functionality audit before the converted application
was committed or deployed.

The three ordinary staff Order screens reduce the candidate direct `Order`
source inventory from six to three. The staff Case detail now composes the
already-protected Case read with the same corrected staff Order detail, checks
the buyer/seller relationship across both results, and uses immutable item
titles plus current inventory type only for restoration eligibility. That
reduces the inventory again from three to two. The remaining sources are the
Stripe webhook service path and account-deletion path; each needs a distinct
fixed authority rather than access through the staff credential.

The required release sequence remains database first: provision and prove the
login, grant only the two corrected functions, install the production secret, merge and
deploy the converted application, exercise both queues and detail through the
actual pooled session, drain predecessors, then revoke superseded direct
authority. This local checkpoint does not authorize any of those operations.

State-changing admin actions, refund reconciliation, participant export,
eligibility and aggregate operations remain separate O2/O3 families. This
candidate does not authorize a role, credential, migration run, deployment,
RLS activation, table-grant change or provider mutation.

## 2026-09-05 role-grant convergence checkpoint

`scripts/provision-order-staff-read-role.sql` now stages the credential-free
half of the dedicated-role release. It refuses a missing, colliding, inherited,
privileged or membership-bearing login; permits only Neon's exact non-effective
`cloud_admin` bootstrap member edge; removes direct table, column, sequence and
function grants; rejects default-privilege authority; and grants only the two
corrected `*_v2` projections. It also proves that `PUBLIC` and
`grainline_app_runtime` cannot execute those projections and that the staff
role cannot execute any other `SECURITY DEFINER` function.

This script intentionally cannot create the role or set its password. A
separate restart-safe provider operator must generate the credential, create
and authenticate the exact `LOGIN NOINHERIT NOBYPASSRLS` role, install only the
sensitive Production `ORDER_STAFF_READ_DATABASE_URL`, and retain sanitized
evidence. The projection functions must exist before grant convergence, so the
production order is: create the authority-free login and install its secret;
apply the compatible Order prefix; converge the two grants; deploy and smoke
the converted application. No action in this checkpoint changes production.

The real-PostgreSQL proof at
`tests/order-staff-read-role-provision-postgres.test.mjs` creates the restricted
role only after validating the exact loopback `ci`/`grainline_ci` connection
and checking database/session identity, runs the
convergence SQL, authenticates through the separate login, proves direct Order
denial and the exact empty result for an unknown staff actor, and removes the role.
It also checks successful replay, attribute/membership/PUBLIC-execution drift,
and transactional grant rollback after a default-privilege refusal. It is skipped
unless `ORDER_STAFF_READ_ROLE_PROVISION_PROOF_DATABASE_URL` is explicitly set.
CI wiring uses a literal loopback URL for its PostgreSQL 16 service, not a
production variable. Host/service overrides and non-CI credentials are refused;
psql startup files and ambient database/provider environment are not inherited.

The initial harness did not enforce its documented disposable target and
accepted unexpected SQL errors from the staff projection. Both were corrected
before CI execution. The grant script also now resolves PUBLIC authority using
ACL grantee zero, protects sequence privilege checks with a CASE expression,
and rejects substituted staff/runtime role names. A separate PGlite test
executes the actual final catalog query against minimal fixtures; it does not
substitute for the network-login proof. No production grant or credential has
been changed by this preparation. Full CI execution remains a release gate.

Validation checkpoint `dafe0c6c` is pushed on
`agent/order-staff-read-role-preparation-20260905`. Local full-suite validation
reported 4,223 tests: 4,212 passed, 11 skipped, zero failures. The newly added
catalog regression was run separately alongside the focused target/grant
tests (six passed, zero failures). TypeScript and lint passed; the helper,
which the default lint configuration ignores, was also linted with
`--no-ignore`. The network-login proof remains skipped locally because there
is no disposable PostgreSQL server. Do not describe it as passed.

PR #429 remains draft at `2958fbb1fd0b2d3bcc70f6ba57d7a3e9358653d6`;
CI `33977320851` was reverified successful for that exact predecessor.
The permission reviewer allowed pushing the follow-up branch but rejected
opening its draft PR, citing publication authorization. No follow-up PR or CI
run was created. Next: open the isolated follow-up draft with authorization,
obtain successful PostgreSQL 16 login/convergence proof, then finish review
before any merge or production credential/grant work. The existing security
plugin scan was not completed and provides no security approval.
