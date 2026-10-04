# User email-delivery pre-RLS audit

## Scope and exact source

This audit covers every current source path that reads `User` identity,
account-state or notification-preference fields for outbound email delivery.
It is based on exact merged main
`235450c09102be70b3487944b00238d85d5b77ec` in isolated worktree
`.worktrees/user-email-delivery-20261004` on 2026-10-04.

The audit is a bounded part of the wider `User` identity/account audit in
[`docs/user-identity-rls-audit.md`](user-identity-rls-audit.md). It does not
authorize User RLS, table-grant changes, deployment or Production SQL.

## Intended behavior

Email delivery must:

- use a server-derived User id or a server-normalized recipient address;
- refuse delivery to banned or deleted accounts;
- honor the exact email-preference allowlist, including the default-off
  `EMAIL_SELLER_BROADCAST` preference and default-on behavior for the other
  email preferences;
- preserve transactional outbox reservation, deduplication, provider
  idempotency, quotas, retries, suppression and sanitized failure reporting;
- distinguish enqueue-time recipient capture from send-time account and
  preference rechecks;
- avoid exposing email, preferences or account-state fields through public or
  client-selected database operations; and
- keep non-email product authority in its existing domain. Email conversion
  must not decide who may open a Case, send a Message, receive a Follow fanout,
  pass Guild review, buy stock or receive a refund.

## Current source inventory

The exact direct-User scanner reports 48 calls in 26 files: 35 `findUnique`,
four `findMany`, one `findFirst`, three `count`, two `update` and three
`updateMany` calls. Seventeen direct reads belong to this first email-delivery
package:

| Surface | Direct User reads | Current purpose |
| --- | ---: | --- |
| `src/lib/notifications.ts` | 1 | active-state and preference decision |
| `src/lib/email.ts` | 1 | inactive-account check by recipient email |
| `src/lib/emailOutbox.ts` | 2 | inactive-account checks by User id or email |
| review delivery | 1 | seller name and email |
| Case open/message/resolution delivery | 5 | buyer or seller name and email |
| ordinary Message delivery | 1 | recipient name and email |
| custom-order request/ready delivery | 3 | seller recipient, buyer display name and buyer recipient |
| back-in-stock delivery | 1 | bounded active recipient batch |
| refund delivery | 2 | buyer name and email in the caller transaction |
| **Total** | **17** | |

The same email domain also reaches `User` through relations rather than direct
delegates:

- five admin Guild verification actions select `sellerProfile.user.email`;
- Guild Member and Guild Master cron batches select User name/email;
- followed-maker listing fanout selects follower email and filters active,
  unblocked accounts;
- seller broadcast selects follower email and notification preferences while
  applying active, block and optional seller-only filters;
- first-listing congratulations selects the seller User email;
- Stripe order confirmation uses an Order-derived email snapshot but separately
  reads the seller's current email preference; and
- the admin broadcast history projects the seller email for an internal page.

Anonymous support, legal-request and newsletter email paths do not depend on a
User row. Clerk welcome delivery uses signed provider data plus the separately
prepared Clerk lifecycle authorities. Order fulfillment and label delivery use
source-validated Order authority results. Those paths remain outside this
User recipient conversion.

## Existing delivery and recovery controls

- `sendRenderedEmail` normalizes recipients, requires one-click unsubscribe in
  configured delivery, checks suppression, applies bounded provider retries,
  sanitizes provider errors and supports provider idempotency keys.
- `EmailOutbox` uses deterministic deduplication, stale-claim recovery, global
  and per-recipient daily quotas, ten-attempt dead-lettering, suppression before
  quota reservation and a 30-day terminal-row retention policy.
- Refund, Case-resolution, fulfillment, label and Stripe confirmation paths
  reserve deterministic outbox work where their domain needs restart-safe
  delivery. Best-effort conversational and review email remains secondary to a
  durable in-app Notification or Message.
- Operations health reports stale/dead outbox work. Account deletion scrubs
  retained recipient addresses and suppression covers bounce, complaint and
  deletion histories.

## Findings

### `FIX_BEFORE_ACTIVATION`: direct and relation-backed User delivery reads

Direct User reads and User relation projections will fail after policyless User
RLS and currently require broad runtime table authority. The first source
package must replace the 17 direct email reads with fixed, runtime-only
recipient and account-state operations. Relation-backed email fields must be
recorded explicitly and converted in this package or a named successor before
User activation.

### `FIX_BEFORE_ACTIVATION`: split preference and recipient lookup

Most immediate-email paths call `shouldSendEmail(...)` and then perform a
second User read for name/email. Account or preference state can change between
those reads. A fixed recipient projection must evaluate active state,
preference and returned address in one database statement. Snapshot-based Order
email may retain a separate boolean preference operation because its email
comes from the already source-validated Order result.

### `FIX_BEFORE_ACTIVATION`: queued address continuity

The outbox currently checks account state by `userId` but does not confirm that
the queued `recipientEmail` is still the current email for that User. A queued
message could therefore be sent to a prior address after a Clerk email change.
The send-time User-id state operation must accept the expected normalized email
and return an explicit `email_changed` outcome. The worker must skip that job
before suppression and quota reservation.

### `BLOCKS_RLS_DESIGN`: generic recipient operation input boundary

A runtime email-recipient operation necessarily returns cross-user contact PII.
Its input must stay server-derived. The package may accept a User id only from a
committed domain result, authenticated actor relationship, claimed delivery row
or bounded server-selected batch. No route parameter or request-body User id may
be passed directly without the existing domain authorization that derives the
recipient. Static caller contracts must retain this boundary.

### `DEFERRED_PRODUCT_WORK`: relation-owned audience selection

Follow/block eligibility, seller-only broadcast selection, Guild state and
admin page history are separate product authorities. This package can replace
their email projection without redefining those rules, but their remaining
active-state/preference relation reads still require named User-family
successors before activation. They may not be hidden by claiming the direct
scanner reached zero.

### `DEFERRED_PRODUCT_WORK`: provider-boundary address race

An immediate send cannot hold a database lock through the external provider
request. A primary email could change after the final database recipient read
and before provider acceptance. The bounded mitigation is to derive the current
address immediately before sending, revoke sessions on real Clerk email change,
and enforce exact-address continuity for queued mail. Moving all best-effort
email to an address-versioned outbox would close the remaining external race,
but is a separate delivery architecture change and is not required for User
RLS preparation.

## Authority design

Prepare additive, fixed `SECURITY DEFINER` functions with
`search_path=pg_catalog`, no dynamic SQL, PUBLIC execution revoked and execution
granted only to `grainline_app_runtime`:

1. one active recipient by User id, optionally requiring one exact validated
   email-preference key, returning only id, name and normalized email;
2. a bounded, deduplicated batch variant with deterministic first-input order;
3. account delivery state by User id plus expected normalized email, returning
   only `active`, `missing`, `banned`, `deleted` or `email_changed`; and
4. account delivery state by normalized email for system mail that has no User
   id, returning the same state without address-continuity comparison.

The TypeScript boundary must strictly validate row shapes and fail closed.
Invalid ids, arrays, preference keys and email inputs must fail with SQLSTATE
`22023`; unknown accounts must not leak any row data.

## Isolated candidate result

The current isolated candidate prepares all four operations and converts the
seventeen direct email-delivery reads. The exact scanner result is now 31 User
delegate calls in 16 files: 19 `findUnique`, three `findMany`, one `findFirst`,
three `count`, two `update` and three `updateMany` calls. That is a reduction of
17 calls and ten files from the accepted `235450c0` baseline. The remaining
calls are deliberately outside this delivery package, including staff search,
moderation, account deletion, ban/unban, public counts, Message participant
state and custom-order seller eligibility.

The same candidate removes delivery-time User email projection from:

- five staff Guild approval, rejection and revocation sends;
- Guild Member and Guild Master maintenance cron sends;
- followed-maker listing fanout;
- seller-broadcast email fanout while retaining its separate in-app preference
  selection;
- first-listing congratulations; and
- the direct review, Case, Message, custom-order, stock and refund paths listed
  above.

The Stripe Order-confirmation snapshot keeps its Order-derived recipient, but
its separate preference check now uses the fixed recipient operation. The
admin broadcast-history email projection remains a staff-read concern and is
explicitly retained for the staff package. Follow/block audience filters,
Guild eligibility/account-age checks, seller active-state guards and in-app
broadcast preferences also remain relation-backed product authority and must be
converted by their named successor packages before User activation.

Queued delivery now binds `userId` to the exact normalized address captured at
enqueue. An address change produces `email_changed` and skips the job before
preference, suppression or quota work. The candidate adds focused source,
PGlite, catalog-inspector and protected-workflow proof; it does not change
Production, table grants, RLS or deployment state.

## Go/no-go and release order

**GO for isolated additive authority and source conversion. NO-GO for User RLS,
grant revocation, deployment or Production SQL.**

1. Add the four fixed operations and strict wrappers.
2. Convert the seventeen direct email reads, including atomic preference/recipient
   lookup and queued-address continuity.
3. Convert relation-backed email projection where it can preserve the existing
   non-email authority without widening scope; record every retained relation
   dependency.
4. Run focused source and disposable PostgreSQL proof, then one exact-head full
   CI for the final public PR.
5. Apply the additive migration through a separately approved protected
   Production workflow before deploying callers.
6. Keep User RLS off until every remaining direct, raw-SQL and relation-backed
   family reaches its reviewed target and the installed-function catalog is
   re-audited.
