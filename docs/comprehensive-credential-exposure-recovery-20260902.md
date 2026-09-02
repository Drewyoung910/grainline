# Comprehensive credential exposure recovery — 2026-09-02

Status: active recovery. The database owner/runtime family is complete; provider
and application families remain open. No credential value,
raw provider response, connection string, PIN, signing secret, token, or private
restart journal belongs in this document, a commit, a pull request, a CI artifact,
or ordinary terminal output.

## Incident

A diagnostic intended to inventory local environment keys printed assignment lines
from ignored mode-`0600` files into private agent tool output. The values did not
enter tracked files, Git history, pull requests, GitHub Actions, Vercel logs, or
accepted rollout evidence. Because the transcript cannot be rewritten, every
authentication secret that was non-empty in those lines is treated as compromised.

The exposed secret families were:

- production Neon `neondb_owner` and pooled `grainline_app_runtime` passwords;
- Clerk server and webhook secrets;
- the Cloudflare R2 application access-key pair;
- Stripe test API and primary webhook secrets;
- Shippo test API token;
- Upstash Redis token;
- OpenAI, Resend, and Sentry API/auth tokens;
- `CRON_SECRET`, `SHIPPING_RATE_SECRET`, `ADMIN_PIN`, and
  `ADMIN_PIN_COOKIE_SECRET`; and
- an ephemeral Vercel OIDC token, which is allowed to expire and must not be
  promoted into a long-lived credential.

Public identifiers and non-secret configuration that appeared in the same output
are not rotated solely because they were displayed. Empty local values are not
classified as exposed production secrets without separate equality evidence.

## Immediate containment

No migrations, grants, RLS policies, Stripe live-mode objects, or provider
configuration changed during diagnosis.

The failed authenticated Order smoke had retained a restart journal and exact
Stripe test, Shippo test, Clerk, Redis, and database fixtures. Rotating those
credentials first could have stranded cleanup. Cleanup-only recovery therefore
ran before credential rotation from exact main
`d450b76e822472672c05f850e19828b8830f6783` and CI `33615489208`.

Accepted cleanup-only evidence:

- path:
  `order-authenticated-route-smoke-d450b76e822472672c05f850e19828b8830f6783.json`;
- SHA-256:
  `17be192e5d9ea0cb2afb807cb8b87f20c676541c72a4ac0cd78d6d4daf171bd7`;
- mode `0600`;
- honest proof status `failed` because cleanup is not route acceptance;
- zero persistent mutable fixture residue;
- canary restored, Clerk sessions revoked, database fixtures deleted, and exact
  Redis keys deleted;
- one intentional immutable processed webhook lease retained; and
- private restart journal removed only after cleanup evidence finalized.

A fresh full authenticated Order smoke is still required after credential
recovery. This incident does not convert the failed route proof into acceptance.

## Confirmed credential stores

Vercel project-owned Production contains the runtime-only `DATABASE_URL`. The
owner credential remains absent from Vercel and belongs only in:

- Neon role `neondb_owner`;
- protected GitHub `Production` secret
  `PRODUCTION_MIGRATION_DIRECT_URL`;
- protected non-secret digest variable
  `PRODUCTION_MIGRATION_DIRECT_URL_SHA256`; and
- ignored local `.env.migration-owner.local`.

Current team-shared Vercel variables linked to Grainline include the Clerk server
and webhook credentials, cron secret, Shippo token, Stripe API and primary webhook
credentials, plus their matching public application identifiers. Replacement
values for those families must update the shared source rather than create shadow
project variables.

GitHub repository secrets also duplicate the application/provider credentials
used by CI and proofs. Protected DirectUpload cleanup credentials are a separate
store and are outside this incident unless provider key identity proves reuse of
an exposed key.

## Recovery order and invariants

1. Preserve the cleanup evidence and freeze fresh Order smoke attempts.
2. Rotate the privileged owner password first through the pinned Neon target.
   Persist a private restart journal before reset; update only the protected
   GitHub migration secret/digest and dedicated local owner file; prove the old
   URL rejects with SQLSTATE `28P01` and the replacement has the exact owner
   posture.
3. Rotate the ordinary runtime password through the same pinned Neon target.
   Update only Vercel Production `DATABASE_URL`, stage the exact currently
   deployed source
   `b22fa138d84bad792ba206ee00dacb48d475d4a4`, and stop with the READY candidate
   unpromoted. Canonical promotion is a separate just-in-time operation after
   re-verifying that every alias still resolves to the exact predecessor; the
   recovery operator itself cannot overwrite a concurrent deployment. After
   promotion, resume the journal, update local `.env.local`, and prove the old pooled password rejects with
   SQLSTATE `28P01`, and prove the replacement is LOGIN/NOINHERIT/
   NOBYPASSRLS `grainline_app_runtime`.
4. Run an engine-enforced repeatable-read read-only global grant/RLS audit and
   verify the canonical homepage and health route.
5. Inventory and drain every older callable deployment that embeds a superseded
   runtime credential. Rollback after rotation means rebuilding compatible old
   source with current credentials, not promoting an artifact with revoked
   credentials.
6. Rotate one third-party provider family at a time. Create replacement, update
   every local/Vercel/GitHub consumer, deploy and prove the same account/resource
   and mode, revoke the old credential, then prove old rejection.
7. Rotate webhook signing secrets as endpoint cutovers, not as ordinary API-key
   swaps. Drain/replay provider deliveries or add explicitly reviewed dual-secret
   verification before retiring an old signing secret.
8. Rotate application HMAC/PIN secrets with their compatibility windows:
   admin cookies up to four hours, upload tokens five minutes, shipping quotes
   thirty minutes plus skew, and unsubscribe links up to ninety days.
9. Run replacement-credential health, Clerk, Stripe/Shippo test, R2,
   Redis, email/webhook, OpenAI, cron, admin, and full authenticated Order proofs.
10. Resume Order RLS only after the incident evidence is closed and the full
    authenticated Order smoke passes.

## Pre-execution corrections

The first production attempts on 2026-09-02 stopped before creating a restart
journal or changing a credential. Two reviewed CLI packages had drifted or been
evicted from their isolated `npx` cache entries; the exact pinned Vercel and Neon
versions were restored and their package metadata, tarball URLs and integrity
values reverified.

The next preflight exposed an operator defect rather than provider drift. All
three canonical aliases still resolved to the exact reviewed predecessor, but
the fresh-run path passed that predecessor into the replacement-versus-
predecessor validator, whose contract correctly requires two distinct IDs. The
recovery now uses a separate predecessor-only validator for the fresh boundary;
the replacement validator remains strict about distinct deployments, partial
promotion and unreviewed alias targets. Regression tests cover both states.

A subsequent preflight also stopped before journal creation because the owner
membership proof compared serialized `jsonb` objects. PostgreSQL returned the
same four fields and values in a different object-key order, making a logically
exact role graph compare unequal. The proof now checks the exact field set and
each field value without depending on object-key order; extra, missing or
changed membership attributes still fail closed. CI exercises the actual
node-postgres `jsonb` representation.

## Restart-safe database operator

The current database operator is
`scripts/database-credential-exposure-recovery.mjs`. It is adapted from the
accepted August recovery and now:

- requires current Vercel runtime-only database scope;
- binds the live deployment and its canonical aliases independently, using a
  predecessor-only fresh-run proof before any replacement exists;
- rotates owner before runtime;
- records secret material only in an ignored mode-`0600` private journal;
- recovers a stale, fully-fsynced atomic temporary write after fencing recent
  files that may still belong to an active writer;
- never retries an ambiguous Neon reset blindly;
- deploys only the exact current application source;
- refuses automatic canonical promotion and rejects aliases that moved to any
  deployment other than the pinned predecessor or replacement;
- proves the complete reviewed owner attributes and membership-option graph;
- compares every owner membership field exactly without depending on PostgreSQL
  `jsonb` object-key order;
- removes privileged or aliased PostgreSQL credentials from the runtime-local
  file before declaring local convergence;
- accepts only SQLSTATE `28P01` as old-password rejection;
- performs a read-only global grant/RLS audit;
- emits sanitized evidence and no secret values; and
- contains no migration command.

The implementation must pass focused tests and an independent post-patch
security review, then be committed as an implementation checkpoint. A separate
one-file release commit must pin the implementation SHA-256 and successful
exact-head pull-request CI before execution.

## Completed database family

The database recovery completed on 2026-09-02. Both superseded passwords reject
with the exact PostgreSQL authentication-failure class, the replacement owner and
runtime identities match the reviewed role posture, the read-only global grant/RLS
audit passed, and all canonical aliases point to READY replacement deployment
`dpl_AmW64aR14Yk47HK54kwiMSiKwkJD` built from unchanged application source
`b22fa138d84bad792ba206ee00dacb48d475d4a4`. No migration ran. The private
restart journal was removed only after mode-`0600` sanitized evidence finalized.

Accepted database evidence:

- path: `database-credential-recovery-20260902.json`;
- SHA-256:
  `318a5ffe0cac56b0be2478d22201aa28ee13d89d0991192727fb0b29fb717587`;
- replacement deployment:
  `dpl_AmW64aR14Yk47HK54kwiMSiKwkJD`; and
- exact unchanged application source:
  `b22fa138d84bad792ba206ee00dacb48d475d4a4`.

## Resend family

Resend is the first third-party family because provider inventory contains exactly
one reviewed existing API key, making the revocation target unambiguous. The
restart-safe operator is `scripts/resend-credential-exposure-recovery.mjs`.

The operator must:

- bind a successful exact-head CI run and a clean operator commit;
- bind the clean unchanged deployment source and all three canonical aliases;
- reject incomplete or unexpected provider-key inventories;
- create one marker-named replacement key and fsync it only to a private
  mode-`0600` journal;
- update the GitHub repository secret, the Vercel variable as Sensitive, and the
  ignored local file without printing the replacement;
- stage and verify an exact-source production deployment before promotion;
- prove the replacement can authenticate before revoking the exact old key;
- accept only an authentication rejection from the superseded key;
- verify the canonical homepage and health route; and
- emit sanitized evidence containing credential hashes rather than values.

The first incident-response replacement intentionally preserves the old key's
`full_access` behavior to avoid coupling credential containment to a permissions
redesign. Converting the application to a domain-scoped sending-only key is a
separate least-privilege improvement after recovery, with an email-delivery and
webhook verification proof of its own.

The first two Resend execution attempts on 2026-09-02 stopped before journal
creation or provider mutation. Vercel CLI 58.11.0 writes progress lines to stdout
before the resolved-environment child process output, while the first operator
compared that entire stdout value to the expected SHA-256. The corrected operator
uses one unique, fixed-prefix digest line; it accepts the reviewed CLI progress
output while rejecting a missing, duplicate, or malformed digest marker. A fresh
sanitized provider inventory after the stops proved that only the original key
still existed, so no ambiguous replacement was retried.

The next corrected attempt created exactly one replacement key, updated the
GitHub repository secret, and stopped with its private journal at
`github-updated`; Vercel and local still resolved to the old credential and no
deployment was created. Vercel CLI 58.11.0 rejected the documented all-target
stdin form unless a target was supplied. The existing project variable is one
exact `encrypted` entry spanning Development, Preview, and Production; it cannot
be converted wholesale to `sensitive` because Vercel supports that posture only
for Preview and Production. Recovery therefore preserves that exact legacy
shape and updates the pinned variable by REST identifier with its request body
on stdin. Splitting Development from a sensitive Preview/Production entry is a
separate post-incident hardening task. The replacement operator may rebind only
the exact mode-`0600` `github-updated` journal from commit
`4b703f9fd0cc7e8a94c745866b401a1ed781dd3f` / CI `33644395842`, after proving
the journal's exact old and replacement keys still comprise the complete
provider inventory.
