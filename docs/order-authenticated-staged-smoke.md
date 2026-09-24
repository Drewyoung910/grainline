# Order staged-deployment authenticated smoke

The existing successor smoke is pinned to the currently serving canonical
application. It cannot prove a newly staged zero-direct application before
promotion. `scripts/order-authenticated-route-smoke-staged.mjs` adds that
candidate boundary without changing the canonical successor.

The staged operator loads a mode-0600 private JSON binding from the absolute
path in `ORDER_AUTH_ROUTE_SMOKE_STAGED_BINDING_FILE`. Its fields are the exact
application `commit`, successful main `ciRunId`, READY Production
`deploymentId`, canonical `origin` (`https://thegrainline.com`), immutable
`targetOrigin` (`https://<exact-deployment>.vercel.app`), current canonical
`predecessorDeploymentId`, and SHA-256 `bypassSha256`. If Vercel attaches its
project alias during `--prod --skip-domain` staging, the binding must also set
`stagedAttachedAlias` to exactly
`grainline-drew-youngs-projects.vercel.app`. No bypass value belongs
in that binding. A second absolute mode-0600 dotenv file named by
`ORDER_AUTH_ROUTE_SMOKE_BYPASS_FILE` contains only
`ORDER_STAGED_BYPASS_SECRET`. Neither private file belongs in Git or a CI
artifact.

Before reading the bypass or provider credentials, the operator verifies its
own clean main commit and CI, the candidate application commit and CI, the
candidate's exact project/team/source/READY Production metadata and immutable
URL, and each canonical alias resolving to the pinned predecessor except the
explicitly bound project alias, which must resolve to the candidate. The
candidate deployment metadata must contain no other alias at all; an
unexpected alias requires a new reviewed binding before any fixture runs.
Health, the deployment
marker, and authenticated API calls go to the immutable URL with the pinned
bypass header; POST `Origin` is that same URL because the app's origin guard
compares it with the request URL. Configured application redirects still point
to the canonical site and remain checked. The restart journal binds the
candidate URL and bypass digest in addition to application/operator identity.

This source preparation does not stage an application, create a bypass key,
run a fixture, promote aliases, or authorize production execution. The
compatible prefix, exact candidate deployment, incident/provider inputs,
dedicated bypass access decision, and separate authenticated-smoke admission
remain prerequisites. On a smoke failure, preserve the existing private
restart journal and complete exact cleanup before any retry.
