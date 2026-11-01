# SellerBroadcast RLS options

Date: 2026-11-01

Status: Option B selected for isolated design and source preparation under
Drew's standing direction to choose the safest scalable RLS design. This does
not authorize a Production migration, grant change, RLS activation, merge, or
deployment. The required domain audit is
`docs/seller-broadcast-pre-rls-audit.md`.

## Verified starting point

This comparison is based on exact public main
`12a4dfc492412ff52ff94d921e20e7026c4cff38`.
`SellerBroadcast` stores seller-authored text, an optional image, the owning
seller profile, send time, and a delivery count. The runtime role still has
broad direct table authority and no committed migration enables RLS on this
table.

The row is not simply owner-private or simply public:

- a public shop page shows only the latest broadcast for a currently visible
  seller;
- a signed-in follower feed shows bounded recent broadcasts only for followed,
  currently visible, non-blocked sellers;
- the owner sees full paginated history and delivery counts;
- staff search all messages, inspect delivery counts, and delete a broadcast;
- account export and account deletion need complete owner history;
- notification, email-outbox, direct-upload, and deletion-trigger functions
  read or lock the source row; and
- only the delivery worker may change `recipientCount` after insert.

One broad public read policy would therefore disclose historical broadcasts and
owner/staff delivery metadata beyond current application behavior. An owner
policy alone would break the public page, follower feed, and service paths.

## Required invariants

Every option must preserve these properties:

1. Only the active owning seller can create a broadcast, and the durable
   seven-day cooldown remains concurrency-safe.
2. Stored text, image URLs, and direct-upload references retain current
   validation. A failed upload-reference claim cannot leave an untracked
   durable image.
3. Public shop pages receive at most the latest broadcast for a seller already
   proven visible to that viewer. They do not gain history or delivery counts.
4. The account feed returns only bounded recent broadcasts for sellers the
   actor currently follows and can currently see. Reciprocal blocks, inactive
   sellers, bans, and deletion remain fail-closed.
5. The owner can page through only their own history and export only their own
   broadcasts.
6. In-app and email fanout re-check current source, follower, recipient, and
   reciprocal-block eligibility immediately before durable delivery work.
7. Only the exact broadcast delivery path can reduce the provisional in-app
   recipient count. Ordinary owners cannot manufacture counts or rewrite
   message content after creation.
8. Staff reads and deletion remain behind the isolated staff database role,
   application staff/PIN checks, and an atomic audit record. Staff deletion
   also removes pending notification and email fanout.
9. Account deletion removes only the deleted seller's broadcasts and preserves
   upload-release, notification, and email lifecycle behavior.
10. The runtime role and `PUBLIC` have no direct base-table or column authority
    after activation. No security release drops columns or rewrites historical
    content.

## Options

| Option | Shape | Caller conversion | Protection | Rollback | Main limits |
| --- | --- | --- | --- | --- | --- |
| **A. Direct owner/public RLS policies plus service functions** | Add owner writes/reads and public reads through policies; keep fixed functions for cooldown, feed, count updates, staff, export, deletion, upload, notifications, and email. | All 16 direct operations still require review. Insert, update, staff deletion, deletion service, and most reads still need functions because policies cannot express the current output shapes and atomic side effects. | Row filtering protects owner history and can restrict writes to the owner. | Restore predecessor grants after disabling RLS and switching fixed-operation callers back. | A public row policy exposes every qualifying historical broadcast and `recipientCount`, not only the latest bounded projection. An insert policy cannot enforce the cooldown, active-shop rule, upload claim, or fanout invariants atomically. It saves little code while broadening disclosure. |
| **B. Zero direct runtime authority plus purpose-bound operations** | Keep the table intact. Add fixed owner create/history/export, bounded public-latest and actor-feed reads, delivery-count update, isolated-staff list/delete, and deletion-service operations. Retain reviewed notification, email, and upload authorities. Revoke direct authority, then activate policyless ENABLE and FORCE through the shared batch release path. | Convert 16 direct Prisma operations in six source files. Existing source-validating notification, email-owner, direct-upload, and staff-target functions remain but are re-proven under the final posture. | Fail-closed by default. Public and follower results expose only their reviewed shapes; new columns never become public automatically; owners cannot rewrite counts or content; staff work uses the isolated role. | Deploy predecessor-compatible fixed operations first. Emergency rollback restores the exact predecessor CRUD grant and disables RLS before rolling the application back. No data move is required. | More explicit database contracts than Option A. Shared runtime credentials can still invoke granted functions, so actor binding and isolated staff grants remain mandatory. |
| **C. Split content and delivery metadata into companion tables** | Move `recipientCount` or message/image fields into a one-to-one companion and apply different policies to each side. | Every read changes; insert, delivery update, staff deletion, export, deletion, upload, notification, and email paths span both rows. Historical data needs a compatibility backfill. | Physical separation can hide delivery metadata from a public content row. | Maintain both layouts, switch callers back, and do not drop old columns during the security release. | The only non-public scalar is the delivery count. A split adds synchronization and migration risk while public history still needs a bounded latest/feed projection. It does not remove the need for fixed operations. |

## Recommendation and selected design

Use **Option B**.

The application already has three different read semantics for the same row:
latest-public, current-follower feed, and owner/staff history. Fixed operations
express those contracts directly without making historical broadcasts or
delivery counts broadly queryable. The table is small enough that a companion
split has no compensating benefit, while a broad public policy would change
the product's disclosure surface.

Preparation remains additive and reversible:

1. Install the fixed operations while predecessor grants stay intact.
2. Convert callers and prove behavior on the complete PostgreSQL 17 migration
   chain, including concurrency and predecessor compatibility.
3. Retain the preparation's queued-email provider fence, which rechecks the
   current Follow and reciprocal-block relationship immediately before send.
4. Deploy the compatible application before activation.
5. Activate with the shared batch workflow only after zero-direct-caller,
   catalog, grant, rollback, and exact-production-inventory gates pass.

The implementation should reuse the shared preparation and activation
framework. It must not add another table-specific production workflow or a
large family of one-off release scripts.

## Acceptance evidence

Behavior tests must fail on current main where they represent a new boundary,
then pass on the complete PostgreSQL 17 chain for:

- concurrent owner create attempts, proving exactly one seven-day broadcast;
- another seller and a missing actor being unable to create or read history;
- public latest output excluding history and `recipientCount`;
- follower-feed inclusion and exclusion across unfollow, reciprocal block,
  inactive shop, ban, and account deletion;
- email fanout becoming ineligible after unfollow or block before provider
  attempt;
- delivery-count updates bound to the exact owner/source and unable to exceed
  the provisional audience;
- staff pagination/search/delete through the isolated role, with atomic audit,
  notification, outbox, and upload cleanup;
- owner export and multi-step account deletion without cross-owner effects;
- direct runtime/PUBLIC `SELECT`, `INSERT`, `UPDATE`, and `DELETE` denial after
  activation; and
- rollback restoring the predecessor application statements before RLS is
  disabled.

Source-text tests may guard the zero-direct manifest and release catalog, but
they do not count as behavior proof.

## Decision record

- [x] Select Option B for isolated design and source preparation under Drew's
  standing safety/scalability direction (2026-11-01).
- [ ] Authorize merge or Production preparation release.
- [ ] Authorize RLS activation.

