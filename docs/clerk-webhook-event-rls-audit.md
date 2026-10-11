# ClerkWebhookEvent RLS audit and activation preparation

## Status

The audited compatibility source, Production wiring, and metadata-guard
corrections are merged. Exact source `948945e1a5604232e90116e2d489fc335d458527`
passed main CI run `38035908667`. Read-only compatible-state inspection run
`38037206283` accepted the predecessor catalog, and guarded Production run
`38037409279` applied only
`20261008120000_prepare_clerk_webhook_event_authority` and accepted its complete
postflight.

Compatible application deployment `dpl_HRhSLnjmWMF84qoV9mb51dULQ74i` serves all
five canonical Production aliases. Signed Clerk delivery
`msg_3KVWlwZx4u7CaXu73TjTZqGmNp9` completed with outcome `absent-user`; its one
exact retry produced one additional HTTP 200 attempt with outcome `duplicate`.
The database retained one completed row at claim generation 1. Retention deleted
zero rows, and the accepted health read reported zero failed, released, stale,
or total issue rows. These results close the compatible-application and live
delivery gate without claiming that RLS is enabled.

Production is therefore in `COMPATIBLE_PREPARATION_LIVE`: RLS and FORCE remain
off, zero policies remain installed, the five fixed operations are live, and
predecessor runtime CRUD is deliberately retained until Phase A activation.
The separate policyless Phase A source package prepares
`20261010160000_enable_clerk_webhook_event_rls`. It revokes runtime and PUBLIC
table and column authority, enables RLS without FORCE, retains only the five
source-pinned operations, and includes restart-safe inspection, guarded
Production execution, rollback, grant convergence, and disposable PostgreSQL
proof. That package is prepared locally; it is not published, merged, applied,
or live in Production.

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
`scripts/provision-runtime-db-role.sql` retains predecessor table CRUD while RLS
is off and converges the five optional function ACLs. The prepared activation
package changes the provisioner so any RLS-active posture re-closes direct table
authority after its broad baseline grants and refuses a partial RLS posture.

## Verified findings and fixes

Codex Security scan `093010aa-d9fb-497e-8b12-17fb3acf6783` completed against
source `85934f600f46c3e4b08046888d008970eaf8f171` and reported two low-severity,
high-confidence findings. Subsequent focused review added two related identity
edge cases. All four activation blockers are fixed in the compatible source;
none established account takeover.

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
- signed live delivery and exact duplicate retry: accepted runtime/vendor
  evidence; retain the provider dashboard configuration as an operational
  boundary outside the database authority proof.

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

The compatibility Production wiring added two separate manual workflows:

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

Focused source verification covers all accepted catalog states, checksum,
column, constraint, function body/configuration, ACL, RLS, evidence, exact-main
binding, step ordering, restart behavior, and scope closure. The corrected
compatibility workflows completed in runs `38037206283` and `38037409279`.

The prepared Phase A package adds a distinct `ClerkWebhookEvent Enable
Production` workflow. It requires an exact-main, successful-CI-bound,
`activation-compatible` read-only inspection, admits only the reviewed complete
or already-enabled catalog states, checks the exact activation migration hash,
applies at most that one migration, and requires an exact `enabled` postflight
plus the global grant audit. It cannot enable FORCE. Local focused verification
has 51 passes, zero failures, and one GitHub-Actions-PostgreSQL-only skip.

## Release order and remaining gates

1. ~~Review and merge the exact compatibility source.~~ Complete through PR
   #544.
2. ~~Merge and apply the compatibility wiring and additive authority migration.~~
   Complete through exact source `948945e1a5604232e90116e2d489fc335d458527`,
   inspection `38037206283`, and Production run `38037409279`.
3. ~~Deploy the exact compatible application and prove a correctly signed Clerk
   delivery, duplicate delivery, retention call, and ops-health aggregate.~~
   Complete on deployment `dpl_HRhSLnjmWMF84qoV9mb51dULQ74i`.
4. ~~Inspect and drain failed, released, and stale predecessor rows.~~ Complete;
   the accepted health read reported zero issues and retention deleted zero rows.
5. Review and merge the prepared policyless Phase A package. After exact-main CI,
   run its read-only `activation-compatible` inspection, then separately
   authorize only `20261010160000_enable_clerk_webhook_event_rls`. Accept direct
   runtime/PUBLIC denial, zero policies, five exact operations, and rollback
   evidence before calling Phase A live.
6. After Phase A and its soak are accepted, prepare and separately authorize
   FORCE.

Migration-before-deployment is mandatory: the converted application calls the
new database functions. Deployment before the additive migration would make
Clerk webhook processing, retention, and the Clerk portion of ops health fail.
