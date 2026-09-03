# Shipping-rate secret credential recovery

Last updated: 2026-09-03

This is the canonical operator record for replacing the exposed
`SHIPPING_RATE_SECRET` without invalidating an in-progress checkout or allowing
an old deployment to mint a token the new deployment cannot verify. It is part
of the comprehensive credential incident and does not authorize a database
migration, RLS change, Stripe mutation, provider cleanup outside the exact
shipping variables, or deployment deletion.

## Accepted compatibility boundary

- Source: exact main `a4c74bbaeded1e347ec582289a226eae24763faf`
- CI: `33683844324`
- Live compatibility deployment: `dpl_Ec5mLGwhv3jXWEa88z2BeUs5N3j7`
- Preserved predecessor: `dpl_GfJdUoqm6gCMGi8CMEExWVEN5xRC`
- Four canonical aliases: `thegrainline.com`, `www.thegrainline.com`,
  `grainline.vercel.app`, and
  `grainline-drew-youngs-projects.vercel.app`
- Compatibility posture: `shipping-rate-v2` signs with current, verification
  accepts current plus one distinct optional previous secret, predecessor v1
  tokens remain bounded by the existing 30-minute TTL and five-minute future
  skew, and canonical health is 200.

The current secret is still the exposed original at this boundary. The
temporary previous variable is absent. This is intentional: the application
must understand both keys before the key changes.

## Accepted production rotation

- Operator main: `568b29dbea96f1874dda0145db49b52c87ca964d`
- Exact-main CI: `33699848311`
- Dual deployment: `dpl_C9K42kdtuY2W74xPWZsZowkYwP94`
- Final replacement-only deployment: `dpl_4La1GXphy21feYp4AdYgT7Q2Zs7f`
- Drain: 2,100 seconds, beginning only after all four canonical aliases
  resolved to the dual deployment
- Evidence:
  `shipping-rate-secret-credential-recovery-20260902.json`, mode `0600`,
  SHA-256
  `c9c79ae60656de78365276f1ddd83796958391a26493817fae61376367284161`

The temporary Production previous row is absent. All three current Vercel
rows, GitHub and the ignored local consumer contain only the replacement. All
four canonical aliases resolve to the exact final deployment, health returns
200, the real verifier accepts the replacement and rejects the exposed
original, and the private restart journal is absent. The operator's completed
read-only path reverified those same provider, deployment, alias, GitHub, local
and health invariants after evidence creation.

## Exact consumer inventory

The operator pins these project-local encrypted current rows and rejects every
extra, missing, duplicated, retargeted or branch-scoped row:

| Target | Vercel environment row |
|---|---|
| Preview | `QtdQdIWG7kRGIfU4` |
| Development | `Qr10JAPww1OXr8JX` |
| Production | `Sux1asRFN0hfoiok` |

The repository GitHub secret and mode-`0600` local `.env.local` current value
are also updated. Only Vercel Production receives a temporary encrypted
`SHIPPING_RATE_SECRET_PREVIOUS` containing the original. GitHub, local,
Development and Preview must never retain the original as a previous value.

## Operator

Script:

`scripts/shipping-rate-secret-credential-exposure-recovery.mjs`

Command after the operator is merged to exact main and exact-main CI succeeds:

`npm run ops:recover-exposed-shipping-rate-secret -- --operator-commit <exact-main-commit> --operator-ci-run <same-commit-successful-ci-run>`

The command must run from that exact clean main checkout. The separately
dedicated deployment checkout must remain clean at compatibility source
`a4c74bbaeded1e347ec582289a226eae24763faf`. The operator rejects a dirty or
mismatched checkout, stale or non-push CI, changed project protection, alias
split, source/deployment drift, provider-row drift, any secret digest outside
the original/replacement pair, and any ambiguous marked deployment.

The stages are restart-safe and monotonic:

1. Verify exact Git, CI, source, deployment, alias, provider and local state.
2. Generate a replacement in memory and persist both values only in the
   private restart journal.
3. Create one Production-only previous row containing the original.
4. Converge the three exact current Vercel rows to replacement, then GitHub and
   local current consumers.
5. Build the exact accepted source with current=replacement and
   previous=original, verify its marker, and promote all four aliases together.
6. Prove current and previous tokens through the real `verifyRate()` code and
   wait at least 2,100 seconds (30-minute TTL plus five-minute skew).
7. Delete only the recorded temporary previous row.
8. Build and promote the same source with replacement only.
9. Prove the replacement accepts and the original rejects, reverify provider
   rows, aliases and canonical health, write sanitized evidence, and remove the
   private journal.

The completed-rerun path is also fail closed. If a crash lands after sanitized
evidence is durably written but before the private journal is removed, the next
run must rebind the evidence and journal to the exact operator commit and CI,
reverify the Vercel values and final deployment, local value, GitHub secret
metadata, aliases and health, and only then remove that exact journal. A stale,
partial or differently bound journal is preserved and rejected.

The operator prints only stage/countdown information and the final evidence
path/deployment ID. It never prints a raw secret or raw dependency error.
Vercel body mutations intentionally use silent responses; empty output is
accepted only for the reviewed POST, PATCH and DELETE methods, and every such
mutation is independently verified by an exact provider read afterward.

The first exact-main execution from `636b1b5afd6fb323376954e8db615168463467b9`
and CI `33689091625` failed closed before creating a restart journal or changing
provider, deployment, GitHub or local state. An initial sanitized diagnostic
used nullish coalescing and displayed an omitted `customEnvironmentIds` field as
`null`; the first correction therefore accepted literal `null` but did not
address the actual provider response. The corrected retry from
`1afe205c7fccbc0fcd5cf29f7eb03a8ad739f00e` and CI `33694247625` also stopped
before journal creation or mutation. A direct field-presence rehearsal then
proved Vercel omits `customEnvironmentIds` for the exact Production-only row in
both inventory and exact-value responses, while Preview and Development expose
explicit empty arrays.

The final reader permits an omitted custom-environment field only when the
pinned expected target is exactly Production. Literal `null` or an empty array
also represent no custom binding. Omission on Preview or Development, an
explicitly present `undefined`, a malformed value, or a nonempty array remains
rejected. Every response must still prove the exact row ID, key, encrypted type,
target and absent branch/configuration binding; exact-value responses must also
prove decrypted status, minimum length and the reviewed digest. Read-only
re-attestation confirmed the compatibility deployment, all aliases, project
protection, both CI bindings, GitHub inventory and all three original current-
secret digests remained unchanged after both stops.

The next exact-main run from `986eb8ae6e3c0a7412cba761e50b138c00681ae8`
and CI `33696802964` passed preflight and converged the replacement current
secret across the exact three Vercel rows, GitHub and local, with the original
stored only in the one temporary Production previous row. It created exact
READY dual deployment `dpl_C9K42kdtuY2W74xPWZsZowkYwP94`, but Vercel's
`promote` moved only `grainline-drew-youngs-projects.vercel.app`; the other
three canonical aliases remained on compatibility deployment
`dpl_Ec5mLGwhv3jXWEa88z2BeUs5N3j7`. The operator rejected that partial alias
state before starting the drain and preserved its mode-`0600` journal at
`dual-ready`. Both exact deployments run the compatible verifier, so the
partial provider transition did not break token verification.

The recovery path is pinned to that exact journal, previous-row ID, old and
replacement digests, dual deployment and ordered alias vector. A corrected
exact-main/CI run may rebind that one journal only after re-verifying the
replacement/previous provider pair, local replacement, exact dual deployment
marker and the exact partial aliases. Alias convergence accepts only the
reviewed from/to deployment pair, assigns each remaining canonical alias
idempotently, and refuses an unknown target. The 35-minute drain starts only
after all four aliases resolve to the dual deployment. The same restart-safe
convergence is used for the final deployment so old-secret rejection cannot be
accepted while any canonical alias remains on the dual artifact. Every restart
at or after `dual-ready` also re-attests the exact provider current/previous
digest posture, local replacement-only posture and GitHub secret inventory
before it can move an alias, wait a drain or advance a stage.

## Private and sanitized artifacts

Private restart journal (contains secrets; mode `0600`; never copy into Git):

`grainline-rollout-evidence/.shipping-rate-secret-credential-recovery-20260902.private.json`

Sanitized accepted evidence (mode `0600`):

`grainline-rollout-evidence/shipping-rate-secret-credential-recovery-20260902.json`

If the process stops, retain the private journal and resume the same exact
operator commit/CI binding. Do not start a competing attempt, manually create
or delete a previous row, manually edit one of the three current rows, or
promote a different source. If the code itself needs correction after a
partial mutation, stop and add an explicit, evidence-bound rebind path; never
weaken the normal exact binding.

## Acceptance and residual scope

This credential family was accepted only after confirming:

- all three current Vercel rows contain the replacement and no previous row
  remains;
- GitHub and local current consumers were converged without a previous value;
- all four aliases resolve to the exact final READY deployment from the pinned
  source;
- canonical health is 200;
- the real verifier accepts a replacement token and rejects an original token
  after the full drain;
- sanitized mode-`0600` evidence exists and the private journal is removed.

That acceptance closes this exposed HMAC key; it does not prove the entire
credential incident complete. Continue with the remaining exposed families,
then run one fresh authenticated end-to-end Order smoke. Only that incident
closure permits the paused Order RLS sequence to resume.

Separate product limitations remain documented rather than hidden inside the
security rotation: the bounded platform fallback can be economically
imprecise for large woodworking, multi-item quotes use a one-parcel
weight/dimension heuristic rather than a packing engine, and legacy standalone
free-shipping thresholds without a configured flat rate remain ignored.
