# Hosted preparation observation

This directory adapts the accepted disposable Linux preparation to the actual
GitHub tool cache and exact pushed proof commit. It only prepares, checks status
and closes a worker. It has no load, admission, database or migration path.

The workflow runs only for pushes to
`proof/order-hosted-preparation-20260913`, with `contents: read`, normal checkout
credentials not persisted, no provider secrets or environment, and no databases.
The exact branch is disabled in Vercel's deployment configuration. Do not open a
PR for this proof branch: existing general PR CI has a different credential scope.
This snapshot branch is a proof fixture, not a replacement for the active Order
branch or a merge-ready release. Its production workflow remains disabled.

`hosted_prepare.py` verifies GitHub context claims, actual tool-cache Node/npm
bytes and the full vendor npm inventory, then clones the exact pushed source
into a new private attempt. Source catalog values are observed for the proof;
they are not independently reviewed production release inputs. The accepted
`run_linux.py`, `prepare_only.mjs`, `prepare_lifecycle.mjs`, `pins.json` and npm
inventory are reused byte-for-byte and checked before use. The original worker
and launcher timeouts are unchanged. No entire attempt/cache/home is uploaded.

The artifact contains only `context.json`, `source-observation.json`,
`worker-preparation.json`, `result.json` and `SHA256SUMS` (fewer on failure).
Upload requests 14 days of retention. GitHub deletes hosted runner temporary
storage; only this bounded artifact is intended to survive. Never assume full
attempt retention on a hosted runner. Failed jobs remain failed even if upload
succeeds. Early checkout/toolchain/preflight failure may have no artifact.

After a separately authorized run, independently obtain its exact commit, run
ID/attempt, successful job identity, current runner version from the setup job
record, and artifact metadata/archive using authenticated GitHub reads. Keep
raw job logs out of durable evidence. The metadata input to `verify_download.py`
contains `run`, `artifact` and `runnerVersion`; use selected GitHub API fields as
validated by that script, never values copied from the artifact itself.

Run the offline verifier on the downloaded ZIP, bounded metadata JSON and the
independently expected pushed commit. It checks archive digest, membership,
manifest, run/source binding, minimum runner version and absence of release
authority. It does not authenticate its metadata input. Provider acceptance
requires the external authenticated retrieval and reviewer record. Context
environment claims alone are not that acceptance, and no outcome of this proof
establishes final-main CI, production token budget, production evidence delivery,
incident closure, database compatibility or Order ENABLE/FORCE.

Local tests: `python3 -B -W error -I tests/order_hosted_preparation_test.py`.
These test the new orchestration/refusal and offline retrieval contracts, not
actual hosted execution. Do not replay already accepted local Linux preparation
as a substitute for running the hosted check.

References: [GitHub runner variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables),
[Vercel branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).
