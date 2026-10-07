# User follower authorities pre-RLS audit

Recorded 2026-10-07 from the isolated successor branch
`codex/user-follower-authorities-20261007`, based on exact unpublished
block/email commit `51fa5182b735e18b72fe1e44f9e7043d0085e7d8`. This is an additive source
preparation review. It does not authorize publication, Production SQL,
deployment, table-grant changes, or User RLS activation.

## Scope and intended behavior

This tranche covers three remaining User-dependent workloads:

1. Blog and listing notification fanout must enumerate active, unblocked
   followers from a valid seller source without exposing follower preferences
   or account PII.
2. A signed-in seller broadcast must bind the requested seller profile to the
   authenticated owner, preserve seller-only targeting, notification preference
   filtering, deterministic pagination, and the existing 10,000-recipient cap.
3. Quality scoring must count favorites only for public active listings from
   supported active sellers and active, mutually unblocked favoriters, without
   granting the caller general User visibility.

The source event remains responsible for proving the referenced blog post or
listing is public before notification fanout. These operations narrow the User
dependency; they do not make an unpublished or private source eligible.

## Operation and authority matrix

| Operation | Principal and binding | Returned data | Limits and denials |
| --- | --- | --- | --- |
| `grainline_user_follower_notification_page(text,text,integer)` | Service caller with an already validated seller-bound public source | Follow id and follower id | Deterministic id cursor; 1..1000 rows; excludes the seller owner, banned/deleted followers, and reciprocal blocks |
| `grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)` | Transaction-local `app.user_id`; seller profile must belong to that owner | Follow id, follower id, notification preferences | Deterministic id cursor; 1..1000 rows per page; optional sellers-only filter; excludes self, banned/deleted followers, and reciprocal blocks; application preserves the 10,000-recipient cap |
| `grainline_user_public_listing_favorite_counts(text[])` | Public aggregate caller over an explicit listing batch | Listing id and aggregate count only | 1..200 unique valid ids; only public active listings and supported active sellers; excludes banned/deleted and reciprocally blocked favoriters |

All three functions use static SQL, `SECURITY DEFINER`, and a fixed
`pg_catalog` search path. PUBLIC execute is revoked. Only
`grainline_app_runtime` receives execute. The owner broadcast operation uses
transaction-local actor context; it does not accept an owner id as caller input.
The service fanout operation deliberately omits notification preferences, email,
name, roles, legal fields, and other User columns.

## Product, privacy, and concurrency review

The service fanout and seller broadcast operations are separate because their
data needs differ. Public-source notification jobs need recipient ids only. A
broadcast needs the recipient's structured preference object, so it additionally
requires authenticated seller ownership. Combining them would expose private
preferences to broader service callers.

Both follower operations page by the immutable Follow id in ascending order.
Concurrent follows can appear on a later page; concurrent unfollows can remove a
row before it is read. This matches the existing best-effort notification and
broadcast behavior and does not authorize delivery to an ineligible account.
Every page rechecks account lifecycle and reciprocal blocks. The broadcast loop
stops at exactly 10,000 collected recipients.

Favorite counts are advisory ranking input rather than a financial or inventory
decision. The aggregate operation validates a unique bounded batch, recomputes
public listing and seller eligibility in the database, and returns no favoriter
identity. A concurrent favorite or block can change a subsequent score run, as
it did under the prior read; no durable decision is made from the count.

## Findings and disposition

| Finding | Classification | Resolution in this package |
| --- | --- | --- |
| Follower fanout and seller broadcast traversed Follow to sensitive User lifecycle/preferences | `BLOCKS_RLS_DESIGN` | Split into source-derived id-only and authenticated-owner preference authorities with paging and suppression proof |
| Quality scoring joined Favorite, User, Block, Listing and SellerProfile through raw SQL | `BLOCKS_RLS_DESIGN` | Replaced with a bounded aggregate-only authority; caller receives listing ids and counts only |

No new provider call, payment effect, email delivery, durable job, credential, or
table policy is introduced. Existing source validation and delivery behavior
remain in their callers.

## Verification

Focused source tests pin exact wrapper use, caller source checks, response
validation, pagination, the 10,000-recipient cap, and removal of the raw User
join. The disposable PostgreSQL proof executes the actual migration and covers:

- deterministic follower paging and input bounds;
- active-account, self-follow, and reciprocal-block suppression;
- owner-bound broadcast access, preferences, and sellers-only filtering;
- denial for a foreign owner;
- public listing favorite counts and invalid or duplicate input rejection;
- runtime execute, PUBLIC denial, direct User-table denial, and fixed-path
  definer catalog properties.

Prisma validation, targeted lint, a clean TypeScript typecheck, and the focused
accumulated User CI staging pass. The exact
schema-aware scanner reports zero direct User delegates, **19 visible User
relation edges in eight files**, and **zero raw User SQL calls**. The explicit
callable User catalog is **44 functions: 34 ordinary-runtime and ten private**.
The ten private functions remain the eight isolated staff operations and two
runtime-private trigger functions already classified by the catalog.

## Release decision

**GO** for this isolated additive source package and its focused CI staging.

**NO-GO** for publication, Production SQL, deployment, User table-grant changes,
policies, ENABLE, or FORCE from this document alone. Before User activation:

1. convert or isolate the remaining 19 staff/admin relation edges in eight
   callers while preserving Admin-PIN and staff-session boundaries;
2. compare the complete installed Production function and privilege catalog to
   the source catalog;
3. close the `ClerkWebhookEvent` and `AccountDeletionSideEffect` service-ledger
   dependencies;
4. complete bounded review of opaque query composition and the final
   grant/policy design; and
5. obtain separate exact authorization for every publication, Production SQL,
   deployment, grant, ENABLE, and FORCE action.
