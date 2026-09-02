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
- update the GitHub repository secret, the exact pinned legacy Vercel
  `encrypted` all-target variable, and the ignored local file without printing
  the replacement;
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

The exact replacement deployment was promoted on 2026-09-02 and the provider
successfully revoked the original key, but the operator deliberately stopped
before final evidence because Resend reports a revoked key as the exact response
`400 validation_error: API key is invalid`; the initial proof admitted only
HTTP 401 or 403. The replacement remains the sole provider key and authenticates,
while the original returns that exact invalid-key response. The restart-safe
correction accepts that one observed 400 tuple in addition to 401/403 and rejects
every other 400 response, so it can complete evidence without creating another
key, deployment, promotion, or revocation.

The same correction also recognizes only the exact promoted stop from operator
`b8cfb03e76f0f2d6a06d3ed91dde8e782122b09b` / CI `33647162942` when the
complete provider inventory is the one expected replacement key and the old key
is absent. This is required because the old-key deletion succeeded before the
original rejection assertion stopped. It cannot rebind a pre-promotion stage,
an inventory that still contains the old key, or any unknown or duplicate key.

## Completed Resend family

The Resend credential family completed on 2026-09-02 from operator commit
`7e493e1f0cb0c434506ce2b468cc9b4f72920fcf` and exact-head CI
`33651462243`. PR #403 merged the final restart-safe provider-response and
promoted-state handling. The provider inventory contains exactly one key:
replacement key `9a09feea-7706-4867-98c5-abb943212d2e`, named
`grainline-production-recovery-20260902`. The original exact key is absent and
its credential returns the provider's exact invalid-key response.

GitHub repository, Vercel, and ignored local consumers converged on the
replacement credential. All canonical aliases point to READY deployment
`dpl_7DA9fNtQZV27smqAvSEJ6RrjtnC9`, built from unchanged application source
`b22fa138d84bad792ba206ee00dacb48d475d4a4`. The canonical homepage and health
route returned HTTP 200. No migration ran, no email was sent, and the private
restart journal was removed only after evidence finalized.

Accepted Resend evidence:

- path: `resend-credential-recovery-20260902.json`;
- SHA-256:
  `12106d0a0ae751a4de6d2f70e3a25513a0413b8dff983121eda4b1a5e6ed682e`;
- mode `0600`;
- status `passed`, `acceptanceEligible=true`, and `issueCount=0`;
- replacement authenticated and original credential rejected; and
- no secret-shaped credential value in the sanitized evidence.

## Cron bearer family

`CRON_SECRET` is the next application-generated credential family. Every cron
route and the middleware use the shared timing-safe `verifyCronRequest()`
boundary. That boundary already accepts `CRON_SECRET_PREVIOUS`, so recovery can
preserve scheduled and in-flight requests while changing the current bearer.

The production inventory changes the deployment-drain requirement. Vercel
project `prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp` has deployment protection set to
`all_except_custom_domains`. Historical generated deployment URLs therefore
require Vercel SSO and are not publicly callable with the exposed cron bearer
alone. They are not deleted as part of this credential family. The operator
must fail if that protection posture changes, and a historical artifact may
never be promoted as rollback: rollback requires rebuilding its Git source with
the current credentials.

The restart-safe operator is
`scripts/cron-secret-credential-exposure-recovery.mjs`. It must:

- bind a clean exact operator commit, successful exact-head CI, the clean
  unchanged source `b22fa138d84bad792ba206ee00dacb48d475d4a4`, current READY
  deployment `dpl_7DA9fNtQZV27smqAvSEJ6RrjtnC9`, and all three canonical
  aliases;
- pin the exact team-shared `encrypted` all-target `CRON_SECRET` record
  `env_Z5Adun6D9lSNFwiy53ucs4GK` and require that no previous-secret record
  already exists;
- create one temporary shared `CRON_SECRET_PREVIOUS` containing the replacement
  bearer while current remains old, then deploy and promote a bridge artifact
  that accepts old plus new;
- atomically converge the shared pair to current=new and previous=old, update
  the GitHub repository secret and ignored local file, and compare only SHA-256
  markers;
- deploy and promote the unchanged source again with new plus old, proving on the
  nonexistent `/api/cron/__credential-recovery-probe__` path that current and
  previous bearers pass middleware to a 404 while a wrong bearer receives 401;
- retain the dual deployment for 330 seconds, longer than the reviewed maximum
  request duration, without blocking a process in a long sleep;
- delete the temporary previous shared variable, remove the local previous
  value, deploy and promote the unchanged source a third time, and prove current gives
  404 while both old and wrong bearers give 401 on canonical Production;
- restore the dual deployment automatically if the final authentication proof
  fails after promotion;
- verify homepage and health HTTP 200, reverify deployment protection and
  alias/source identity, then emit mode-`0600` sanitized evidence and remove the
  private journal; and
- contain no migration, RLS, database, broad deployment-removal, raw-secret
  output, or unrelated provider mutation surface.

The 404/401 probe is deliberately side-effect-free: middleware authenticates
the `/api/cron/*` namespace before routing, while the named probe route does not
exist. It proves the bearer boundary without starting a cron run or touching a
business table. A fresh full authenticated Order smoke remains deferred until
all exposed credential families have been replaced.

The bridge is intentional. Vercel documents that it sends the configured
`CRON_SECRET` as the bearer for Production cron invocations and that environment
changes require redeployment. A bridge artifact containing both values keeps
scheduled calls valid whether the invocation service observes the deployed or
newly configured current value during the cutover.

PR CI run `33657802150` passed the complete migration, authority, PostgreSQL,
type, lint, and test gates but then failed the blocking dependency audit because
the newly published `fast-uri` high-severity advisory covered the locked
`3.1.5` release. The correction is deliberately lockfile-only: resolve the
existing compatible transitive range to `fast-uri@3.1.7`, with no direct
dependency, broad update, `npm audit fix`, or force upgrade. The exact local
dependency gate then reported no high or critical vulnerability. The remaining
moderate-only Tiptap and `qs` advisories are a separate dependency-security
follow-up; they do not weaken or reorder the exposed-credential recovery.
Replacement CI run `33665768385` then failed only because the fail-closed
dependency-hygiene contract still pinned the reviewed predecessor `3.1.5`;
the contract is intentionally advanced to the exact patched `3.1.7` release.

The first production CRON recovery attempt from exact main
`901a3e430107cf15fa0ef2957adb0c988bf41938` / CI `33668569663` stopped at the
initial `preflight` stage. It created one exact temporary team-shared
`CRON_SECRET_PREVIOUS`, but Vercel correctly exposed that linked shared value to
Production without materializing a second project-local environment row. The
operator incorrectly required such a duplicate row and failed closed before any
deployment, alias promotion, GitHub/local consumer update, or current-secret
change. The exact temporary shared variable was then deleted, effective
Production hashes were reverified as current=unchanged and previous=absent, and
the unused mode-`0600` private journal was removed.

The corrected invariant distinguishes the two provider views: the shared
inventory must contain the exact temporary previous variable, while the project
inventory must contain only the pinned current link and reject every
project-local `CRON_SECRET_PREVIOUS` shadow. Effective Production SHA-256
markers—not a duplicate project row—prove that the shared previous value is
actually linked and resolved. Creation, dual-secret convergence, and deletion
all recheck both the shared record and the absence of a project-local shadow.
The exact temporary-record deletion also supplies Vercel CLI's required
noninteractive DELETE confirmation flag only for that fenced request; without
it, the CLI refuses the request before changing provider state.

The second production CRON recovery attempt from exact main
`1590f641105eb241b1f6f88f4b5202ef590cb771` / CI `33672732081` created and
promoted bridge deployment `dpl_CkSvMUPv3w7bWC7g4iZaiMMJ34Dy`. The bridge is
built from unchanged application source and accepts both the original and
replacement bearers. The shared-variable batch update then reached its intended
stored state (current=replacement and previous=original), but the operator
stopped at `bridge-promoted` because Vercel returned an empty successful PATCH
response that the response parser rejected. No GitHub or ignored-local consumer
was updated and no later deployment was created.

Post-failure inspection found a second, independent provider layer that the
first inventory contract had misclassified. Project environment row
`LRWsHUt7PHsP3rRg` is a project-local `CRON_SECRET` shadow, not the linked
representation of shared record `env_Z5Adun6D9lSNFwiy53ucs4GK`. The shared
current and previous records have the reviewed replacement/original digests,
while the project shadow keeps effective Production at original/original. This
is safe during recovery because the canonical bridge accepts both values, but
the shadow must be removed before a replacement-only artifact can be built.

The corrected recovery contract therefore:

- reads and hashes each exact decrypted shared record without printing its
  value, and separately reads effective Production digests;
- accepts only original/replacement permutations while the bridge is canonical,
  rejecting every third value, unknown row or partial alias state;
- treats an empty successful shared PATCH response as valid only for the exact
  `/v1/env` update and proves the stored result afterward;
- deletes only exact project shadow `LRWsHUt7PHsP3rRg` through the exact
  project/environment route after stored shared convergence, then polls until
  effective Production resolves replacement/original;
- expects zero project-local CRON rows after the shadow is removed while still
  requiring both shared records to remain linked to Grainline; and
- rebinds the preserved mode-`0600` restart journal only from the exact
  `bridge-promoted` commit, CI, deployment, shared-record, and credential-digest
  checkpoint above to a new clean exact-head operator and successful CI run.

The bridge promotion, shared updates and private restart journal all survived
the local interruption. The journal must remain in place until sanitized final
evidence is written; it is the only recoverable source for the original and
replacement bearer values.

The corrected restart-safe recovery completed from exact main
`0002c823f2ade59962fd595ab4362c49ec9753f9` / CI `33677171729`. It resumed
only the sealed `bridge-promoted` journal, removed exact project shadow
`LRWsHUt7PHsP3rRg`, and promoted dual deployment
`dpl_Eco3YiDjSFFwLKiS534ZVYRTszMY` after effective Production converged to
current=replacement and previous=original. After the full 330-second drain, it
deleted only the temporary shared previous record and promoted final unchanged-
source deployment `dpl_GfJdUoqm6gCMGi8CMEExWVEN5xRC`.

Final acceptance proved the replacement bearer reaches the side-effect-free
probe boundary, both the original and a wrong bearer are rejected, homepage and
health remain HTTP 200, the canonical aliases and source binding are exact, the
GitHub repository secret and ignored local current value are converged, and no
local previous value or project-local CRON row remains. The private journal was
removed only after mode-`0600` sanitized evidence finalized. No migration, RLS,
database, Stripe, or provider state outside Vercel and the GitHub/local CRON
consumers changed.

Accepted CRON evidence:

- path: `cron-secret-credential-recovery-20260902.json`;
- SHA-256:
  `c1a076b3fb550e138b8bbc7af9a1db2d3a289cd777b2578878b90aa1069c480e`;
- mode `0600`;
- status `passed`, `acceptanceEligible=true`, and `issueCount=0`; and
- replacement accepted, original rejected, and no raw credential value in the
  sanitized evidence.

## Shipping-rate HMAC family

`SHIPPING_RATE_SECRET` is the next application-generated credential family.
The pre-rotation application audit found a real destination-binding gap in the
postal-only predecessor token and two narrow quote UX defects. Recovery must
therefore ship the compatible application correction before changing provider
or consumer state:

- new `shipping-rate-v2` signatures bind normalized city, valid US state, US
  ZIP and country in addition to the exact predecessor rate, buyer, context and
  package/price subject;
- verification accepts exact predecessor v1 tokens only while they remain
  unexpired and accepts one distinct `SHIPPING_RATE_SECRET_PREVIOUS` only during
  the reviewed rotation window;
- signing always uses current `SHIPPING_RATE_SECRET`;
- quote and checkout reject non-US, invalid-state or invalid-ZIP destination
  shapes consistently;
- pickup-only Shippo failure retains an explicit warning; and
- the client refreshes visible rates one minute before expiry.

The production rotation must deploy that verifier first under the current key,
then converge all three exact Vercel current rows plus the GitHub/local current
consumers to the replacement. Only Vercel Production receives the temporary
previous=original verifier; Development, Preview, GitHub and local do not retain
the exposed value. Deploy the same reviewed source and wait at least 35 minutes
before removing Production previous. Final acceptance requires the current key
to sign and verify, the original key to reject, no previous-key residue, exact
deployment/source/alias binding, canonical health, sanitized mode-`0600`
evidence and removal of the private restart journal. The operator contains no
migration, RLS, database, Stripe, broad deployment-removal or raw-secret output
surface.
