# User indirect-access audit and compatible preparation

## Intended behavior and current authority

User RLS must preserve owner account settings, public display identities,
relationship safety filters, PIN-gated staff investigations and provider/jobs.
Zero direct User delegates alone does not prove this: Prisma relations and raw
SQL can still require table access. This audit begins at local `ae5f0cb5`, stacked
on accepted source `66746f47`. It authorizes isolated source preparation only.

Owner onboarding, profile, verification and Stripe Connect must use the signed
Clerk owner's identity. The installed `grainline_user_clerk_account` and identity
ensure operations already return that owner's email, createdAt and imageUrl.
Reusing those fields avoids extra foreign-table relations. Onboarding must deny
missing, banned and deleted accounts before querying their unique SellerProfile;
it must not silently create a missing seller as a side effect of this conversion.
Every server action must resolve its owner anew; rendered-page identity is not
mutation authority.

Cart, shipping quote, checkout creation and checkout resume must reject inactive
sellers without requiring User table visibility. SellerProfile's existing
`ownerAccountActive` snapshot is maintained by database triggers on User ban,
deletion and seller creation/rebinding. Explicit writes to that field are rebound
from the locked User row. It is therefore suitable for these preliminary reads.
Final payment, reservation and stock operations keep their existing lock-time
User checks; a cached projection never replaces their transaction authority.
Resume ignores only reservation-held stock and preserves all other checks.

## Operation/principal disposition

| Family | Principal and intended access | Decision |
| --- | --- | --- |
| Owner settings and Connect | Signed-in active owner; own account facts | Reuse current identity authority; no new SQL |
| Cart/quote/checkout preflight | Buyer; seller availability only | Reuse trigger-bound SellerProfile ownerAccountActive; keep final locks |
| Public blog/review/commission | Anonymous or active actor; public labels and visibility | BLOCKS_RLS_DESIGN until User relation/raw dependencies are converted |
| Block safety and mutations | Active actor; reciprocal relationship, sorted User locks | BLOCKS_RLS_DESIGN; preserve notification lock protocol |
| Staff investigations | PIN-verified staff; bounded target facts | BLOCKS_RLS_DESIGN; private email/name must stay isolated |
| Follower delivery and provider mirror | Valid source event/job; eligible recipient or seller state | BLOCKS_RLS_DESIGN; preserve source binding, pagination and suppression |
| Email fallback ownership | Account/export/deletion; detect another live owner's claim | BLOCKS_RLS_DESIGN; do not expose other owners' email records |
| Installed functions and service ledgers | Definer owner or isolated service as appropriate | Separate catalog and ledger audit required |

## Inventory method and limitations

`scripts/audit-user-indirect-access.mjs` parses TypeScript syntax and the local
Prisma model graph. It follows nested relations through intermediate models,
relation filters, counts, mutation containers, local const aliases and imported
const projections. It reports the query call site separately from shared-object
definitions. Comments, strings and disabled relations do not become Prisma calls.
Static SQL fragments passed to raw operations are inspected separately.

The first AST scan found **93 statically visible User relation edges in 48 caller
files**, rather than the preliminary regex estimate of 22 files. That is an
inventory of dependencies, not 93 security findings. Owner reuse removes seven
edges across five files. Cart/quote/checkout conversion removes nine more edges
across six files. The remaining inline/shared frontier is **77 edges in 37 caller
files**. The raw SQL frontier is ten calls across nine files. Two additional
typed filter definitions still require User: `publicBlogPostWhere` checks its
author, and `openCommissionBaseWhere` checks its buyer. Their call fanout is not
added to the inline/shared count.

Typed query-shape factory return bodies are inventoried separately. Their argument
composition, computed properties and dynamic SQL generation are not fully
resolved. There are 222 opaque caller shapes and 14 opaque factory-return shapes
in the current source. Many caller shapes are ordinary
scalar updates or public-filter helpers. They are manual review candidates, not
confirmed User dependencies. The scanner cannot authorize grants or activation,
and zero discovered edges would still require resolving its opaque frontier.
Migrations and installed function bodies need a separate source/catalog audit.

## Failure and concurrency review

Owner values come from an existing checked identity result. Account creation time
is immutable; profile image/email freshness is bounded by the same request.
This does not solve lifecycle changes that occur after request authentication;
existing final mutation checks remain necessary. No new provider operation,
retry identifier, workflow dispatch or credential is introduced.

For seller availability, snapshot changes co-commit with User lifecycle changes.
Missing/null/nonboolean projected activity must deny access. Where legacy callers
still supply a User lifecycle object, its banned/deleted facts continue to deny
even if a contradictory snapshot says active. Full seller reads naturally return
the snapshot, and selected reads must request it explicitly.

## Verification and release boundary

Focused inventory tests cover shared/imported projections, intermediary relation
filters, aliases, disabled includes, comment/string false positives and opaque
factories. Owner behavior tests cover Clerk-id resolution, missing/banned/deleted
denial and Stripe email/persistence/idempotency behavior with mocked providers.
Cart tests must cover active/inactive/missing snapshots and retained legacy
lifecycle denial, including stock-zero resume.

The checkout reservation witness adapter also consumes the seller projection.
It accepts only an explicitly active snapshot or the legacy explicit false/null
lifecycle pair, and preserves the exact installed JSON bytes (`userBanned=false`,
`userDeleted=false`) for admitted sources. Both cart and Buy Now witness equality
are covered by behavioral tests. The fixed SQL independently rebuilds these facts
from the locked User row; no migration or source-consistency bypass is introduced.

The first focused Order guard run found historical custom-order assertions that
still expected the pre-`ae5f0cb5` nested projection. Those assertions now pin the
current fixed relationship wrapper and the same availability/payout guard. The
first type check exposed a stale shared generated Prisma client; a temporary
client was generated from this checkout's schema without modifying shared
dependencies. The schema-correct type check found an obsolete cart response
type assertion, which was removed in favor of the inferred query result.

## Canonical grant integration correction

The inherited global inventory gap is corrected in this successor. An explicit
`scripts/user-authority-catalog.mjs` lists 37 exact function identities from eleven
User preparation migrations: 27 ordinary-runtime operations and ten private
operations (eight isolated staff operations and two trigger functions).
Historical-prefix test expectations include a family only when its named
migration is present; they do not copy the discovered function list.

Canonical runtime provisioning now converges the seventeen previously accepted
Clerk, owner, unsubscribe, delivery and public aggregate signatures. The local
ten runtime ban/deletion/relationship signatures retain their existing blocks.
Eight isolated staff functions receive an explicit PUBLIC/runtime revocation
block, and the global auditor classifies them private. The separate staff grants
are preserved; this operator grants no new staff session or table authority.

One extra public-revoke count exposed a parser defect: a CREATE FUNCTION statement
whose comment said "does not revoke" and whose SQL read `FROM public."User"` was
misclassified as a PUBLIC revoke. The inventory now checks the actual leading
REVOKE or ALTER DEFAULT PRIVILEGES command after discarding leading comments.
Regression coverage preserves real default-privilege revokes.

Disposable PGlite runs the actual extracted provisioning CTEs twice against
all 37 exact callable signatures, proving the final 27/10 runtime partition
and retention of all eight staff-role grants. Stub bodies make this a DCL
convergence proof, not a repeat of function-behavior or Production authentication
proof. The full focused db-grant-inventory suite passes 28 tests with one
intentional skip. Installed Production catalog comparison remains open.

GO for these compatible source conversions. NO-GO for User policies, table
revocation, ENABLE or FORCE until every remaining dependency, opaque shape,
service ledger and installed-function catalog is resolved. Compatible publication,
SQL installation and deployment remain separate release actions.
