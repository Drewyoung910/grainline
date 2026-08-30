# OrderPaymentEvent fixed read authority

Status: production compatibility accepted. Guarded run `33296422900`, bound to
exact main `513053dc6f2f6fb527f85e45fe3a18a8317fa701`, main CI
`33295803412` and aggregate inspection `33296114340`, applied only this
migration, converged the five exact runtime function grants, and passed
migration status, the global grant/RLS audit and the exact post-application
scope proof. The distinct actual pooled-runtime postflight then passed all
seven engine-read-only checks with sanitized mode-`0600` evidence SHA-256
`da16187441681f0bf5bfd394cb3ec14c59ea5fc0f496812ae20bb5d4b0749a17`.
`OrderPaymentEvent` RLS remains off and predecessor runtime CRUD remains intact.
The converted application is live from exact main
`07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8`, exact-main CI
`33297246142`, as READY Vercel production deployment
`dpl_7UeENeZebXL9yL481DWrXkDpWd4R`. This is compatible application evidence,
not RLS activation evidence.

## Why this release exists

`OrderPaymentEvent` is a private service ledger. Buyers and sellers need a
small refund outcome, account exports need bounded refund history, and staff
need a bounded support timeline. None of those callers needs arbitrary ledger
`SELECT`, raw metadata, or a generic row lookup.

Migration `20260829020000_prepare_order_payment_event_read_authority`
(SHA-256
`8d3d5c8545ec221619fbb3e6bf47cd75e595ec3c854808ca21a3263ff4eae2c3`)
therefore adds exactly five fixed `SECURITY DEFINER` projections after the
separately sealed invariant migration:

1. buyer refund outcomes for at most 100 distinct requested Orders;
2. seller refund outcomes for at most 100 Orders owned through the durable
   `Order.sellerProfileId -> SellerProfile.userId` relationship;
3. buyer refund-only account-export pages;
4. seller refund-only account-export pages with the bounded accounting reason;
5. an active staff-only timeline for one Order, limited to 25 rows.

Every function is `STABLE`, `PARALLEL SAFE`, `SECURITY DEFINER`, pins
`search_path = pg_catalog`, uses fully qualified relations, revokes `PUBLIC`
execution, and grants only the exact identity to `grainline_app_runtime`.
There is no arbitrary predicate, event-id enumeration, generic lookup, write,
cleanup, or dynamic SQL function.

## Projection boundaries

- Buyer and seller UI projections return only refund amount, currency, status,
  and a UTC epoch-millisecond creation time. Failed/canceled refunds retain the
  predecessor non-blocking semantics and are omitted.
- Buyer export excludes provider identities, internal descriptions, reasons,
  and metadata. Seller export additionally receives only the existing bounded
  refund reason; it still receives no provider identity or metadata.
- Staff receives provider event/object identifiers needed for support and only
  four selected `refundAccounting` fields. The arbitrary metadata document is
  never returned.
- Export pagination uses the immutable `(createdAt, id)` order with a UTC
  epoch-millisecond cursor. This avoids the repository's historical
  timestamp-without-time-zone parsing bug and prevents offset pagination drift.

The application supplies only its server-resolved local actor id. Clerk
authentication, current route authorization, session freshness and the Admin
PIN remain application boundaries; PostgreSQL cannot attest a Clerk session.
The fixed functions re-derive the requested Order relationship and current
staff role, removing arbitrary cross-user table reads from normal application
paths without claiming resistance to a fully compromised runtime process that
can deliberately impersonate a known actor id.

## Compatibility and proof boundary

This is additive preparation. It intentionally does not enable or force RLS,
create a policy, or change predecessor `OrderPaymentEvent` table privileges.
Old and new Vercel instances may coexist until the converted application is
deployed and every predecessor is drained.

The disposable PostgreSQL proof covers cross-buyer and cross-seller isolation,
active/banned staff behavior, distinct export columns, keyset pagination,
function owner/mode/config/ACLs, explicit parameter types, and retained
predecessor CRUD. CI additionally runs the proof through separate `ci` owner
and `grainline_app_runtime` logins in a disposable schema. Production
application, migration and RLS state remain unchanged until a later explicit
release.

The dedicated production runner is restart-safe and exact-main/CI/inspection
bound. Before application it accepts only the exact invariant predecessor or
the exact already-applied read-authority catalog. Its scope verifier runs in an
engine-attested repeatable-read/read-only transaction and compares all five
live function bodies, owners, modes, search paths and ACLs to the byte-pinned
migration. Both the generic migration runner and the invariant-only runner
verify and isolate this successor, so neither can apply it incidentally.

CI does not weaken or impersonate that production runner. Its separate scope
entrypoint accepts only GitHub's `CI` workflow on a `pull_request` or `push`,
the loopback `grainline_ci` database, the exact `ci` owner identity and
`sslmode=disable`. It then attests `current_user`, opens a repeatable-read
read-only transaction, reuses the production snapshot reader and asserts the
same catalog with the explicit disposable owner role. A production/Neon URL,
manual workflow event or ordinary runtime identity is rejected before connect.

The pooled-runtime production postflight ran from the exact clean release
commit with main CI `33295803412`, invariant run `33296358390` and read run
`33296422900`. Inside an engine-attested repeatable-read read-only transaction
it proved the restricted runtime identity, exact five function
bodies/modes/search paths/ACLs, retained predecessor CRUD/RLS-off compatibility,
zero-row absent buyer/seller projections and denial of the staff timeline to a
non-staff marker. It exported no production row and changed no production
state. Two initial local invocations failed before connecting or writing
evidence because the shell-only `.env.local` extractor misparsed the quoted
URL; the corrected secret-safe extractor preserved the same reviewed database
boundary and the accepted evidence is the sole successful artifact.

## Remaining activation gates

This release converts participant pages, the staff order timeline and account
export only. Direct transition predicates, aggregates, webhook reads and local
evidence writes remain in the audited source inventory. They must move behind
separately source-bound fixed operations before the zero-direct-access gate can
pass. After compatible deployment and predecessor drain, policyless `ENABLE`
plus table-grant revocation and posture-only `FORCE` remain separate releases
with distinct pooled-runtime postflights.

## Compatible production deployment

PR #338 exact head `ea814719425b78548446ffb03026545232da50d5`
merged as exact main `07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8`.
Exact-main CI `33297246142` passed the sealed PostgreSQL authority/rollback
chain, TypeScript, lint, full tests, dependency audit and production build. A
manual Vercel Production deployment from a clean detached worktree at that
exact commit produced `dpl_7UeENeZebXL9yL481DWrXkDpWd4R`, URL
`grainline-iji9ggah6-drew-youngs-projects.vercel.app`, with target production
and state READY. `thegrainline.com`, `www.thegrainline.com`,
`grainline.vercel.app` and `grainline-drew-youngs-projects.vercel.app` resolve
to that deployment; both tested public health aliases returned
`{"ok":true}`. The build-time database guard attested the pooled production
`grainline_app_runtime` identity.

The Vercel CLI lost its final API fetch after the remote build completed and
reported `deploy_failed`. No retry was issued. Exact deployment inspection
proved that the same deployment had finalized READY and received the canonical
aliases; this was a CLI transport/reporting failure, not a second deployment or
failed build. Predecessor deployment `dpl_2WkGbkiDdD8ySQYnCTur7ND3n2kd`
remains READY and was not drained. No migration, grant, RLS, credential,
provider or production-row change was part of this application deployment.
