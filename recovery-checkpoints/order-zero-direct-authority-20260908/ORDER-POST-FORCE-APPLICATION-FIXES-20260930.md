# Order post-FORCE application fixes — 2026-09-30

This is a sanitized continuation checkpoint. It contains no credential, database URL, session value, row data, or provider response.

## Accepted boundary

Core `Order` FORCE RLS is live and accepted on main `52b78554b795a5e4b2035c8dd05695cbda790a47`. `OrderItem` and `OrderShippingRateQuote` runtime authority is already revoked and accepted. Do not repeat ENABLE, the child-table runtime lock, FORCE, their accepted CI suites, or their Production postflights.

## #124 blocked-checkout refund retry

Independent source review confirmed that a blocked-checkout failure before any provider refund outcome was recorded as `provider_failure` and then swallowed. That allowed the signed Stripe event to finish successfully without a refund attempt. Ambiguous provider outcomes already had a separate durable fence and were rethrown.

Fix commit `d9d54d4e31faedc8bb40f305d81ea5c9ffe65841` preserves the staff-review record and rethrows only the pre-provider failure through the existing idempotent-event wrapper. The wrapper marks the event failed and the route returns HTTP 500, allowing Stripe to retry. It changes two files by ten added lines and has no migration. Follow-up commit `c74a6ba52b3f5108c737177d2dc134aad48c1ff3` changes only `package-lock.json`, updating production transitive `brace-expansion` from vulnerable `5.0.9` to patched `5.0.12` and its dev-only 1.x copy to `1.1.21`. Git-integrated Vercel deployment remains disabled by `vercel.json`.

- Public draft PR: `#481`
- Exact base/head: `52b78554b795a5e4b2035c8dd05695cbda790a47` / `c74a6ba52b3f5108c737177d2dc134aad48c1ff3`
- Private backups: `recovery/order-blocked-refund-retry-main-d9d54d4e-20260930` and exact current head `recovery/order-blocked-refund-retry-main-c74a6ba5-20260930`
- Focused validation: payment/fulfillment observability `31/31`, targeted ESLint, `git diff --check`, and the repository dependency audit with zero high/critical findings
- First full CI `36661859662` passed source, database, type, lint, and test steps, then failed only because npm published a new high-severity `brace-expansion` advisory during the run. Replacement exact-head CI is `36664141235`; do not manually start another broad run.

Do not merge if the exact head/base changes or any required check fails.

## #120 staff-preview PIN boundary

Independent review confirmed that an active staff account could view reported message threads and nonpublic listing states outside `/admin` without first satisfying the admin PIN challenge. The prepared correction requires the existing session-bound PIN before a nonparticipant reported-thread page or polling API reads users/messages, and before `?preview=admin` grants nonpublic listing visibility. Participant messaging, seller listing access, reserved-buyer access, and public listing access retain their existing paths.

The rebased current stack commit is `6f6ad0ba7fca12d48932c5209a82dff05fac5682`, parented directly on corrected #481 head `c74a6ba5`. It remains private and unmerged.

- Private backup: `recovery/staff-preview-pin-main-55645df1-20260930`
- Focused validation: staff PIN boundary `3/3`, targeted ESLint, and `git diff --check`

Publish only after #481 lands so the public diff contains only the reviewed #120 and later selected changes.

## #122 listing fulfillment bounds

Independent review confirmed that listing mutations accepted unbounded positive `shipsWithinDays`, which feeds paid-checkout delivery estimates and the not-received Case clock. The prepared correction centralizes whole-day parsing at `1..365`, applies it to new/custom/edit mutations, rejects inverted made-to-order ranges, exposes the same maximum in the shared form, and adds a matching validated database CHECK.

The original private patch used migration identity `20260929140000`, which now precedes already-applied Core FORCE migration `20260929160000`. It was not published. The rebuilt current stack uses post-FORCE identity `20260930030000_bound_listing_fulfillment_days` at exact rebased commit `15950a8e38caae22d7e96384d2eae79f14273b0f`, parented on #120 commit `6f6ad0ba`. It remains private, unmerged, and unapplied.

- Private backup: `recovery/listing-delivery-bounds-main-99428ac6-20260930`
- Focused validation: listing fulfillment bounds `4/4`, targeted ESLint, Prisma schema validation, and `git diff --check`
- Production requirement: perform a count-only read-only check for existing non-null `shipsWithinDays` outside `1..365` before applying the validated CHECK. Do not rewrite historical paid-order snapshots.

## #134 paid private custom-listing retirement

Independent review confirmed that `grainline_stripe_checkout_order_create` marked exhausted in-stock listings `SOLD_OUT` but left a successfully purchased private reserved `MADE_TO_ORDER` listing `ACTIVE`. A second Checkout Session could therefore be created for the same one-off custom piece. Existing paid sessions arriving after the first purchase need a fail-closed review/refund result rather than a second valid order.

Successor migration `20260930031000_mark_paid_private_listing_sold` copies the latest paid-checkout authority byte-for-byte except for the reviewed additive transition: after a valid paid Order is created, an active private made-to-order listing reserved for that buyer becomes `SOLD`. Invalid paid completions do not consume it. The reserved buyer may still view the sold listing, while the existing `status === ACTIVE` purchase boundary keeps it non-purchasable. The message card now says `View Custom Piece` instead of promising another purchase.

- Exact rebased commit: `2219043e7be6accfdaaea3d236a5aee9b59db6a0`
- Focused validation: `20/20` source, visibility, and disposable-PostgreSQL checks; the proof creates two paid sessions, accepts the first, rejects the second, and retains `SOLD`
- The source-equivalence test proves the successor differs from applied predecessor `20260926011000` only by its comment and reviewed `SOLD` transition
- Original exact private backup: `recovery/private-custom-paid-sold-main-d69ac66e-20260930`

## #135 custom-order link after seller reactivation

Independent review confirmed that immediate AI approval and staff approval sent the reserved buyer's source-deduplicated ready link, while a seller reactivation through `publishListingAction` could make the private reserved listing `ACTIVE` without sending the chat card, notification, or email. The correction calls the existing database-derived helper only after the guarded `ACTIVE` transition succeeds and only when the listing is private, reserved, and attached to its custom-order conversation. It does not send from the held `PENDING_REVIEW` path.

- Exact integrated commit: `5e2dc204a01afca4d876ea172016a86227e25282`
- Focused validation: `30/30` messaging/authority tests, targeted ESLint, and `git diff --check`
- Original isolated private backup: `recovery/custom-order-reactivation-ready-link-305c29ed-20260930`

## Integrated source and Production boundary

The four fixes are integrated as seven reviewable commits on private branch `codex/order-post-force-app-fixes-main-20260930`, exact head `5e2dc204a01afca4d876ea172016a86227e25282`, directly descended from corrected #481 head `c74a6ba5`. Exact current private backup is `recovery/order-post-force-app-fixes-main-5e2dc204-20260930`; the earlier `9b5ad13f` backup remains intact.

The integrated stack passes the existing `31/31` focused behavior/database/workflow checks plus `30/30` focused messaging/authority checks, targeted ESLint, Prisma schema validation, YAML parsing, and `git diff --check`. Commit `91739f91` also aligns the staff-thread test with the already-implemented session-bound PIN requirement. It adds a manual Production-environment workflow that:

- binds dispatch to exact main and a successful exact-main push CI;
- accepts only the two exact checksummed post-FORCE migrations;
- performs the count-only `shipsWithinDays` compatibility preflight before mutation;
- proves exact ledgers, the validated constraint, exact paid-checkout function source and grants, and unchanged Listing/Core Order RLS posture;
- never deploys the app, moves aliases, or changes RLS/grants.

CI now explicitly isolates both new migrations until the already-accepted Core FORCE predecessor has been applied in disposable PostgreSQL, then applies only the two successors. This prevents an older historical paid-checkout migration from overwriting the new function during the long compatibility sequence.

## Forward sequence

1. Let replacement #481 exact-head CI `36664141235` and its automatically triggered specialized checks finish; do not start a duplicate broad run.
2. If every required #481 check passes with unchanged base/head, merge the source fix and use the automatically triggered merged-main CI as the only final source readback.
3. Publish exact integrated head `5e2dc204` only after #481 lands, so its public PR contains the four reviewed post-FORCE fixes and guarded release wiring without duplicating #481.
4. Merge that source stack only on unchanged exact head/base with its one required automatic CI. Do not deploy the app merely because source merges.
5. After successful merged-main CI, dispatch the manual post-FORCE Production workflow only with a separately reviewed exact main/CI binding. Its read-only preflight must report zero invalid fulfillment rows before either migration runs.
6. Continue the remaining independently verified launch queue after these corrections; do not reopen accepted Core Order RLS work.
