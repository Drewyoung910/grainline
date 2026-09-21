# Application R2 credential identity in GitHub Actions

GitHub's secret API returns metadata, not the stored values. A matching name or
timestamp does not establish that CI uses the reviewed Vercel/local pair.
The new `r2-application-consumer-proof.yml` is a manual-only, main-only workflow
that compares the five application R2 secret fingerprints on a runner. It has
not been merged, dispatched or accepted as live evidence.

Only the comparison step receives those five secrets. The job has no GitHub
environment, protected cleanup credentials, database credentials, npm install,
application build, R2 SDK or object/network operations in its comparison script.
Checkout, Node setup and artifact upload use immutable official action commits.
No source is checked out from an input: checkout uses `github.sha`, and the script
compares its actual Git HEAD with the reviewed commit and workflow context.

The three manual inputs are `release_commit`, `confirmation` (exactly
`prove-reviewed-r2-application-consumer`) and `review_json`. The JSON is bounded
to 4096 characters and has exactly these fields:

- `nonce`: a fresh random 32-byte value, hex encoded;
- `commitSha`: the reviewed main commit;
- `snapshotSha256`: SHA256 of the precise reviewed Vercel/local evidence bytes;
- `capturedAt`: that evidence's ISO timestamp, at most five minutes old;
- `pairSha256`: the reviewed credential-pair hash;
- `valueSha256`: hashes indexed by the five full `CLOUDFLARE_R2_*` setting names.

Inputs contain no credentials. Input text enters environment variables, never
shell interpolation. Missing/different keys, stale evidence, fork/branch/event
changes, other workflow/job identities, wrong source commits or protected/private
credentials refuse without returning hashes or disclosing diagnostic values.

Success writes a new mode-0600 `r2-application-consumer-<run>-<attempt>.json`
artifact in `RUNNER_TEMP`. Existing files and symlinks are never overwritten.
Only a successful step proceeds to the exact-file artifact upload; no directory,
environment file or failed diagnostics are uploaded. The record contains hashes,
nonce, source/run identity, timestamp and explicit non-acceptance flags.

## Outstanding execution and provenance

This workflow needs a reviewed main integration and a deliberate dispatch before
it can produce live evidence. An independent receiver must verify the real
GitHub repository, exact workflow bytes/commit, workflow_dispatch event, main
source SHA, run ID/attempt, successful job, artifact identity/digest and fresh
nonce against its recorded dispatch. The JSON's self-reported fields alone are
not provider provenance; `providerRunProvenanceVerified` remains false.
The native receiver is now implemented separately; see
`r2-github-consumer-receiver.md`. Durable dispatch, read-only lost-response recovery
and the native GitHub CLI authorization supplier are also implemented; see
`r2-github-consumer-dispatch.md`. Main integration and live execution remain
unfinished. No live GitHub proof is accepted.

The record proves a fingerprint comparison at that run's secret-resolution time,
not perpetual secret equality or current credentials in old deployments. Repository
secret metadata and its revisions still need to be bound around the run so that
an inherited organization secret cannot silently replace the intended repository
source. Later secret changes require a new proof. This artifact cannot yet be
cast into the consumer planner's stronger all-consumer snapshot, and it does not
authorize credential rotation, old-key retirement, deployment or Order RLS.

References verified September 21:
[GitHub Actions secret API](https://docs.github.com/en/rest/actions/secrets)
and [manual workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
# Failure diagnostics

Failed comparisons still exit nonzero and create no successful artifact. The CLI
now prints one fixed failure code after its generic refusal. Codes distinguish
execution/source binding, run identity, review shape/freshness, credential boundary
or format, field mismatch, pair mismatch, and artifact output failure. A field
code contains only one of the five predefined setting names; no actual/expected
values, hashes, provider error text or arbitrary environment keys are printed.
This does not relax any acceptance condition or substitute a failed run for proof.

The first live comparison, run 35646359166, failed with all five settings populated
and no artifact. Its generic refusal did not establish a settings mismatch or
identify a runner failure. Preserve that result; diagnostics enable a corrected
future attempt to identify the cause without guessing or exposing credentials.
