# Clerk server API key credential recovery

Status: audited, planned and implemented on an isolated branch on 2026-09-03;
the focused recovery suite passed 18/18 and the complete repository suite
passed 4,031 tests with zero failures and 10 intentional skips. The operator
has not run, so no Clerk key, Vercel variable, deployment, GitHub secret or
local credential has changed. This plan covers only the exposed
`CLERK_SECRET_KEY`. The Clerk webhook signing secret is a separate
endpoint-cutover family, and the public publishable key is not rotated solely because it
appeared beside exposed secrets.

The Extra-High pre-execution review found one partial-failure cleanup gap: a
ticket exchange could fail after a 60-second sign-in token was created but
before the outer witness received a session identifier. No provider operation
had run. The operator now revokes that unconsumed token inside the creation
failure path, keeps the outer active-session sweep around the entire creation
attempt, and has behavioral regression coverage for the failed-handshake case.
The same review also closed the clipboard-to-journal crash window that mattered
on this crash-prone workstation: each replacement now enters an explicit
captured-but-unverified stage in the fsynced mode-`0600` journal before the
clipboard is cleared or a network identity check begins. A restart preserves
the only copy of the new secret and resumes validation without creating a
competing provider key.

## Why this is a separate family

The server API key authorizes Clerk Backend API operations. Grainline uses it
through `@clerk/nextjs` for `currentUser()`, user lookup/deletion, user ban and
unban, active-session inventory/revocation, sign-in-token creation/revocation,
and the authenticated proof operators. A compromised key could inspect or
alter production Clerk identities and sessions even without database access.

The webhook signing secret has a different trust boundary. Rotating it means
creating a parallel Clerk/Svix endpoint, preserving event delivery and replay
semantics, then deleting the predecessor endpoint. It must not be hidden inside
this server-key change.

Clerk's current rotation guidance supports multiple simultaneously active
named Secret Keys: create a replacement, move and verify consumers, then delete
the old key. It also recommends a separate key for each use location. See
<https://clerk.com/docs/guides/secure/rotate-api-keys>.

## Audited provider and consumer state

Read-only provider proof authenticated to exact production instance
`ins_3BYdVgH643MVFsiKPloUw9GUYQK`; the instance response reported
`environment_type=production`. The exposed server-key SHA-256 is pinned as
`3049c74f9158f6e79ba645b6250ecb7eef8c3f0a0dbbbfbc5f683be9192b500a`.
The digest is an identity fence, not a credential and cannot authenticate.

Current consumers are:

- Vercel team-shared row `env_VXNad7lOhIh6x3YXnULLncRW`, key
  `CLERK_SECRET_KEY`, type `encrypted`, owned by
  `team_wvQeQHZGwCSwinC1uB7xbpjr`, linked only to Grainline project
  `prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp`, and targeted to Development, Preview and
  Production;
- GitHub repository secret `CLERK_SECRET_KEY`; and
- ignored mode-`0600` `/Users/drewyoung/grainline/.env.local`.

All three secret-bearing consumers match the pinned digest. No project-local
Vercel shadow exists. The current all-environment shared topology gives the
same production-capable key to runtime, CI and local operations and exposes it
to environments that do not need a live production server key.

The adjacent public shared row
`env_0P6D4jUJz6l8clEwS1lf95Ax` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) remains
unchanged. The separate webhook shared row
`env_COJQFcpzr4XLmfRZl1sPYGux` (`CLERK_WEBHOOK_SECRET`) also remains unchanged
until its own audited endpoint cutover.

Vercel documents that a project variable overrides a shared variable with the
same key/environment, environment changes affect only new deployments, and
Production-only secrets can be marked sensitive. See
<https://vercel.com/docs/environment-variables/shared-environment-variables>
and <https://vercel.com/docs/environment-variables/manage-across-environments>.

## Target topology

Create two distinct named Clerk production Secret Keys through the Clerk
dashboard:

1. `grainline-production-runtime-20260903` belongs only in one project-local,
   Production-only, `sensitive` Vercel `CLERK_SECRET_KEY` row.
2. `grainline-production-operations-20260903` belongs only in the GitHub
   repository secret and ignored local mode-`0600` file.

The old shared Vercel row is retained only while the new project-local runtime
row overrides it during the compatibility deployment. After all aliases move,
the overlap drains, and the one current credential-epoch predecessor is
removed, delete exact shared row `env_VXNad7lOhIh6x3YXnULLncRW`. It is linked
only to Grainline and contains the compromised key, so leaving it unlinked at
team scope would retain exposed secret material without a consumer.

Do not create a Preview or Development live Clerk server key. Local development
uses the operations key from the ignored file. Preview intentionally has no
production database and must not gain a production Clerk secret as a substitute.

## Application behavior audit

No application compatibility change is required for server-key overlap; the
provider accepts each active key independently and the SDK reads one
`CLERK_SECRET_KEY` per process. The replacement proof must nevertheless cover
the actual operations Grainline relies on:

- an authenticated `/account` request calls `ensureUserForPage()` and
  `ensureUser()`, which always invokes Clerk `currentUser()` before its
  idempotent local-user synchronization. This is the deployed runtime-key
  witness;
- the operations key must resolve exactly one retained non-customer operational
  canary, list its active sessions, create one short-lived sign-in token, obtain
  one bounded session for the runtime witness, revoke the session and revoke any
  unused sign-in token, including when the ticket exchange fails before the
  outer runtime witness has received a session identifier;
- direct provider probes must prove both replacements reach the exact production
  instance above;
- no proof may delete, ban, unban or modify an ordinary user; and
- the account-deletion, ban/unban and session-revocation implementations remain
  unchanged. Their Backend API authority is covered by same-instance key
  identity and existing focused tests, not by mutating a real customer.

The webhook route audit found signed-body verification, a bounded 512-KiB body,
database replay reservation by `svix-id`, stale/failed reclaim, retryable
`in_progress`, primary-email-only synchronization, session revocation on email
change, and explicit failure telemetry. Those facts inform the later webhook
cutover but do not authorize it here.

## Exact deployment boundary

The only callable READY Production deployment at or after the accepted database
credential epoch cutoff is:

- `dpl_6Qndfy4oiiGCkWdcZXYRDzsraqFz`, created at `1788403585649`, built from
  source `82f58889b12095d21449494a036a327cc9feb9b1`.

The Clerk server-key operator may deploy only that exact source after its CI run
`33702373864` is reverified successful. It must prove the same four canonical
aliases and canonical health. Older READY artifacts precede the accepted
database rotation and cannot reach the database with their superseded
credentials; the operator must not broaden its fence into a historical purge.

After promotion and the authenticated runtime witness, wait at least 330
seconds—longer than the reviewed maximum in-flight request duration—before
removing only the exact predecessor above. Provider key overlap remains active
through this drain.

## Restart-safe sequence

1. Require the accepted Shippo evidence SHA-256
   `ebcd62085d611bc09e6b4d4ee8e3f4dc38c9c1cf31cb6ba51e1dd68bff6e3f66`,
   absence of its private journal, exact current deployment/aliases/health and
   the complete provider/consumer metadata above.
2. Write a new mode-`0600`, fsynced private journal containing the exposed key
   only after its digest and exact production instance are proven.
3. Stop for creation of the named runtime key. Capture it once from the macOS
   clipboard, validate `sk_live_` shape, fsync the captured-but-unverified
   stage, clear only that captured clipboard value, then prove exact
   production-instance identity before advancing.
4. Stop separately for creation of the named operations key. Require a distinct
   digest from both other keys, fsync its captured-but-unverified stage, clear
   only that captured clipboard value, then prove the same instance.
5. Create exactly one project-local Production-only sensitive Vercel row for
   the runtime key. Reject any pre-existing project-local `CLERK_SECRET_KEY`
   row, unknown target, branch binding or shadow. The old shared row remains
   temporarily linked and is overridden only in Production.
6. Update GitHub and ignored local consumers to the operations key through
   stdin/atomic file replacement. No key may enter argv, logs, Git, CI output or
   sanitized evidence.
7. Deploy only exact source `82f58889b12095d21449494a036a327cc9feb9b1`,
   re-attest its READY source/environment metadata, converge only aliases still
   on the exact predecessor, and verify homepage and health.
8. Use the operations key to create one bounded canary session, call canonical
   `/account`, require HTTP 200 and then revoke the session. The route may run
   its normal idempotent `ensureUser()` profile synchronization for this
   dedicated canary; it must not create marketplace fixtures or mutate an
   ordinary user, and the final active-session inventory must be empty.
9. Wait 330 seconds from full alias convergence and remove only deployment
   `dpl_6Qndfy4oiiGCkWdcZXYRDzsraqFz`. Reverify the candidate and aliases.
10. Delete exact compromised shared row `env_VXNad7lOhIh6x3YXnULLncRW` and
    prove the project-local runtime row is the sole effective Production
    `CLERK_SECRET_KEY`, with no Preview/Development value.
11. Stop for deletion of only the exposed Clerk server key. Resume the same
    journal and accept only its Backend API authentication rejection while both
    replacements still authenticate to the exact instance.
12. Re-run the authenticated runtime witness, revoke every temporary session or
    token, verify health/aliases/source and consumer metadata, write sanitized
    mode-`0600` evidence, then remove the private journal.

## Fail-closed and recovery requirements

- A clean exact-main operator commit and successful exact-main CI are required
  before any provider or consumer mutation.
- Dashboard create/delete are explicit human boundaries. An ambiguous create or
  deletion is restart state, never permission to create or delete another key.
- Every stage re-attests exact provider instance, three pairwise-distinct key
  digests, exact Vercel/GitHub/local topology, deployment inventory and aliases.
- A candidate created immediately before a process stop is rediscovered only by
  its exact marker, source, creation time and environment metadata.
- Project-local sensitive values are intentionally non-readable. Acceptance
  requires their exact metadata plus a successful post-old-key authenticated
  runtime `currentUser()` witness; do not invent a secret readback bypass.
- The first 2026-09-03 consumer-convergence attempt created exactly one reviewed
  Production-only sensitive row, `ObHdF2xpBZGpxKg3`, then stopped before
  journal advancement because the verifier still expected the shared-row
  `env_...` identifier shape and an omitted `value` property. A decrypt-disabled
  read proved Vercel's current project-local shape is a bare 16-character ID
  plus exact empty-string redaction. The corrected verifier accepts only that
  shape and still rejects plaintext, masked, omitted or otherwise changed
  values; restart must reuse this row and must not create a second one.
- The private journal remains immutably bound to original operator
  `43d0f5f4fe85ddabd2f7a67a250de30baaa9f544` / CI `33721186278`.
  Corrected code may resume it only when separately supplied an exact clean
  corrected operator commit and successful push CI. Both original and corrected
  bindings are reverified on every invocation and retained in sanitized final
  evidence. A corrected binding cannot start a new recovery or substitute for
  either original journal identifier.
- If final runtime proof fails after old-key deletion, preserve the candidate,
  operations key and private journal for bounded recovery; never promote the
  removed predecessor or mint an untracked third replacement.
- Accepted evidence contains hashes, IDs, counts, status, timestamps and proof
  outcomes only. It contains no key, session cookie, ticket, email, Clerk user
  identifier or raw provider response.

## Residual boundary

Completing this family does not close the Clerk webhook signing-secret exposure,
the broader credential incident, the fresh authenticated Order smoke, or Order
RLS. Those remain sequential gates.
