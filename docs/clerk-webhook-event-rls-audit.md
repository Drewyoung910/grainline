# ClerkWebhookEvent pre-RLS audit and authority preparation

## Status

The audited compatibility source merged through PR #544 at merge commit
`20815a7b6e6c2d45ed5910f4d9963f09b5948b09`. The source-only Production
inspection and compatibility-migration runner are prepared on isolated branch
`codex/clerk-webhook-event-production-wiring-20261009`. Nothing in this record
claims that the migration, compatible application, grants, RLS, `ENABLE`, or
`FORCE` are live in Production.

The additive compatibility migration is
`20261008120000_prepare_clerk_webhook_event_authority`. It adds a claim
generation and five fixed service operations. It deliberately leaves the
predecessor table grants and RLS posture unchanged so it can land before its
call sites.

## Intended behavior

`ClerkWebhookEvent` is a service-only idempotency ledger for authenticated Svix
deliveries. Ordinary customer and staff requests have no product reason to read
or mutate it. The Clerk route must authenticate the body before reserving an
event, admit one active worker for an immutable event id/type pair, reject stale
worker finalization, retain retryable failures, and acknowledge a duplicate only
after a prior worker completed. The retention cron may delete completed events
older than 90 days in bounded batches. Ops health may read only aggregate issue
counts.

PostgreSQL does not authenticate Clerk. Signature verification remains in the
application route, before database reservation, telemetry, and other side
effects.

## Source inventory

| Operation | Principal | Prepared authority |
| --- | --- | --- |
| Reserve or reclaim delivery | Signed Clerk webhook route | `grainline_clerk_webhook_begin(text,text)` |
| Mark completed | Claim-holding webhook worker | `grainline_clerk_webhook_complete(text,bigint)` |
| Release failed claim | Claim-holding webhook worker | `grainline_clerk_webhook_fail(text,bigint,text)` |
| Prune completed history | Authenticated retention cron | `grainline_clerk_webhook_prune_batch(integer)` |
| Read issue counts | Authenticated ops-health cron | `grainline_clerk_webhook_health_summary()` |

The converted `src/` tree has zero direct `ClerkWebhookEvent` table access.
`scripts/provision-runtime-db-role.sql` still grants predecessor table CRUD in
this compatibility phase and now converges the five optional function ACLs. A
later activation migration must revoke direct table authority and enable RLS.

## Verified findings and fixes

Codex Security scan `093010aa-d9fb-497e-8b12-17fb3acf6783` completed against
source `85934f600f46c3e4b08046888d008970eaf8f171` and reported two low-severity,
high-confidence findings. Both block this ledger's activation even though
neither established account takeover.

1. `webhook.claim-generation-fencing` — a worker could reclaim an event after
   five minutes while the original worker was still running, and the original
   worker could then complete or fail the successor's lease. The prepared
   database authority increments `claimGeneration` for each lease and requires
   the exact generation for both finalizers. A superseded completion fails
   closed.
2. `identity.provider-current-state` — Clerk does not promise webhook ordering,
   but `user.created` and `user.updated` applied identity fields from the event
   snapshot. The route now reads the current user from Clerk after signature
   verification and uses that state for email, name, and image. A missing
   current primary email is omitted from an existing identity update, preserving
   the last confirmed address and avoiding an unintended session revocation.
   For a new local identity, the database authority creates its deterministic
   placeholder because the route supplies no email field.
3. `identity.provider-absent-terminal-event` — a signed create/update delivery
   can be processed after the provider account has already been deleted. A
   Clerk API 404 is now terminal for that event: the lease is marked completed,
   no local identity is created or updated, and the row does not leave ops
   health permanently red. Other provider failures remain retryable.
4. `identity.missing-primary-email-preservation` — the first current-state
   conversion passed a placeholder as an explicit update value. That could
   overwrite a confirmed address and revoke active sessions. The route now
   passes only a resolved current email into update and revocation logic.

The adjacent session-revocation path previously loaded every active session and
revoked all of them in one unbounded `Promise.allSettled`. It is now bounded to
100-row offset-zero pages, concurrency 10, and 500 successful revocations per
attempt. If sessions remain, it fails retryably; already-revoked sessions stay
revoked and the next webhook retry continues from the remaining active set.

Classification:

- generation fencing: `BLOCKS_RLS_DESIGN`, fixed in the compatibility source;
- current provider identity: `FIX_BEFORE_ACTIVATION`, fixed in the compatible
  application source;
- provider-absent terminal handling: `FIX_BEFORE_ACTIVATION`, fixed in the
  compatible application source;
- missing-primary-email preservation: `FIX_BEFORE_ACTIVATION`, fixed in the
  compatible application source;
- bounded session revocation: `FIX_BEFORE_ACTIVATION`, fixed in the same source;
- provider dashboard configuration and live delivery: runtime/vendor evidence,
  not proven by source and required before activation acceptance.

## Focused proof

The focused suite covers fail-closed row parsing, error bounds, exact
database-compatible placeholders, current-state projection, offset-zero session
draining, concurrency and per-attempt caps, zero direct application table
access, immutable event types, initial and duplicate claims, failed-claim
release, claim takeover, rejection of stale completion/failure, completed
deduplication, aggregate health counts, 90-day pruning, and runtime denial of a
direct table read under the target no-table-grant posture in disposable
PostgreSQL. The compatibility migration itself intentionally leaves the
predecessor Production table grant unchanged until activation.

Prisma schema validation passes. A repository-wide TypeScript run attempted
against the dependency tree shared by an older worktree produced unrelated
generated-client drift errors across pre-existing SellerProfile, Blog, Review,
and Commission fields. This package must receive a fresh isolated Prisma client
in CI; the shared dependency tree was not regenerated or mutated.

The Production wiring adds two separate manual workflows:

- `ClerkWebhookEvent Production Inspection` is a first-attempt, exact-main,
  successful-CI-bound, engine-read-only catalog inspection. It accepts an
  explicitly selected `pending`, `complete`, or restart-safe `compatible`
  state; compares the migration checksum and five installed function-body MD5s
  to reviewed source; checks ownership, column/default/constraint state, ACLs,
  predecessor runtime CRUD, and the deliberate no-RLS posture; and writes only
  mode-0600 sanitized metadata evidence.
- `ClerkWebhookEvent Authority Production` is separately authorized and bound
  to a successful exact-commit compatible-state inspection. It proves every
  predecessor migration is applied, invokes `prisma migrate deploy` at most
  once and only while the candidate is pending, audits global grants, and
  requires the complete catalog postflight. It does not deploy the app or
  enable RLS.

Focused source verification covers both accepted catalog states, checksum,
column, constraint, function body/configuration, ACL, RLS, evidence, exact-main
binding, step ordering, restart behavior, and scope closure. These workflows
remain source-only until their branch is reviewed and merged; neither has been
dispatched against Production.

## Release order and remaining gates

1. ~~Review and merge the exact compatibility source.~~ Complete through PR
   #544.
2. Merge the exact Production wiring, run the read-only compatible-state
   inspection, then separately authorize and apply only
   `20261008120000_prepare_clerk_webhook_event_authority`. Accept the complete
   postflight only after its column, constraint, five function definitions,
   ownership, search paths, and ACLs match reviewed source.
3. Deploy the exact compatible application and prove a correctly signed Clerk
   delivery, duplicate delivery, retention call, and ops-health aggregate.
4. Inspect and drain failed, released, and stale predecessor rows. Preserve
   sanitized evidence only.
5. Prepare a separate activation migration that revokes runtime/PUBLIC direct
   table privileges, enables policyless RLS without FORCE, and retains only the
   five fixed operations. Prove rollback and installed state.
6. After the compatible deployment and Phase A soak are accepted, prepare and
   separately authorize FORCE.

Migration-before-deployment is mandatory: the converted application calls the
new database functions. Deployment before the additive migration would make
Clerk webhook processing, retention, and the Clerk portion of ops health fail.
