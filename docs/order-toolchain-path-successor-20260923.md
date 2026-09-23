# Dormant Order toolchain path successor — September 23, 2026

The disabled Order inspection workflow previously required five protected
toolchain variables, including an absolute `ORDER_ZERO_DIRECT_NPM_CLI` path.
The absolute path is chosen by `actions/setup-node` on the hosted runner and
cannot be established from the historical vendor archive alone. This private
successor removes that variable and derives the CLI path from the active,
reviewed Node executable: its installation's
`lib/node_modules/npm/bin/npm-cli.js`. The credential-free preflight hashes
that exact regular file and checks its npm package version before the owner
credential is available. The read-only runner hands the same derived path to
the fixed-cwd worker, which repeats its file identity and digest checks.
An inherited `ORDER_NPM_CLI` override now fails closed.

The remaining four variable names are `ORDER_ZERO_DIRECT_NODE_VERSION`,
`ORDER_ZERO_DIRECT_NODE_SHA256`, `ORDER_ZERO_DIRECT_NPM_CLI_SHA256`, and
`ORDER_ZERO_DIRECT_NPM_VERSION`. The local retained Linux Node archive hashed
to the pinned archive digest `d60acfe0…f307`; streaming its Node binary and
npm CLI produced the exact digests in `order-handoff-toolchain-pins.json`, and
the npm package reported version `10.9.8`. The resulting exact non-secret
candidate values are in `order-toolchain-variable-candidates-20260923.json`.
This verifies retained archive bytes, not actual hosted-runner placement or
Linux execution. The
workflow job remains `if: false`, and no variable was installed. Five focused
preflight/runner tests passed. This successor has not replaced public draft
PR #442 or its exact-head green CI; any publication or integration needs its
own source review. It performs no deployment, owner database connection,
migration, grant change, or RLS activation.

The public draft PR's general CI uses `ubuntu-latest`, `actions/setup-node@v5`,
and floating Node 22. Its green result cannot establish the separate disabled
Order job's `ubuntu-24.04`, pinned setup-node v7, exact Node 22.23.2 placement
or bytes. A further private successor therefore adds
`.github/workflows/order-zero-direct-toolchain-attestation.yml`: when a future
source revision containing it reaches a PR or main, that path-filtered job
uses the same runner label and action pins as the disabled Order job. It reads
the checked-in four candidate values and invokes the same credential-free
preflight against the selected Node executable, derived npm CLI and npm
package. A successful hosted job would report the selected paths and verified
digests; a mismatch fails closed. It has no protected environment, secrets,
database URL or production mutation. It has **not** run on a hosted runner,
so the candidate JSON's false evidence flags remain false. It does not make
the disabled Order job executable or authorize installing protected variables.
