# Email service least-privilege audit

## Scope and exact source

This audit covers the current behavior, authority, privacy, concurrency,
recovery, retention and operational access for:

- `NewsletterSubscriber`;
- `EmailSuppression`;
- `ResendWebhookEvent`;
- `EmailOutbox`; and
- the obsolete `EmailFailureCount` predecessor table.

It was completed against exact `origin/main`
`12a4dfc492412ff52ff94d921e20e7026c4cff38` on 2026-11-01. It reviews the
current source after the October email delivery, deletion-fence, provider
eligibility, Resend-receipt and lock-order corrections. Historical migration
implementations are not treated as current behavior except where their latest
function definitions remain installed.

This document authorizes an isolated compatible preparation candidate. It does
not authorize a merge, deployment, Production migration, grant revocation or
RLS activation.

## Intended behavior

The email service must preserve all of these properties:

1. Newsletter signup is enumeration-resistant, rate limited and double opt-in.
   A token is single use, expires, and is only activated by an explicit POST.
   Concurrent signup attempts must not send unbounded confirmation mail.
2. Bounce, complaint and account-deletion suppression cannot be weakened by an
   unsubscribe, resubscribe or provider retry. A one-click unsubscribe may be
   cleared only by the reviewed user action that opts back in.
3. Resend webhooks are verified before database mutation, deduplicated by the
   signed provider event id, safely retryable after local failure, and do not
   turn transient delivery failures into permanent suppression.
4. Outbox enqueue is deduplicated. A worker owns a bounded lease, rechecks the
   recipient before provider contact, uses one provider-idempotency identity,
   and cannot let a stale claim overwrite a newer result.
5. Transactional mail remains independent of optional preference mail. Quotas
   cannot consume the transactional reserve for optional fanout.
6. Account export returns only the account's own current or conflict-filtered
   historical email records. Account deletion cannot read, redact or delete a
   row now owned by another account.
7. Retention and health operations are bounded. They expose counts and safe
   summaries rather than recipient addresses or rendered email bodies.
8. Ordinary application code cannot bulk-read recipient addresses, rendered
   email HTML, confirmation tokens, suppression evidence or webhook errors.

## Principals and authority matrix

| Principal | Required operations | Must not receive |
| --- | --- | --- |
| Signed-out newsletter visitor | reserve confirmation, preview one token, confirm one token | subscriber list, address search, arbitrary update/delete |
| Signed unsubscribe holder | disable optional preferences, deactivate matching newsletter subscription, preserve or add one-click suppression | bounce/complaint deletion, unrelated subscriber access |
| Signed-in account owner | clear one-click suppression when opting back in; export own email-service history | another account's email-service rows |
| Account-deletion transaction | fence uncertain provider sends; redact/delete exact owner rows atomically | reused addresses now owned by another account |
| Verified Clerk lifecycle | remove only account-deletion suppression for the provider-confirmed new account address | general suppression mutation |
| Verified Resend webhook | reserve/complete/fail one event and apply hard suppression for its signed recipients | table scans, manual suppression changes, outbox mutation |
| Outbox producer | enqueue one validated, source-bound, deduplicated job | claims, delivery history, arbitrary row update |
| Outbox worker | bounded claim, provider-attempt fence, complete/fail/defer/skip the exact lease | arbitrary recipient/history reads or mutation |
| Operations cron | aggregate health counts and bounded terminal-row pruning | rendered content or recipient lists |
| PIN-verified staff workflow | cancel outbox work for the exact broadcast it deletes | general email history or suppression access |

## Current source inventory

The ordinary runtime role currently has `SELECT, INSERT, UPDATE, DELETE` on all
five tables. Exact-main source uses the following direct operations in addition
to the already fixed outbox and hard-suppression functions.

| Table | Direct current operations |
| --- | --- |
| `NewsletterSubscriber` | anonymous signup reserve/release; token preview and confirmation; signed unsubscribe; owner export; account deletion |
| `EmailSuppression` | suppression lookups; one-click clear/set; Clerk account-reuse cleanup; owner export; account deletion |
| `ResendWebhookEvent` | signed webhook reserve/retry/finish/fail; ops-health count; retention delete |
| `EmailOutbox` | owner export; account and maker-deletion redaction; broadcast cancellation; ops-health counts; retention delete |
| `EmailFailureCount` | owner export and account-deletion cleanup only; no writer remains and the repair migration emptied it |

Existing fixed operations already own the riskier delivery state machine:

- outbox enqueue, claim, defer, provider-attempt, complete, fail and skip;
- the account-deletion uncertain-provider-attempt fence; and
- hard bounce/complaint suppression application.

The remaining direct table operations are not evidence that broad CRUD is
needed. They are the compatibility surface the preparation must replace.

## Workflow and failure-path review

### Newsletter signup and confirmation

The current signup path normalizes and bounds input, hides suppression and
subscription state behind the same success response, reserves a token before
sending, and clears only its exact reservation if sending fails. The unique
email key bounds concurrent first signup. Existing-subscriber resend uses a
conditional cooldown update. Confirmation preview is read-only; confirmation
uses a conditional update inside the same transaction that clears a one-click
suppression.

The compatible authority must preserve those outcomes and must not return
whether an address exists or is suppressed. Token lookup remains indexed and
must return at most one row.

### Unsubscribe and resubscribe

The signed unsubscribe path acquires the shared address fence before changing
User preferences, newsletter state or suppression. It disables optional mail
only. Existing bounce, complaint and account-deletion suppression wins over a
one-click unsubscribe. Confirmation and explicit preference opt-in clear only
`MANUAL/one_click_unsubscribe` evidence.

The replacement must retain the established lock order: User row where one is
owned, then stable account keys, then address keys, then email-table mutation.
It must not reintroduce the corrected account-deletion/email eligibility
deadlock.

### Resend webhooks

The handler verifies the signed payload before reservation. Duplicate signed
event ids are idempotent, stale local work can be retried, permanent bounce and
complaint events use the existing hard-suppression authority, and transient
provider failures are observed without permanent suppression. A handler error
returns a retryable failure and records a bounded error.

The preparation should move reserve/finish/fail and maintenance into fixed
operations. It may bind mutations to the existing claim generation/token
columns, but any such change needs an executed predecessor-versus-candidate
behavior matrix; least-privilege conversion alone must not silently redefine
provider replay semantics.

### Outbox producer and worker

The existing functions validate source identity, enforce dedup identity, bind
claims to generation/token, recheck recipient account/email/preference and
hard suppression immediately before provider contact, protect the provider
idempotency window, and prevent stale claim completion. These functions remain
the delivery authority and should not be rewritten merely for grant cleanup.

The remaining direct access is owner export, deletion/redaction, one exact
staff cancellation, aggregate health and bounded retention. Each can be a
fixed operation without giving ordinary source code table access.

### Export, deletion and retention

Owner export currently derives current and conflict-filtered historical email
keys before reading the four retained tables. Account deletion performs the
same derivation inside a transaction-local actor context, fences uncertain
provider sends, skips unsent mail, redacts retained representations, removes
the address, deletes newsletter state, and preserves hard suppression while
marking other addresses as deleted-account suppressions.

The replacement must derive or verify those keys inside the database boundary;
an arbitrary caller-supplied address list is not owner authority. Batch and
retention operations must keep their current limits and time budgets.

## Findings and closure requirements

### `FIX_BEFORE_ACTIVATION`: broad direct runtime CRUD

All five tables still inherit broad runtime CRUD from
`scripts/provision-runtime-db-role.sql`. This exposes private addresses,
confirmation hashes, rendered email bodies and provider error evidence to any
future app query. Convert every direct caller listed above, prove zero direct
source access, then revoke every runtime/PUBLIC table and column privilege.

### `FIX_BEFORE_ACTIVATION`: queued audience eligibility can become stale

`grainline_email_outbox_begin_provider_attempt` rechecks source-account state,
recipient account/email/preference state and hard suppression. For
`followed_maker_new_listing` and `seller_broadcast`, it does not recheck that
the recipient still follows the maker, that neither side has since blocked the
other, or that the listing is still publicly eligible. A queued optional email
can therefore be sent after a block or after staff removes the listing.

Add a source-specific send-time eligibility result under the same source and
recipient locks. The result must skip rather than fail ineligible optional
mail. Cover block in both directions, unfollow, deleted broadcast, removed or
non-public listing, and unchanged eligible delivery.

### `FIX_BEFORE_ACTIVATION`: owner export and deletion parity

The replacement must retain the existing conflict-filtered historical-address
semantics. Tests must reproduce address reuse by a second live account and
prove that the first account cannot export or delete the second account's
newsletter, suppression or outbox rows.

### `FIX_BEFORE_ACTIVATION`: obsolete `EmailFailureCount`

No writer remains, and `20261023040000_repair_resend_failed_event_suppressions`
emptied the table. Remove the compatibility export/deletion calls, assert the
table is empty before activation, and revoke all runtime/PUBLIC access. Keep
the empty table for now; dropping it is a separate destructive cleanup after a
full-chain inventory.

### `FIX_BEFORE_ACTIVATION`: activation/release skew

Preparation must be additive and predecessor-compatible. The compatible app
must be live and predecessor-pinned traffic drained before the grant-revocation
activation. The activation must be the only pending reviewed migration and
must have a database-first rollback that restores predecessor grants before an
old app can serve traffic.

### `DEFERRED_PRODUCT_WORK`: operator acknowledgement UI

Acknowledgement fields exist on outbox and Resend event rows, but no complete
operator workflow uses them. This does not justify direct table access. A later
staff tool should use a PIN/capability-bound operation and should distinguish
an acknowledged incident from deleting delivery evidence.

### `DEFERRED_PRODUCT_WORK`: physical predecessor-table removal

Dropping `EmailFailureCount` saves negligible space and adds migration risk.
Leave it empty and inaccessible. A later schema-cleanup change may drop it only
after full-function, trigger, view, inspector and full-chain verification.

## Options comparison

### A. Ordinary owner RLS policies

Not a good fit. These rows are not owned by one signed-in user: anonymous
signup, provider webhooks, workers, deletion and retention are the dominant
operations. Policies would still require service functions for nearly every
write and cross-row read.

### B. Dedicated service credential with direct table CRUD

This narrows accidental use of the ordinary runtime credential, but preserves
bulk table authority behind another secret, adds deployment-secret and pool
management, and does not prevent a buggy email route from scanning or mutating
unrelated rows. Account export/deletion would still need fixed cross-boundary
operations.

### C. Fixed-purpose operations plus zero direct runtime authority

Recommended. Complete the existing function boundary, keep producer and worker
operations separate, add bounded export/deletion/maintenance operations, retire
`EmailFailureCount`, and revoke direct runtime/PUBLIC privileges for the whole
group in one activation. This blocks accidental ORM access and bulk dumping
through the runtime credential without a new production secret.

This is an accepted alternative to RLS, not an assertion that the tables are
public or low risk. The grant audit and source guard must pin the zero-direct
posture. Policyless RLS can be layered later without another caller conversion
if its marginal defense is judged worth the release cost.

### D. Policyless ENABLE/FORCE plus the same fixed operations

Strongest defense against a future accidental re-grant, but it requires the
same source conversion as C plus RLS-specific activation/rollback proof. Given
the reviewed direction to finish service ledgers with the lighter pattern, its
incremental protection does not justify another per-table RLS program now.

## Selected design and release shape

**Select Option C as one tightly coupled five-table group.**

1. One additive preparation migration adds the remaining fixed operations,
   send-time audience recheck, exact result validation and source guards.
2. The compatible app converts every direct caller. No behavior-changing table
   or column removal is allowed.
3. A real PostgreSQL 17 behavior suite runs first on current main and then on
   the candidate. It covers signup/confirm/unsubscribe, provider replay,
   outbox claims, block/unfollow/listing removal, owner export/address reuse,
   deletion, health and bounded retention.
4. One protected preparation release applies the additive migration.
5. Deploy and drain the compatible app.
6. One activation migration verifies zero direct callers and an empty
   `EmailFailureCount`, revokes all table/column privileges from ordinary
   runtime and PUBLIC for all five tables, and pins the exact function catalog.
7. The database-first rollback restores predecessor grants before rollback app
   traffic is permitted.

## Go/no-go

**GO for the isolated Option C preparation. NO-GO for activation, merge,
deployment or Production changes.**

Activation remains blocked until every `FIX_BEFORE_ACTIVATION` item above has
executed PostgreSQL 17 behavior evidence, the compatible app is deployed and
drained, and the exact grant/function/rollback catalog is independently
reviewed.
