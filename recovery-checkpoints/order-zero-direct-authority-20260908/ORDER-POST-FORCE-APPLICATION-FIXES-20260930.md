# Order post-FORCE application fixes — 2026-09-30

This is a sanitized continuation checkpoint. It contains no credential, database URL, session value, row data, or provider response.

## Accepted boundary

Core `Order` FORCE RLS is live and accepted on main `52b78554b795a5e4b2035c8dd05695cbda790a47`. `OrderItem` and `OrderShippingRateQuote` runtime authority is already revoked and accepted. Do not repeat ENABLE, the child-table runtime lock, FORCE, their accepted CI suites, or their Production postflights.

## #124 blocked-checkout refund retry

Independent source review confirmed that a blocked-checkout failure before any provider refund outcome was recorded as `provider_failure` and then swallowed. That allowed the signed Stripe event to finish successfully without a refund attempt. Ambiguous provider outcomes already had a separate durable fence and were rethrown.

Current-main fix `d9d54d4e31faedc8bb40f305d81ea5c9ffe65841` preserves the staff-review record and rethrows only the pre-provider failure through the existing idempotent-event wrapper. The wrapper marks the event failed and the route returns HTTP 500, allowing Stripe to retry. It changes two files by ten added lines, has no migration, and cannot trigger a Git-integrated Vercel deployment because `vercel.json` keeps `git.deploymentEnabled=false`.

- Public draft PR: `#481`
- Exact base/head: `52b78554b795a5e4b2035c8dd05695cbda790a47` / `d9d54d4e31faedc8bb40f305d81ea5c9ffe65841`
- Private backup: `recovery/order-blocked-refund-retry-main-d9d54d4e-20260930`
- Focused validation: payment/fulfillment observability `31/31`, targeted ESLint, and `git diff --check`
- Specialized PR checks passed; required exact-head full CI `36661859662` remains in progress at this checkpoint.

Do not merge if the exact head/base changes or any required check fails.

## #120 staff-preview PIN boundary

Independent review confirmed that an active staff account could view reported message threads and nonpublic listing states outside `/admin` without first satisfying the admin PIN challenge. The prepared correction requires the existing session-bound PIN before a nonparticipant reported-thread page or polling API reads users/messages, and before `?preview=admin` grants nonpublic listing visibility. Participant messaging, seller listing access, reserved-buyer access, and public listing access retain their existing paths.

The current stack commit is `55645df1461bcee96421efaaf9877b3b98421bce`, parented directly on #481 head `d9d54d4e`. It remains private and unmerged.

- Private backup: `recovery/staff-preview-pin-main-55645df1-20260930`
- Focused validation: staff PIN boundary `3/3`, targeted ESLint, and `git diff --check`

Publish only after #481 lands so the public diff contains only the reviewed #120 and later selected changes.

## #122 listing fulfillment bounds

Independent review confirmed that listing mutations accepted unbounded positive `shipsWithinDays`, which feeds paid-checkout delivery estimates and the not-received Case clock. The prepared correction centralizes whole-day parsing at `1..365`, applies it to new/custom/edit mutations, rejects inverted made-to-order ranges, exposes the same maximum in the shared form, and adds a matching validated database CHECK.

The original private patch used migration identity `20260929140000`, which now precedes already-applied Core FORCE migration `20260929160000`. It was not published. The rebuilt current stack uses post-FORCE identity `20260930030000_bound_listing_fulfillment_days` at exact commit `99428ac66d5bfd2accc1e633cbdedc12ad38132a`, parented on #120 commit `55645df1`. It remains private, unmerged, and unapplied.

- Private backup: `recovery/listing-delivery-bounds-main-99428ac6-20260930`
- Focused validation: listing fulfillment bounds `4/4`, targeted ESLint, Prisma schema validation, and `git diff --check`
- Production requirement: perform a count-only read-only check for existing non-null `shipsWithinDays` outside `1..365` before applying the validated CHECK. Do not rewrite historical paid-order snapshots.

## Forward sequence

1. Let the single automatically required #481 exact-head CI finish; do not start a duplicate broad run.
2. If every required #481 check passes with unchanged head/base, merge the source fix and accept the automatically triggered merged-main CI as the only final source readback.
3. Rebase/read back the private #120/#122 stack against the resulting exact main. Preserve the two commits for review; they may share one source PR to avoid duplicate broad CI, while the #122 Production migration remains a separately guarded action.
4. Before #122 Production SQL, run the count-only invalid-row preflight. Apply only the exact post-FORCE migration after a separate exact binding and approval.
5. Continue the remaining independently verified launch queue after these fixes; do not reopen accepted Core Order RLS work.
