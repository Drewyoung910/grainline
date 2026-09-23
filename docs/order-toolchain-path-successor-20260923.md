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
`ORDER_ZERO_DIRECT_NPM_VERSION`. Candidate values appear in the already
reviewed `order-handoff-toolchain-pins.json`; they are historical vendor-byte
evidence, not actual hosted-runner placement or Linux execution proof. The
workflow job remains `if: false`, and no variable was installed. Five focused
preflight/runner tests passed. This successor has not replaced public draft
PR #442 or its exact-head green CI; any publication or integration needs its
own source review. It performs no deployment, owner database connection,
migration, grant change, or RLS activation.
