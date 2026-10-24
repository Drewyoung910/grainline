# SupportRequest pre-RLS domain audit

Date: 2026-10-23

Decision: **GO for compatible preparation under Option B.** Candidate source
now converts every direct caller, passes the full-chain PostgreSQL behavior
suite, and closes both pre-activation findings below. This does not authorize a
Production migration, application deployment, grant change or RLS activation.
Those steps remain blocked on exact-head review, read-only Production
inspection and a separately approved release sequence.

Source baseline: main `6be29e5bdf4e401598e902aa6520c67cff741205`.
Production catalog state has not been inferred from source and must be inspected
read-only before a release.

## Product behavior

`SupportRequest` stores private contact details, free-text support or privacy
requests, optional order/listing references, notification-delivery evidence,
SLA state, and staff closure evidence. It is never a public-read table.

The supported workflows are:

1. A signed-out or signed-in visitor submits `/support` or
   `/legal/data-request`. The row is durable before email is attempted. A
   signed-in local account is linked by server-resolved identity; anonymous
   intake receives no read authority.
2. The exact intake attempt records either confirmed email delivery or a
   sanitized failure. A failed evidence update retains the pending marker for
   staff review rather than losing the durable request.
3. PIN-verified active staff see the oldest active requests first, plus the 20
   most recently closed requests, and can make terminal status transitions.
   Closing a data request requires bounded closure evidence and atomically
   records the staff actor and an audit row.
4. An authenticated account export includes requests linked by stable user ID
   or current/historical account email. This intentionally means an anonymous
   request submitted with somebody else's email can appear in that account's
   export; the privacy runbook must retain that tradeoff.
5. Account deletion scrubs requester data and staff-authored closure evidence,
   including more than one batch, while leaving unrelated rows and unrelated
   text unchanged. Provider-deleted accounts with blockers create or refresh
   one active legal request.
6. Ops health returns only an overdue count. The daily retention job deletes
   only closed requests older than two years, in bounded batches.

## Current authority inventory

Nine source consumers access the table:

| Consumer | Current operation | Intended principal |
| --- | --- | --- |
| `src/app/api/support/route.ts` | create; record email result | anonymous or signed-in requester |
| `src/app/api/legal/data-request/route.ts` | create; record email result | anonymous or signed-in requester |
| `src/app/admin/layout.tsx` | active count | PIN-verified staff |
| `src/app/admin/support/page.tsx` | active/recent queue | PIN-verified staff |
| `src/app/admin/support/actions.ts` | status transition plus audit | PIN-verified staff |
| `src/app/api/account/export/route.ts` | owner export | freshly reverified account owner |
| `src/app/api/cron/ops-health/route.ts` | overdue aggregate | authenticated cron service |
| `src/lib/accountDeletion.ts` | requester/closure redaction and deferred-request upsert | exact account-deletion actor/service |
| `src/lib/supportRequestRetention.ts` | closed-row retention delete | authenticated cron service |

No relation include or nested write outside this inventory reaches
`SupportRequest` on the reviewed baseline.

## Operation design

The approved target is policyless RLS with zero direct runtime/PUBLIC table or
column authority. Compatible preparation will install these purpose-bound
operations while predecessor grants remain:

- submit a validated request, deriving an optional account link only from the
  transaction-local actor, and return a one-use email-result capability;
- record sent/failure evidence only with that exact one-use capability;
- return the current actor's export projection, deriving email history in the
  database;
- return a bounded staff queue/count after checking active staff authority;
- perform a locked staff transition and audit insert atomically;
- redact one bounded account-deletion batch using the existing reviewed SQL
  redaction core and exact transaction-local actor;
- create or refresh the exact provider-deletion legal request;
- return only the overdue aggregate; and
- prune only closed rows beyond the fixed two-year retention window.

The email-result capability prevents possession of another public request ID
from authorizing mutation. The capability is never returned in the HTTP
response and is cleared on first successful result recording.

## Concurrency and recovery

- Staff transitions lock the request row, reject terminal reopen, and co-commit
  the status, closure evidence, actor and audit log.
- Email result recording is compare-and-set on request ID plus a random one-use
  capability. An ambiguous database failure leaves the existing pending marker
  visible to staff; retrying cannot overwrite a recorded result.
- Account deletion starts each bounded batch from the beginning of its
  still-matching predicate. Mutated rows leave that predicate, avoiding the
  historical cursor-plus-skip omission.
- Deferred provider deletion locks/updates one newest active matching legal
  request or creates one; concurrent calls cannot create multiple active rows.
- Retention derives its cutoff in the database and never accepts a caller-chosen
  date.

## Findings and gates

### CLOSED IN CANDIDATE SOURCE

1. **C-747: support status Server Action omitted the signed Admin PIN check.**
   `setSupportRequestStatus` now calls `requireAdminPageAccess()` before it can
   invoke the transition operation. The database operation separately validates
   the active staff actor; both boundaries have behavior coverage.
2. **Malformed JSON object handling:** the shared normalizer now rejects `null`,
   arrays and primitives as ordinary validation failures before reading fields.
   Both public intake routes use that boundary.
3. **C-1150: historical email reuse crossed the requester boundary after the
   authority conversion.** The first fixed owner-export and deletion operations
   matched every `UserEmailAddress` row, including an address now held by a
   different active account and its Gmail-canonical equivalents. The correction
   keeps stable `SupportRequest.userId` ownership authoritative, permits email
   fallback only for unlinked requests, and derives that fallback through the
   existing conflict-filtered user-email authority. The full-chain PostgreSQL
   scenario covers export and deletion for exact reuse, Gmail canonical reuse,
   linked and anonymous conflicting requests, active versus deleted conflicting
   owners, and a nonconflicting historical address.

### DEFERRED_PRODUCT_WORK

1. Stored intake text still uses a lossy strip-tags sanitizer. Every current
   sink escapes the result, so this is record fidelity rather than an RLS
   authority prerequisite. Resolve with the broader stored-text sanitizer work;
   any replacement must keep output escaping mandatory.
2. Ordinary support requests currently inherit the 45-day legal-request SLA and
   show it to requesters. Changing that promise requires a product/support SLA
   decision. The fixed operation preserves the stored deadline contract until
   that decision lands.
3. Email-history fallback may associate an anonymous request with an account
   when the submitted address remains in that account's history and no other
   active user currently holds the exact address or Gmail-canonical equivalent.
   This is the bounded tradeoff for unauthenticated privacy intake. A request
   linked to another account by stable `userId` never enters email fallback.

There are no `BLOCKS_RLS_DESIGN` findings after selecting Option B.

## Acceptance and rollback

The PostgreSQL 16 proof rebuilt and applied all 427 migrations, then passed the
policyless ENABLE scenarios for: anonymous/signed-in submission, forged actor denial,
one-use email-result capability, non-owner export denial, staff/PIN boundaries,
terminal staff transitions, atomic audit metadata, multi-batch
deletion redaction, exact and Gmail-canonical email-reuse isolation,
unrelated-row preservation, deferred-request convergence,
overdue aggregation, and two-year retention.

The focused application suite passes 78 checks, TypeScript passes, and a source
guard confirms that no `src` caller contains a direct SupportRequest Prisma
delegate or raw base-table statement. Exact-head CI remains the place for the
single full repository suite and build; they are not repeated after every
documentation-only adjustment.

The compatible preparation is live from protected run `39933538640`, and the
compatible application is live at exact commit
`0ec7c793b3e84497de88371c597ca3547e12d8ab` as deployment
`dpl_G1yHZgGU3KFLNzqA2GqbVWBCSRfg`. Policyless ENABLE migration
`20261023020000_enable_support_request_rls` was applied by protected run
`39961147411`. C-1150 correction
`20261023050000_correct_support_request_email_reuse_privacy` was applied by
protected run `40057039732`, preserving stable-user-first ownership and
conflict-filtered historical-email fallback. FORCE migration
`20261023060000_force_support_request_rls` was applied by protected run
`40070613144`. Production now has policyless ENABLE plus FORCE, zero runtime,
staff, or PUBLIC table/column authority, and only the reviewed owner-owned
fixed operations. The reviewed rollback restores NO FORCE while retaining
ENABLE and the narrow authority boundary. No security release drops columns.
