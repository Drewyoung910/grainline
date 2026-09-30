# Order post-FORCE application fixes — 2026-09-30

This is a sanitized continuation checkpoint. It contains no credential, database URL, session value, row data, or provider response.

## Accepted boundary

Core `Order` FORCE RLS is live and accepted on main `52b78554b795a5e4b2035c8dd05695cbda790a47`. `OrderItem` and `OrderShippingRateQuote` runtime authority is already revoked and accepted. Do not repeat ENABLE, the child-table runtime lock, FORCE, their accepted CI suites, or their Production postflights.

## #124 blocked-checkout refund retry

Independent source review confirmed that a blocked-checkout failure before any provider refund outcome was recorded as `provider_failure` and then swallowed. That allowed the signed Stripe event to finish successfully without a refund attempt. Ambiguous provider outcomes already had a separate durable fence and were rethrown.

Fix commit `d9d54d4e31faedc8bb40f305d81ea5c9ffe65841` preserves the staff-review record and rethrows only the pre-provider failure through the existing idempotent-event wrapper. The wrapper marks the event failed and the route returns HTTP 500, allowing Stripe to retry. It changes two files by ten added lines and has no migration. Follow-up commit `c74a6ba52b3f5108c737177d2dc134aad48c1ff3` changes only `package-lock.json`, updating production transitive `brace-expansion` from vulnerable `5.0.9` to patched `5.0.12` and its dev-only 1.x copy to `1.1.21`. CI exposed two stale exact-version assertions; commit `b67980c72de377107ec05b04efa4f78710c65500` aligns those assertions to the reviewed patched lockfile. Git-integrated Vercel deployment remains disabled by `vercel.json`.

- Public draft PR: `#481`
- Exact base/head: `52b78554b795a5e4b2035c8dd05695cbda790a47` / `b67980c72de377107ec05b04efa4f78710c65500`
- Private backups: `recovery/order-blocked-refund-retry-main-d9d54d4e-20260930`, `recovery/order-blocked-refund-retry-main-c74a6ba5-20260930`, and exact current head `recovery/order-blocked-refund-retry-main-b67980c7-20260930`
- Focused validation: payment/fulfillment observability `31/31`, targeted ESLint, `git diff --check`, and the repository dependency audit with zero high/critical findings
- First full CI `36661859662` passed source, database, type, lint, and test steps, then failed only because npm published a new high-severity `brace-expansion` advisory during the run. The corrected-lock run `36664141235` reached 4,906 passing tests and failed only on the stale `5.0.9` expectation. Exact-head CI `36666839644` and its three automatic specialized checks are now running on `b67980c7`; do not manually start another broad run.

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

## #143 private custom-listing hide trap

Independent review confirmed that `HIDDEN + isPrivate` is the application's archive marker while both seller management surfaces still offered the ordinary Hide action for active private custom listings. Once hidden, the same archive predicate removed the link, edit, publish, and unhide controls. The correction rejects private listings in the shared server-side hide boundary and removes Hide from both seller UIs for private listings. The explicit Archive action remains available. No schema or historical row is rewritten.

- Exact integrated commit: `2d57619f475883eb59f2222b01d4cfae777dd5b1`
- Focused validation: listing action state `8/8`, targeted ESLint, and `git diff --check`

## #136 custom-order buyer availability and delivery result

Independent review confirmed both halves of the report. The installed `grainline_conversation_lock_pair_core` rejects banned or deleted participants and either direction of a block, and `grainline_message_send_custom_order_ready` calls it before writing the ready card. The create action previously performed no equivalent preflight, inserted and activated the listing first, ignored the helper's refusal result, and redirected the seller without an explanation.

The correction reuses `grainline_conversation_start` with the already-existing conversation and a null listing context before upload verification or insertion. That public authority invokes the same locked pair guard and must return the same conversation id. The ready helper now distinguishes delivery from creation so a valid deduplicated message is not mistaken for failure. If availability changes after preflight and the final ready write is refused, the new listing is returned from `ACTIVE` to editable `DRAFT`, and the seller receives explicit recovery steps instead of retrying into duplicates. The custom form also uses the repository's existing Enter-submit and preserve-on-error safeguards, associates its primary labels, and exposes its enforced input lengths.

- Exact integrated commit: `4b59aebfd971a15cdc3297723b2ba1bba3b3d429`
- Focused validation: `64/64` custom-order/UI/authority checks, targeted ESLint, TypeScript, and `git diff --check`
- Exact private backup: `recovery/order-post-force-app-fixes-main-4b59aebf-20260930`

## #138 listing photo/original pairing and verification

Independent review confirmed the create-path half of the report. New and custom listing creation independently filtered submitted photo URLs and their original-image URLs, then paired the surviving arrays by index. A failed verification in either array could silently shift the remaining association, and failed primary uploads were silently omitted. The edit path already uses a structured manifest, preserves existing photo identities and pairs, and rejects any failed new-upload verification; it did not require a correction.

The correction preserves submitted array positions, verifies each exact primary/original pair through the existing account-owned direct-upload authority, deduplicates identical verification work, and fails the action visibly if any pair is missing, misaligned, or unverified. Legacy create submissions without separate originals retain the primary URL as their original. Alt-text positions are preserved with the photo pairs.

- Exact integrated commit: `3cc2700d6a2a0de5bd949b1e68411d1db571fed8`
- Focused validation: `41/41` upload, direct-upload lifecycle/reference, and custom-order checks; targeted ESLint, TypeScript, and `git diff --check`
- Exact private backup: `recovery/order-post-force-app-fixes-main-3cc2700d-20260930`

## Integrated source and Production boundary

The seven fixes are integrated as ten reviewable commits on private branch `codex/order-post-force-app-fixes-main-20260930`, exact head `3cc2700d6a2a0de5bd949b1e68411d1db571fed8`, directly descended from pre-CI-correction #481 head `c74a6ba5`. Exact current private backup is `recovery/order-post-force-app-fixes-main-3cc2700d-20260930`; the earlier backups remain intact. After #481 merges, rebase this stack onto its exact merge commit so the public PR contains the two-line `b67980c7` test correction only through main.

The integrated stack passes the existing `31/31` focused behavior/database/workflow checks, `30/30` focused messaging/authority checks, `8/8` listing-state checks, `64/64` custom-order/UI/authority checks, and `41/41` upload/direct-upload checks, plus targeted ESLint, TypeScript, Prisma schema validation, YAML parsing, and `git diff --check`. Commit `91739f91` also aligns the staff-thread test with the already-implemented session-bound PIN requirement. It adds a manual Production-environment workflow that:

- binds dispatch to exact main and a successful exact-main push CI;
- accepts only the two exact checksummed post-FORCE migrations;
- performs the count-only `shipsWithinDays` compatibility preflight before mutation;
- proves exact ledgers, the validated constraint, exact paid-checkout function source and grants, and unchanged Listing/Core Order RLS posture;
- never deploys the app, moves aliases, or changes RLS/grants.

CI now explicitly isolates both new migrations until the already-accepted Core FORCE predecessor has been applied in disposable PostgreSQL, then applies only the two successors. This prevents an older historical paid-checkout migration from overwriting the new function during the long compatibility sequence.

## Forward sequence

1. Let #481 exact-head CI `36666839644` and its automatically triggered specialized checks finish; do not start a duplicate broad run.
2. If every required #481 check passes with unchanged base/head, merge the source fix and use the automatically triggered merged-main CI as the only final source readback.
3. Rebase integrated head `3cc2700d` onto the exact #481 merge, re-run only affected focused checks, and publish that exact rebased head so its public PR contains the seven reviewed post-FORCE fixes and guarded release wiring without duplicating #481.
4. Merge that source stack only on unchanged exact head/base with its one required automatic CI. Do not deploy the app merely because source merges.
5. After successful merged-main CI, dispatch the manual post-FORCE Production workflow only with a separately reviewed exact main/CI binding. Its read-only preflight must report zero invalid fulfillment rows before either migration runs.
6. Continue the remaining independently verified launch queue after these corrections; do not reopen accepted Core Order RLS work.
