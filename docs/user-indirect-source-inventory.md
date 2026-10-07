# User indirect source inventory

Recorded 2026-10-06 on the isolated account-deletion branch and reconciled on
2026-10-07 through the combined seller identity and public-blog successors. Regenerate with
`npm run audit:user-indirect-access -- --json`. Each edge is one statically
visible relation path per query; shared objects report both definition and
query locations. These are dependencies, not verified security findings.

The owner/cart conversion removes **16 edges across 11 caller files**, taking
the scanner-visible frontier from 93 edges/48 files to **77 edges/37 files**.
The combined seller identity successor removes thirteen more edges across nine
callers, leaving **64 edges in 30 caller files**. The public-blog successor then
removes eighteen more relation edges across eight caller files and five raw User
SQL calls across five files, leaving **46 edges in 22 caller files** and **five
raw calls in four files**. Direct delegates remain zero. One typed User filter
definition and opaque
caller/factory shapes are listed separately. See
`user-indirect-access-pre-rls-audit.md`,
`user-seller-relation-reuse-pre-rls-audit.md` and
`user-seller-snapshot-continuation-pre-rls-audit.md`, plus
`user-public-blog-projection-pre-rls-audit.md`, for intended product
behavior and authority decisions. This file supersedes the earlier preliminary
22-file list.

## Remaining query caller roster

| File | Statically visible User relation edges |
| --- | ---: |
| `src/app/account/blocked/page.tsx` | 1 |
| `src/app/admin/audit/page.tsx` | 1 |
| `src/app/admin/blog/page.tsx` | 3 |
| `src/app/admin/broadcasts/page.tsx` | 1 |
| `src/app/admin/reports/page.tsx` | 2 |
| `src/app/admin/reviews/page.tsx` | 1 |
| `src/app/admin/support/page.tsx` | 2 |
| `src/app/admin/verification/page.tsx` | 6 |
| `src/app/api/admin/listings/[id]/review/route.ts` | 3 |
| `src/app/api/commission/[id]/interest/route.ts` | 1 |
| `src/app/api/commission/[id]/route.ts` | 1 |
| `src/app/api/commission/route.ts` | 1 |
| `src/app/api/seller/broadcast/route.ts` | 2 |
| `src/app/commission/[param]/page.tsx` | 3 |
| `src/app/commission/page.tsx` | 1 |
| `src/app/listing/[id]/page.tsx` | 3 |
| `src/app/seller/[id]/customer-photos/page.tsx` | 2 |
| `src/app/seller/[id]/page.tsx` | 2 |
| `src/components/ReviewsSection.tsx` | 4 |
| `src/lib/blocks.ts` | 4 |
| `src/lib/followerBlogNotifications.ts` | 1 |
| `src/lib/followerListingNotifications.ts` | 1 |

## Typed filter definitions

- `src/lib/commissionState.ts`: `openCommissionBaseWhere` filters the buyer's
  banned and deleted state. `openCommissionMutationWhere` composes it. Preserve
  public expiry/visibility and mutation eligibility when replacing this relation.

Definition edges are not multiplied by factory invocation count or added to the
46 query-site edges. The scanner reports 222 opaque caller shapes and 14 opaque
typed factory-return shapes. These include dynamic conditions, scalar updates,
input spreads and shared filters. Review the actual helper implementation and
arguments; absence from this roster does not prove User independence.

## Raw User SQL calls

| Caller | Calls | Intended boundary still to prepare |
| --- | ---: | --- |
| `src/app/commission/page.tsx` | 2 | Public commission/buyer identity and geo-search |
| `src/lib/blockMutationAccess.ts` | 1 | Sorted actor/target lifecycle locks; preserve Notification serialization |
| `src/lib/quality-score.ts` | 1 | Background score count over eligible followers |
| `src/lib/userEmailAddresses.ts` | 1 | Privacy-bounded email ownership collision check |

Static SQL fragments are inspected; ordinary bound interpolation values,
comments and SQL string literals are excluded from table-name matching.
Arbitrary SQL factories and installed definer bodies require manual inventory.

## Next cohesive groups

1. Public review/commission labels and lifecycle filters: retain database-side
   pagination/search/ordering; use domain-safe projections rather than broad
   User access or per-row identity lookups. Public blog is prepared locally.
2. Actor-bound block filters and mutations plus owner email fallback: preserve
   sorted lifecycle locks, reciprocal safety, deletion and alias suppression.
3. Staff investigation projections and provider/follower jobs: maintain the
   PIN/isolation boundary and source-derived targeting.
4. Reconcile installed functions/grants, ClerkWebhookEvent and
   AccountDeletionSideEffect ledgers before
   any User table revocation or activation.

The inherited source grant-inventory expectations are corrected locally in this
package. The explicit 37-function callable User catalog and canonical
provisioning preserve the 27 ordinary-runtime versus ten private split. The four
blog snapshot trigger functions are additionally registered as runtime-private.
This source/DCL proof does not replace the installed Production catalog inspection.
