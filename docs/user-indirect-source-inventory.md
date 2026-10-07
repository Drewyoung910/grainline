# User indirect source inventory

Recorded 2026-10-06 on the isolated account-deletion branch and reconciled on
2026-10-07 through the seller identity, public-blog, public
review/commission, block/email, follower-authority and staff admin-label
successors. Regenerate with
`npm run audit:user-indirect-access -- --json`. Each edge is one statically
visible relation path per query; shared objects report both definition and
query locations. These are dependencies, not verified security findings.

The owner/cart conversion removes **16 edges across 11 caller files**, taking
the scanner-visible frontier from 93 edges/48 files to **77 edges/37 files**.
The combined seller identity successor removes thirteen more edges across nine
callers, leaving **64 edges in 30 caller files**. The public-blog successor then
removes eighteen more relation edges across eight caller files and five raw User
SQL calls across five files, leaving **46 edges in 22 caller files** and five
raw calls in four files. The review/commission successor removes another
eighteen relation edges across nine public callers, both remaining public
commission raw User joins, and the typed buyer lifecycle relation. The exact
block/email successor removes five more relation edges across two callers and
two raw User calls across two files. The follower-authority successor removes
four more relation edges across three callers and the final raw User SQL call.
The staff admin-label successor removes ten display-only edges across six
Admin-PIN-protected pages, then closes the last nine mutation predicates through
the existing seller lifecycle snapshot and one bounded account-age projection.
The exact frontier is now **zero edges in zero caller files** and **zero raw
calls**. Direct delegates remain zero. Opaque caller/factory shapes are listed
separately. See
`user-indirect-access-pre-rls-audit.md`,
`user-seller-relation-reuse-pre-rls-audit.md` and
`user-seller-snapshot-continuation-pre-rls-audit.md`, plus
`user-public-blog-projection-pre-rls-audit.md` and
`user-public-review-commission-pre-rls-audit.md` and
`user-block-email-pre-rls-audit.md` and
`user-follower-authorities-pre-rls-audit.md`, for intended product
behavior and authority decisions. This file supersedes the earlier preliminary
22-file list.

## Remaining query caller roster

No statically visible direct delegate, relation edge or raw User SQL caller
remains.

The scanner reports 222 opaque caller shapes and 14 opaque typed factory-return
shapes. Their helper implementations and arguments have received a bounded
semantic review: 185 caller rows use reviewed visibility/lifecycle-snapshot or
scalar-ownership helpers; the other 37 are scalar filters, ordering, mutation
payload and deletion/retention queue construction. No reviewed shape hides a
User relation, direct delegate or raw User SQL access. Canonical signature
digests fail on change and require renewed review. See
`docs/user-opaque-query-review.md`; the scanner alone still does not prove User
independence.

## Raw User SQL calls

The scanner reports zero raw User SQL calls. Static SQL fragments are inspected;
ordinary bound interpolation values, comments and SQL string literals are
excluded from table-name matching. Arbitrary SQL factories and installed
definer bodies still require manual inventory.

## Next cohesive groups

1. Reconcile installed User functions/grants before any User table revocation
   or activation. The `ClerkWebhookEvent` and `AccountDeletionSideEffect`
   scope decision is closed in `docs/user-service-ledger-separation-decision.md`:
   preserve their predecessor state during User activation and complete their
   separately tracked ledger releases afterward.

The inherited source grant-inventory expectations are corrected locally in this
package. The complete 53-function User catalog and canonical provisioning
preserve 34 ordinary-runtime functions, nine isolated staff functions, and ten
runtime-private snapshot trigger functions. The catalog explicitly includes the
four blog and four review/commission trigger functions that the earlier global
list omitted.
This source/DCL proof does not replace the installed Production catalog inspection.
The exact-main read-only inspection is prepared in
`docs/user-installed-catalog-production-inspection.md`; it must still merge,
pass main CI, run successfully, and have its sanitized evidence read back.
If it confirms the expected eight-migration Production prefix, the remaining
eight reviewed authority migrations have a guarded, restart-safe source runner
prepared in `docs/user-authority-successor-production-release.md`. The runner
still requires publication, exact-main CI, successful inspection and evidence
readback, then a separate Production dispatch approval. Compatible-app
promotion and smoke remain before final User grant/policy design and separate
ENABLE/FORCE activation.
