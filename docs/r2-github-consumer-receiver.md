# Verify the application R2 GitHub fingerprint artifact

The receiver closes the source implementation gap between a runner-produced JSON
payload and an independently checked GitHub run. It is disabled by default,
read-only, and has no CLI, dispatch or production mutation action. No live run has
been received. Preparation does not establish GitHub credential equality.

## Components

- `r2-github-consumer-receiver.mjs` checks provider metadata and artifact contents.
- `r2-github-consumer-transport.mjs` implements bounded native HTTPS GETs and wraps
  them in an explicit authorization supplier whose postchecks must pass.
- `r2-github-artifact-reader.mjs` decodes one expected JSON file in memory without
  extracting a ZIP to disk or invoking external commands.

The trusted caller supplies a reviewed scope: numeric repository/workflow/run/
attempt/artifact/actor IDs; exact main commit; SHA256 of the reviewed workflow and
script bytes; fresh nonce and original Vercel snapshot digest; captured and
dispatch timestamps; pair/five field hashes; and the five repository secret
metadata revisions captured before dispatch. The scope is copied before use.
It cannot contain arbitrary endpoints, source paths, artifact names or secrets.

The scope must come from an independently saved dispatch record, not an artifact
or untrusted remote request. The producer workflow and script hashes are trusted
review inputs, not a substitute for reviewing their behavior. The receiver binds
the GitHub Contents API responses to those hashes at the exact commit.

The receiver requires a completed successful manual main run from the expected
repository, head repository, workflow, actor and attempt, created after the
recorded dispatch. Exactly one successful job must include the two intended
comparison/upload steps. The exact artifact must belong to that run, main commit
and repository, remain unexpired, and have a SHA256 digest and bounded size that
match its downloaded ZIP bytes. An old-attempt artifact, failed/skipped step,
foreign fork, changed source or mismatched nonce refuses acceptance.

Each of the five named repository secret metadata endpoints is checked before
and after receiving the artifact. A missing repository secret cannot silently be
substituted with an inherited organization secret. Run and artifact metadata are
checked again before returning. Stable metadata cannot exclude an ABA change
between observations or changes within a provider's timestamp resolution, so
`atomicSecretSnapshotProven` remains false. The proof is historical, not perpetual
credential equality; mutation admission still needs coordination and revalidation.

## Download and archive boundaries

The native transport sends authentication only to fixed `api.github.com` GET
paths. JSON responses are bounded to 1 MiB. It accepts a single 302 for the exact
artifact archive and then a credential-free HTTPS download from a subdomain of
`blob.core.windows.net` or `actions.githubusercontent.com`. Credentials in URLs,
ports, fragments, other hosts, another redirect, non-200 content, invalid UTF-8,
truncation and oversized bodies refuse. There are no retries or proxy-environment
lookups. Each request has a 20-second timeout within a 45-second receipt deadline;
the authorization wrapper also checks its deadline after the supplier returns.
Signed storage URLs, authorization and provider error bodies are never emitted.

ZIP bytes are capped at 256 KiB and inflated JSON at 16 KiB. The parser supports
stored/deflated entries and 32-bit data descriptors. It checks directory/local
name agreement, CRC, exact sizes, offsets, entry count and the reviewed filename.
Symlinks, directories, extra entries, comments, prepended/trailing content, ZIP64,
encryption, traversal and decompression over the limit refuse. Supported provider
format changes require explicit review rather than silently relaxing the parser.

The returned receipt has `providerRunProvenanceVerified: true` only after all
checks and authorization postchecks succeed. It still has
`consumerConvergenceProven: false`, `credentialRotationAccepted: false`, and
`productionMutationPerformed: false`. It does not activate RLS, certify deployed
runtime credentials, or admit old-key retirement.

## Remaining integration

The workflow has an isolated main-based integration candidate. Durable dispatch
journaling, native GitHub CLI authorization and read-only recovery now compose
this receiver; see `r2-github-consumer-dispatch.md`. Main integration and a fresh
concrete reviewed scope from an actual dispatch remain required for live proof.
The receiver does not invent a run, auto-dispatch, or accept synthetic tests as
live provider evidence. No live provider calls are part of its tests.

Provider contracts consulted September 21:
[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs),
[attempt jobs](https://docs.github.com/en/rest/actions/workflow-jobs), and
[artifact metadata/download](https://docs.github.com/en/rest/actions/artifacts).
