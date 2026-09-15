# Private Order handoff integration candidate

This candidate atomically replaces the historical generic production-migrations
operator with the fixed Order compatible-prefix handoff. The job is disabled
with private vendor-verified action and Linux Node/npm pins recorded in
`order-handoff-toolchain-pins.json`. Actual runner placement, Linux execution,
source release identity and operational acceptance remain open. It is not ready
to install or dispatch. No production execution or RLS acceptance follows from
this source, its private commit, or its tests.

The launcher prepares a secret-free worker held by a supervisor across workflow
steps. The later client hands off one attempt-bound token and dedicated owner
credential through a private bounded local socket. Execution calls only the
fixed 17-member compatible-prefix composition. The existing fresh source,
exact-main CI, shared migration admission, owner identity, lifetime watch,
selected artifact, journal and final scope checks remain required. There is no
generic migration/SQL/resolve command or automatic retry/recovery path.

Always-collection cancels an unused handoff and exports only whitelisted bounded
evidence. The manifest digest is published separately for both successful and
failed collection outcomes when a safe manifest exists. Final workflow success
requires execution, collection and upload success. See
[the delivery contract](order-handoff-delivery-contract.md) for independent
receipt/retrieval, private staging, retention and host-loss limits.

The historical operator is retained byte-for-byte as a .txt test fixture outside
Actions. Existing seal/order assertions explicitly read that historical fixture;
they do not prove current workflow wiring. New workflow contract tests check
current credential scoping, serialization, disabled/manual operation, outcome
requirements and the historical fixture digest. The process suite reads the
current workflow's inline programs directly and exercises the public transport,
unsupported fixture command, worker lifetime, handoff, failures and receiver.
Its npm, database and GitHub adapters are modeled; it is not native production
proof. Native execution request measurements remain a separate accepted packet.

Before any active integration or operation: resolve the credential-incident
umbrella using current sanitized evidence; separately authorize integration;
accept the proposed pins on the actual runner; accept real token budget/headroom and
actual delivery/retention; obtain the final source catalog and exact-main push
CI. Measured request counts are timing dependent and exclude discovery/load and
full preparation overhead. This private fixture commit is never a release pin.

Core Order still requires the authorized compatible prefix, ordered corrections
and staff boundary, matching app, authenticated role/provider checks and drain,
then separate ENABLE/direct-revoke and FORCE owner/runtime acceptance. OrderItem
and OrderShippingRateQuote remain separate releases.

## Signed Clerk receipt application integration — September 14

This dormant candidate now includes the four application files and actual-route
test from private Clerk commit `e05be3d150b3a1a09d72065561d5f42273980045`:

- `src/app/api/clerk/webhook/route.ts`
- `src/lib/clerkWebhookReceipt.mjs`
- `src/lib/accountDeletion.ts`
- `src/lib/requestBody.ts`
- `tests/clerk-webhook-receipt.test.mjs`

All five files match that tested commit byte-for-byte. The three existing
application files matched its parent before integration, so the patch applied
without conflicts or replacement of divergent work. The previous handoff
implementation is preserved, including the exact disabled workflow bytes,
toolchain pins, historical fixture and execution fences. No workflow, package,
lockfile, migration or database policy changed.

The route returns a keyed receipt only after a verified synthetic sentinel's
absent-user completion or processed duplicate. It binds exact raw-body and
canonical-payload hashes, message, timestamp, sentinel digest and handler
outcome to the selected signing secret. The deletion helper distinguishes an
absent user from a present soft-deleted user. Strict Clerk UTF-8 decoding keeps
signature/hash bytes intact, including a byte-order mark; ordinary text decoding
and ordinary webhook response shapes retain their existing behavior.

Six relevant test files pass **46 tests**, zero failures or skips, including
the 20 actual route/receipt/body/helper cases and current disabled-workflow
contracts. Full TypeScript checking, changed-file repository lint and whitespace
checks pass in this combined candidate. Matching dependencies were temporarily
borrowed from the accepted Order tree; the symlink was removed afterward and
no install or dependency change occurred. This does not replace final exact-main
CI or production application/database compatibility evidence.

The provider receipt reader and operator composition remain in the private
Clerk worktree. Their existing 290-test receipt acceptance was preserved rather
than repeated. Live operation must use the matching application source and
reviewed provider/key/attempt bindings. The existing legal-provenance inspection
still requires its reviewed owner-only manual-main execution boundary; connecting
its fresh evidence to the cutover guards and completing full compatibility and
independent incident acceptance remain unfinished. No production deployment,
dispatch, credential/provider operation, database, grant or RLS action followed
from this integration. Core Order ENABLE/FORCE remains unaccepted.
