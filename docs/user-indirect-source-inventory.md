# User indirect source inventory

Recorded 2026-10-06 on the isolated account-deletion branch and reconciled on
2026-10-07 through the seller identity, public-blog, public
review/commission, block/email, and follower-authority successors. Regenerate with
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
The exact frontier is now **19 edges in eight caller files** and **zero raw
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

| File | Statically visible User relation edges |
| --- | ---: |
| `src/app/admin/audit/page.tsx` | 1 |
| `src/app/admin/blog/page.tsx` | 3 |
| `src/app/admin/broadcasts/page.tsx` | 1 |
| `src/app/admin/reports/page.tsx` | 2 |
| `src/app/admin/reviews/page.tsx` | 1 |
| `src/app/admin/support/page.tsx` | 2 |
| `src/app/admin/verification/page.tsx` | 6 |
| `src/app/api/admin/listings/[id]/review/route.ts` | 3 |

The scanner reports 222 opaque caller shapes and 14 opaque
typed factory-return shapes. These include dynamic conditions, scalar updates,
input spreads and shared filters. Review the actual helper implementation and
arguments; absence from this roster does not prove User independence.

## Raw User SQL calls

The scanner reports zero raw User SQL calls. Static SQL fragments are inspected;
ordinary bound interpolation values, comments and SQL string literals are
excluded from table-name matching. Arbitrary SQL factories and installed
definer bodies still require manual inventory.

## Next cohesive groups

1. Staff and admin investigation projections: maintain the PIN/isolation
   boundary and return only bounded target facts.
2. Reconcile installed functions/grants, ClerkWebhookEvent and
   AccountDeletionSideEffect ledgers before
   any User table revocation or activation.

The inherited source grant-inventory expectations are corrected locally in this
package. The explicit 44-function callable User catalog and canonical
provisioning preserve the 34 ordinary-runtime versus ten private split. The four
blog and four review/commission snapshot trigger functions are additionally
registered as runtime-private.
This source/DCL proof does not replace the installed Production catalog inspection.
