# Dispatch and recover the application R2 fingerprint proof

The dispatcher completes the connection between a reviewed snapshot, the manual
GitHub workflow and the native receipt receiver. It remains disabled by default.
Source preparation, tests and CLI authorization readiness are not a live proof;
the workflow still needs main integration before dispatch.

## Execution boundary

`dispatchR2GitHubConsumer` takes an explicit mode-0700 canonical journal directory,
`enabled: true`, a reviewed scope and an authorization callback. Its review has
exactly `repositoryId`, `workflowId`, `actorId`, `commitSha`, `workflowSha256`,
`scriptSha256`, `nonce`, `snapshotSha256`, `capturedAt`, `pairSha256` and
`valueSha256`. These are the receiver's pre-dispatch fields; run/attempt/artifact
identities and secret metadata cannot be supplied as unchecked review claims.
The caller must review the source hashes, preserve the original snapshot bytes,
generate a fresh cryptographically random 32-byte nonce, and use one directory
for that attempt. Never copy an unresolved attempt into a new directory to retry.

The native adapter reads the fixed repository, authenticated actor, exact active
workflow, reviewed workflow/script bytes, all five repository-secret metadata
rows and current main SHA. It rejects foreign/inactive/drifted source or stale
review data before recording intent. The existing runner also compares actual
checkout SHA, so a main change after the final GET cannot produce accepted proof
under the old commit. This does not provide a compare-and-swap dispatch API.

`intent.json` is exclusively created and file/directory-fsynced before any POST.
It binds the complete review, observed secret revisions and dispatch timestamp.
Only then may one POST target the fixed numeric workflow in the fixed repository,
with main, exact release commit, fresh hash-only review JSON and confirmation.
The adapter uses API version `2022-11-28` and requests `return_run_details: true`.
A successful 200 must return the numeric run ID and exact expected URLs. Legacy
204 acknowledgement is retained without inventing a run ID. Redirects, other
statuses, oversized/truncated/invalid content and transport errors refuse.
No error body, authorization header or download URL is recorded.

`acknowledgement.json` is saved only after authorization postchecks pass. It
explicitly leaves `providerRunProvenanceVerified: false`. If the POST, response,
postcheck or journal write fails, keep the intent. Re-entering the dispatcher
with that directory refuses before network access, including after a 403. It
never concludes that an absent acknowledgement proves no run was created.

## Recovery

Call `recoverR2GitHubConsumerDispatch` with the same directory and explicit run
and artifact IDs. A recorded run ID cannot be replaced by another candidate.
Where no ID was acknowledged, these IDs are only lookup coordinates: the native
receiver must independently verify run/main/source/actor/first attempt, job,
artifact provenance/digest, secret revisions and the original nonce. No latest-run
heuristic is trusted. Recovery uses GETs only and never re-dispatches or re-runs.
The first-attempt restriction prevents a re-run with newly resolved secrets from
being attributed to the original request.

The receiver's 15-minute dispatch window and five-minute snapshot-to-comparison
window remain unchanged. Stale, failed or ambiguous attempts stay unresolved;
they cannot be repaired by editing timestamps or lowering thresholds. A new
attempt requires fresh evidence and deliberate disposition of the old run.
No global cross-host idempotency guarantee is claimed.

Only a successful native receipt plus authorization postchecks creates immutable
`receipt.json`. File symlinks, hardlinks, permissive modes, modified records and
partial files refuse. An exclusive lock is never stolen after a process crash;
confirm the prior process is gone and inspect the saved records before deliberate
lock recovery. These are local crash-recovery records, not off-device backups or
protection against a malicious process running as the same operating-system user.

## Existing GitHub login

`makeR2GitHubCliAuthorization` composes directly with both dispatcher and receiver.
Provide the canonical absolute installed `gh` executable, its reviewed SHA256,
canonical home and explicit GitHub config directory. The helper validates the
binary, calls `gh auth token --hostname github.com` with a minimal environment,
passes the captured token to the callback, and verifies unchanged authorization
and executable afterward. It inherits no GH_TOKEN/GITHUB_TOKEN, shell or proxy
environment. Each CLI call has a 10-second timeout and 4-KiB output bound; the
composition has a 45-second bound. Buffers are cleared and errors sanitized;
JavaScript strings cannot be reliably erased from process memory.

The native helper was exercised against the installed CLI without printing the
token or dispatching a workflow. Normal host credential-store access was required;
the sandboxed attempt refused and the authorized host attempt passed. This proves
credential retrieval/postcheck availability, not GitHub secret equality.

The overall sequence is: reviewed main integration; fresh Vercel/local snapshot;
review construction with pinned source hashes and current workflow/actor identity;
one dispatch; inspect that exact run/artifact; native recovery/receipt. This module
does not change repository secrets, R2 credentials/objects, Vercel settings,
application deployments or Order RLS. Receipt convergence/rotation flags remain
false; deployment credentials and cutover admission are separate work.

Provider contract checked September 21:
[GitHub workflow dispatch API, including optional run details](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event).
