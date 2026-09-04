# Clerk webhook signing-secret credential recovery

Status: the application hardening is live from exact main
`d7859d5d1aaab5fbfbd77e973bf196a063493a62`, and every callable
current-credential predecessor containing the unsafe legal writer has been
drained. The aggregate provenance inspection found exactly one active current
acceptance without trusted route provenance; the reviewed cleanup cleared only
that row's three legal-state fields, and a fresh independent inspection now
confirms zero untrusted current acceptances. Provider signing-secret rotation
remains pending. The accepted cleanup changed one production User row and no
Clerk endpoint, Vercel variable, GitHub secret, migration, grant, deployment, or
RLS state. The Clerk server API key
family is already accepted separately; this document covers only the production
`CLERK_WEBHOOK_SECRET` and the application boundary it authenticates.

## Accepted safe-writer release and drain

Exact main `d7859d5d1aaab5fbfbd77e973bf196a063493a62` passed CI run
`33815736682` and became READY Production deployment
`dpl_HHLuG4Snq6vqitPjxUdabLqXfFSF`. All four canonical aliases resolved to that
deployment, `/api/health` returned `200`, and an unsigned Clerk webhook request
returned the bounded `400` missing-header response. After the alias-derived
330-second request drain, exact unsafe predecessor
`dpl_X6b4qkf9c7Y8xkPctFWgY1zJD41V` at source
`82f58889b12095d21449494a036a327cc9feb9b1` was permanently removed.

The current database-credential epoch contained exactly those two deployments
before removal and exactly the hardened deployment afterward, with no next page;
the removed deployment subsequently returned `404`. Retain sanitized mode-0600
evidence
`clerk-webhook-hardening-production-release-20260903.json`, SHA-256
`2f561ea9034d5ac70b587248e76b22aff74077c57cd590725d2e0a6ab9c433ca`.
This closes only restart-safe steps 2 and 3 below. It does not accept historical
legal provenance or rotate the webhook signing-secret family.

## Accepted aggregate provenance inspection

Exact main `1e4e0c786a9fe4259cbd3d6e79bec39aabc9de2d` ran protected
workflow `33886609425` after the unsafe-writer drain. The owner connection was
the reviewed direct production target, and PostgreSQL attested `REPEATABLE
READ`, `READ ONLY`, and rollback. The artifact contains aggregate counts only:

- total/active/deleted users: `9 / 9 / 0`;
- active current accepted: `5`;
- active trusted/untrusted current accepted: `4 / 1`;
- active partial-or-stale/no-legal state: `3 / 1`; and
- deleted current accepted: `0`.

Retain sanitized artifact
`clerk-legal-provenance-inspection-1e4e0c786a9fe4259cbd3d6e79bec39aabc9de2d.json`,
SHA-256
`6b9819119b1c20e3f386546e623c98f894181a294c3f8dc9932e37c747bb50ca`.
It contains no row, identifier, email, timestamp, metadata or credential and
changed no production state.

The `activeUntrustedCurrentAccepted = 1` result stopped provider rotation.
Exact main `7567f710aa03ab5d20db9dce26697ac8046baa38` passed CI
`33893888226`. Protected cleanup run `33895038513` revalidated the exact
inspection partition, selected and locked exactly one predicate-matched row in
one `SERIALIZABLE` transaction, and cleared only `termsAcceptedAt`,
`termsVersion`, and `ageAttestedAt`. It created no acceptance audit, exposed no
identity, and waited 65 seconds beyond the 60-second account-state cache TTL.
Its transaction and final counts were `4` current, `4` trusted, `0` untrusted,
`3` partial/stale, and `2` no-legal-state. Retain sanitized aggregate-only
cleanup artifact
`clerk-legal-provenance-cleanup-7567f710aa03ab5d20db9dce26697ac8046baa38.json`,
SHA-256
`a60756c5958097f7ef91078f48f6129146400f95b3a1955de0dea89e02deabdb`.

Fresh independent protected inspection `33895463860` then ran outside the
cleanup transaction. PostgreSQL again attested `REPEATABLE READ`, `READ ONLY`,
and rollback; it independently returned the same `4 / 4 / 0 / 3 / 2` active
partition. Retain sanitized aggregate artifact
`clerk-legal-provenance-inspection-7567f710aa03ab5d20db9dce26697ac8046baa38.json`,
SHA-256
`1a8b704870d942229afaa4d515921adc18702a6aae0b26e8904603bec3ac91bc`.
The affected user will be prompted to reaccept through the normal authenticated
route. The legal-provenance gate is closed; provider rotation remains a
separate production boundary.

## Why this is a separate family

The webhook signing secret proves that a request was signed by the configured
Clerk/Svix endpoint. It does not grant Clerk Backend API access, and rotating a
Clerk server API key does not rotate it. A safe webhook-secret recovery must
preserve signed delivery, retries, replay handling, and user lifecycle effects
while the provider endpoint and deployed application move together.

Clerk's current key-rotation guidance recommends creating a parallel webhook
endpoint with the same URL and subscriptions, moving the consumer to the new
secret, verifying delivery, and deleting the old endpoint. See
<https://clerk.com/docs/guides/secure/rotate-api-keys>. Clerk's webhook guides
also describe Svix-backed delivery and retries:
<https://clerk.com/docs/guides/development/webhooks/overview> and
<https://clerk.com/docs/guides/development/webhooks/syncing>.

## Current consumer topology

Read-only inventory found one Vercel team-shared row:

- id `env_COJQFcpzr4XLmfRZl1sPYGux`;
- key `CLERK_WEBHOOK_SECRET`, encrypted;
- linked only to Grainline project `prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp`;
- targeted to Development, Preview, and Production; and
- no project-local shadow or `CLERK_WEBHOOK_SECRET_PREVIOUS` row.

The same secret is also present in the GitHub repository secret and the ignored
local environment file. Digest-only comparison showed that the decrypted
Vercel value and local value match. The pinned predecessor digest is
`3240b004c89c5b3853d08e4a4d004368f29e093253f71e95047e508ad0561ced`;
it is an identity fence and cannot authenticate.

Ordinary CI does not execute a provider-signed Clerk webhook. Supplying the real
production signing secret to `.github/workflows/ci.yml` therefore expands the
consumer set without proving provider delivery. The prepared application patch
removes that injection. After exact-main CI succeeds, delete the GitHub
repository secret rather than retaining an unused copy.

The active provider endpoint inventory is not yet accepted. Before any mutation,
the Clerk dashboard/Svix portal must record the exact current endpoint id, URL,
enabled state, event subscriptions, creation state, and predecessor-secret
digest without persisting the portal fragment or raw secret. An unavailable or
ambiguous portal is a stop condition, not permission to create another endpoint.

## Target topology

The replacement secret belongs in exactly one project-local, sensitive,
Production-only Vercel `CLERK_WEBHOOK_SECRET` row. It must not be shared with
Preview or Development, stored in GitHub CI, or retained as a routine local
production credential. A mode-`0600` private restart journal may hold it only
for the bounded cutover and is removed after accepted evidence is written.

Preview intentionally has no production `DATABASE_URL` and must not receive a
production Clerk signing secret. Local development that needs webhook delivery
must use a separate development-instance endpoint and secret.

## Application and lifecycle audit

The production route at `/api/clerk/webhook`:

- reads a single `CLERK_WEBHOOK_SECRET` and verifies the exact raw body with
  Svix before reserving or processing an event;
- rejects bodies over 512 KiB;
- reserves `ClerkWebhookEvent.svixId` before side effects, returns success for a
  processed replay, returns retryable `503` for an active lease, and reclaims
  failed or stale leases after five minutes;
- handles `user.created`, `user.updated`, and `user.deleted`, while marking
  other verified types processed without lifecycle changes;
- synchronizes only the resolved primary email plus sanitized name/image,
  revokes sessions after a real primary-email change, anonymizes a deleted
  account, and makes welcome-email fallback idempotent through the outbox; and
- retains Sentry and Redis failure-spike telemetry only after signature
  verification, where the request has crossed the provider-authentication
  boundary.

Two medium findings were validated by scoped Codex Security scan
`84a86800-beb0-4737-8a44-4565483645e3` against main
`9f1f0600045c672111801da984c8eb9ab993982d`:

1. `authz.untrusted-clerk-unsafe-metadata`: both the webhook route and
   `ensureUser()` treated Clerk `unsafeMetadata` as authority for
   `termsAcceptedAt`, `ageAttestedAt`, and `termsVersion`. Clerk documents that
   unsafe metadata is readable and writable from the frontend. A user could
   therefore cause a correctly signed `user.updated` event or an authenticated
   profile sync to write legal-acceptance state without the dedicated
   acceptance route.
2. `resource-exhaustion.unauthenticated-webhook-telemetry-amplification`:
   missing headers, oversized bodies, and invalid signatures each invoked
   Sentry plus the shared Redis failure-spike recorder. That recorder performs
   a counter write and a multi-key window read, so an unauthenticated caller
   could amplify provider/Redis work and compete with fail-closed application
   rate limits.

The prepared fix removes legal-state authority from both generic identity-sync
paths. Only authenticated, rate-limited `/api/account/accept-terms` can write
those fields. Its `User` update and `TERMS_ACCEPTED` audit row are now one
database transaction; an audit failure rolls back the legal-state update. The
same patch keeps every pre-authentication webhook rejection local, including a
body stream that aborts before verification, and retains reservation/handler
telemetry for verified events.

The scoped finding is fixed here for Clerk only. Static sibling review found
the older pre-verification Sentry/Redis pattern in the Resend webhook and all
three Stripe webhook routes. Those routes have different provider protocols,
response requirements, and active payment risk, so they are not silently
changed in this credential patch. A separate class-wide audit must decide
their edge/config monitoring and authenticated telemetry boundary before their
next signing-secret rotation. Current repository guidance records that open
item and prohibits copying the pattern into new routes.

This does not silently bless historical state. The current terms version is
newer than the retained audit-route implementation, so a separate
engine-read-only aggregate inspection must count current accepted users with
and without a matching non-undone `TERMS_ACCEPTED` `AdminAuditLog` row whose
`targetType`, `targetId`, `actorKind`, route, and terms version match. Export no
user ids, emails, timestamps, or metadata. Before the patched application is
called complete, users lacking trusted provenance must have the three legal
fields cleared by one narrowly reviewed owner-only cleanup and reaccept normally. A
legitimate user whose earlier audit write failed may be asked to reaccept; that
is safer than preserving unprovable consent.

The isolated inspection scaffold uses one engine-attested `REPEATABLE READ READ
ONLY` transaction and returns only a nine-count partition: total, active,
deleted, active current acceptance, trusted/untrusted current acceptance,
partial-or-stale active state, active state with no legal fields, and deleted
current acceptance. A trusted current acceptance requires a non-undone
`TERMS_ACCEPTED` row for the same local user and target, with `actorKind=user`,
the exact `/api/account/accept-terms` route, and current terms version. The
normalizer rejects missing, nonnumeric, unsafe-integer, or arithmetically
inconsistent counts. CI proves the exact classification against valid and
forged audit fixtures in disposable PostgreSQL before the protected workflow
can be considered runnable. Cleanup authority is limited to active users whose
current acceptance lacks trusted provenance; deleted-user legal retention is a
separate policy question and is not silently mutated by this recovery.

## Provider proof and replay semantics

Create one parallel production Clerk webhook endpoint with the exact canonical
URL and exact reviewed event subscriptions. Capture its signing secret once
into the fsynced private journal, then install it only in the project-local
Production Vercel row and deploy the reviewed application.

Acceptance requires a genuine provider-signed delivery through the new endpoint,
not merely a locally signed request. Prefer a Clerk/Svix dashboard test for
`user.deleted` using a unique sentinel Clerk id that is first proven absent from
production. Never target an existing or ordinary user. If the provider cannot
send a safe absent sentinel, use a disposable production Clerk canary with an
explicit cleanup plan; do not pretend a locally signed simulation proves the
provider URL, subscriptions, or secret binding.

The proof must show exactly one processed `ClerkWebhookEvent` reservation for
the chosen delivery and a successful exact retry with no repeated application
side effect. Preserve or exact-clean that one synthetic event row according to
the reviewed proof plan and record the choice. Do not assume the same logical
event carries the same `svix-id` across two parallel endpoint deliveries; the
database key provides delivery-id replay safety, not proven cross-endpoint
logical deduplication.

## Restart-safe cutover

1. Require the accepted Clerk server-key evidence, exact current deployment,
   aliases, health, and absence of its private journal.
2. Merge and deploy the application hardening: no unsafe-metadata legal writes,
   atomic legal audit, no unauthenticated shared telemetry, and no CI webhook
   secret consumer.
3. Drain every callable predecessor application deployment that still contains
   the unsafe-metadata legal-write paths. Reverify the current deployment,
   aliases and health. Merely moving aliases is insufficient because a
   predecessor deployment URL remains callable until removed.
4. Run the aggregate-only legal-acceptance provenance inspection only after the
   unsafe application predecessors are gone. Prepare and apply a separate
   narrow owner-only cleanup if the aggregate shows untrusted active rows, then rerun the
   same inspection and require zero untrusted active rows. The retained
   operational canary is not exempt: if it lacks route-backed provenance, clear
   it and restore acceptance only through the normal authenticated
   `/api/account/accept-terms` route so the audit is created atomically.
5. Inventory the exact predecessor endpoint and subscriptions through the
   Clerk/Svix portal without printing or storing its portal URL fragment.
6. Create one distinctly named parallel endpoint with the same canonical URL
   and event subscriptions. An ambiguous creation is restart state.
7. Capture the replacement secret once, fsync it to a mode-`0600` journal,
   clear only that clipboard value, and require a digest distinct from the
   predecessor.
8. Create one project-local Production-only sensitive Vercel row. Keep the old
   shared row temporarily so the new project-local row overrides it only in
   Production. Do not create `_PREVIOUS`.
9. Deploy only the exact reviewed CI-green source, move every canonical alias,
   and verify READY status, source provenance and health.
10. Send the genuine provider-signed safe delivery through the new endpoint,
   then retry the exact delivery and prove the lifecycle/replay boundary.
11. Keep overlap bounded. After the reviewed in-flight drain, disable and delete
    only the exact predecessor endpoint. Reverify new-endpoint delivery.
12. Delete exact shared Vercel row `env_COJQFcpzr4XLmfRZl1sPYGux`, delete the
    now-unused GitHub secret, remove the local production value, and prove the
    project-local Production row is the sole production consumer.
13. Reverify deployment, aliases, health, provider endpoint inventory, evidence
    redaction and journal removal. Only then accept the family.

## Fail-closed requirements

- Every code, CI, deployment, endpoint, environment-row and evidence identity
  is pinned before a mutation.
- Raw endpoint secrets, portal fragments, request signatures, session tokens,
  user ids, emails, and provider responses never enter Git, argv, logs, chat, or
  sanitized evidence.
- The old endpoint remains recoverable until the new endpoint's genuine signed
  delivery passes. After old-endpoint deletion, failure preserves the new
  endpoint and private journal for repair; it does not mint a third endpoint.
- Unexpected endpoint counts, URLs, subscriptions, Vercel shadows, consumer
  copies, delivery ids, audit-provenance counts, or deployment inventory stop
  the operation.
- This credential recovery runs no RLS migration and does not resume Order RLS.
  After all exposed credential families are accepted, the full authenticated
  Order smoke runs before Order RLS work resumes.
