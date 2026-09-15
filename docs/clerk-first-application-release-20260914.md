# Clerk application release before Order database changes

This candidate adds signed sentinel receipts to the existing Clerk webhook on
the current-main application. It lets Clerk credential recovery precede the
database-dependent Order application release. PR #434 published the initial
candidate and its full CI passed. This follow-up matches the actual managed
provider example; it requires fresh source/CI review before merge or deployment.

## Exact source boundary

Base: `baf65991683d7cb4c64f14f3148e03b85a272553`, independently read from
GitHub main on September 14. Its push CI `34305215421` completed successfully.
That CI covers the base only, not this patch.

The last accepted deployed source is
`d7859d5d1aaab5fbfbd77e973bf196a063493a62` at deployment
`dpl_HHLuG4Snq6vqitPjxUdabLqXfFSF`. A normal renewal of the existing Vercel login permitted fresh metadata
verification at 2026-09-15T02:49:49.854Z; this deployment still owns all four
canonical aliases. Deployment identity must be refreshed before a cutover.

Between that deployed source and the main base, the application/package delta
contains nine files: seven map files and the package/lock files. The application
routes, database access libraries other than map support, Prisma schema and
migrations are unchanged. Main already contains dependency/map build changes;
this candidate preserves them and requires matching release build/CI acceptance.

The Clerk patch imports only the four application changes and focused route test
from private receipt commit `e05be3d150b3a1a09d72065561d5f42273980045`:

- The webhook emits a receipt after a verified absent-user proof event or its
  processed duplicate. It accepts the exact custom sentinel or the pinned static
  user.deleted provider example. Ordinary event responses and idempotency remain.
- The receipt helper binds message, exact bytes, canonical payload, sentinel,
  outcome and time using a domain-separated MAC under the signing secret.
- Strict bounded webhook decoding preserves signature bytes and rejects malformed
  UTF-8. Other bounded text readers retain their behavior.
- Account deletion adds `userAbsent: true` to its existing no-user early return.
  The main implementation is otherwise preserved; the private Order version of
  this file is not imported.

The route test uses Prisma's real static SQL value helpers because main's deletion
module initializes SQL fragments at load time. Its database and business-side-effect
dependencies remain mocked; the test performs no database connection.

There is no new migration, schema change, RPC call, dependency, environment key,
workflow or deployment trigger. The initial versions of the four application changes are present
in the dormant Order candidate `552ae2622beecb4ab4289d60ccafd41a98d78aba`.
Do not deploy that Order candidate as the Clerk-first replacement: it contains
pending database-dependent Order and staff changes.

## Review and release sequence

1. Publish only this reviewed Clerk application patch when source publication is
   authorized. Keep the private operator/checkpoint material out of public source.
2. Obtain full CI and a final main commit containing this patch. Refresh main/CI,
   canonical aliases, exact predecessor and relevant environment metadata.
3. Establish the actual supported Clerk/Svix application identity and authentication.
   A Clerk Backend key is not assumed to be a Svix bearer. The installed Clerk SDK
   exposes POST `/webhooks/svix_url` for a new portal authentication session; no
   session was minted and no token was extracted or forwarded by this preparation.
4. Use the existing reviewed cutover sequence with exact operation grants, fresh
   legal provenance and runtime/provider witnesses. Preserve project configuration,
   validate replacement use, delivery/retry, side effects and predecessor drain,
   then retire only the reviewed old endpoint/consumer copies. Keep the secret
   journal until independent family acceptance.
5. Close the other credential-incident families using their separate acceptance
   evidence. Continue the existing Order compatible database/application release,
   authenticated behavior/drain, ENABLE/direct-access removal, and separate FORCE.

The source delta removes the newly introduced Order database prerequisite from
this Clerk candidate. It does not itself establish current catalog health, full
production application compatibility, legal counts, credential incident closure,
or Core Order RLS acceptance. Missing live inputs must stay explicit; do not
substitute a synthetic adapter, successful base CI or health-only GET for them.

## Local validation

The focused suite covers the actual transpiled route with real Svix signing and
verification, strict body bounds, absent/deleted-user behavior, deletion regressions
and map support. Sixty tests pass without failures or skips. TypeScript and changed
application/test lint pass. The complete Next.js 16.3.3 Turbopack production build
passes, including TypeScript, page collection and prerendering, against a newly
created disposable schema. The Unix-socket-only build database was stopped after
completion. Exact results and the initial failed build/setup attempts are retained
in the private checkpoint packet; a local build cannot replace final-main CI.

The isolated build uses an independent copy-on-write dependency tree from the
matching lockfile and generates a client from this candidate's own Prisma schema.
Only synthetic build configuration is supplied; no local production environment
file or real provider credential is loaded. Existing Order dependencies and
checkpoints are preserved.


## Managed provider example follow-up

Clerk's actual production webhook app is in Svix region EU. Its supported portal
flow sends an event-type example to one endpoint. The existing custom-message
publisher requires separate authority; it is not assumed usable with an app
portal token. The provider's static user.deleted schema example contains extra
metadata and a fixed example ID, so the initial custom-sentinel-only receipt
would not attest that delivery.

The receipt now also recognizes only this exact observed schema example:
canonical payload SHA-256 `96aee0fb9d16f052ecb336457856fb14ab6dd84dac6177cb27346ca5c9997cfe`,
user-ID SHA-256 `9a5d23d9b2e4917a244acd51831e2ceb4d1051dfa6d7cc5503064d101e1c2382`.
Any altered ID, payload field, metadata or timestamp is rejected for receipt
purposes. Ordinary signed webhook handling is unchanged. Real current Svix
verification and absent-user completion remain mandatory; a schema-example ID
is not assumed absent and the operator must freshly verify it before any send.
A receipt never independently authorizes a production delivery or deployment.

Operator preparation uses endpoint send-example with index zero, rechecks the
actual schema before each initial send, records an idempotency key and saves the
returned message ID before credential postchecks. An initial lost response
cannot be recovered merely by selecting a similar message: example responses
lack the operation event ID used by custom publication. Automatic resend and
payload/time-only recovery remain forbidden. Real provider/runtime acceptance
and independent incident closure remain separate release gates.
