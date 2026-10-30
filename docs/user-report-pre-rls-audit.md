# UserReport Pre-RLS Domain Audit

Date: 2026-10-28

Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

Reverified against exact main `fb38730ff86f85a9b1dbd5bba39cbddd54af9108`
on 2026-10-29. No UserReport runtime consumer changed between those sources.

Status: Option B and the split-note privacy contract are accepted. Compatible
preparation is implemented on the isolated UserReport branch and passes the
full PostgreSQL 17 migration chain, including a predecessor-failing review
attribution proof. It remains unapplied in Production. No `UserReport` RLS or
direct-table grant activation is authorized by this audit.

## Intended Product Behavior

`UserReport` is a private trust-and-safety record. An active user may report a
different non-deleted user, including an already banned user, either generally
or for one reportable resource the reporter is allowed to access. Staff with
the session-bound admin PIN may view
unresolved reports, inspect the reported context, and resolve one report with a
required reason. Report creation and resolution must remain auditable without
revealing private targets or reporter narrative to the reported user.

The current account export intentionally has two different projections:

- a reporter receives their submitted report id, reported user id, reason,
  details, target, resolution state, resolution note, and timestamps;
- a reported user receives reason, target, resolution state, resolution note,
  and timestamps, but not reporter id or reporter details.

Account deletion retains the trust-and-safety row. It removes free-text details
when either party is deleted, replaces a resolved report's free-text resolution
note with a generic note, and auto-resolves an unresolved report against a
deleted reported account. A reporter's deletion does not erase the retained
report or the other user's moderation history.

The Privacy Policy discloses that reports, resolution notes, blocks, and related
moderation records may be retained for safety, fraud prevention, legal, and
marketplace-integrity purposes while personal data is removed or anonymized
where legally permitted. No fixed report-retention purge currently exists.

## Schema And Current Authority

`UserReport` contains:

- required reporter and reported-user foreign keys with `RESTRICT` deletion;
- categorical `reason` and optional free-text `details`;
- an optional polymorphic `targetType` plus `targetId` pair;
- resolution flag, timestamp, optional staff actor, and resolution note;
- creation time and indexes for each participant, resolution state, the staff
  queue, and 30-day reporter aggregation.

RLS is off and the ordinary runtime role retains predecessor table authority.
The database has text bounds and foreign keys, but it does not itself enforce:

- reporter and reported user are different;
- `reason` belongs to the application's five-value vocabulary;
- target type and id are both null or both non-null;
- target type belongs to the application's supported vocabulary;
- the target belongs to the reported user and is visible to the reporter;
- unresolved/resolved metadata is internally consistent.

Those rules are currently distributed between Zod, route code, fixed
cross-domain target validators, and mutation code.

## Complete Current Consumer Inventory

Before compatible preparation, five application modules performed nine direct
Prisma operations:

1. `/api/users/[id]/report` creates one row;
2. `/admin/reports` reads the unresolved queue;
3. `/admin/reports` aggregates top reporters for the preceding 30 days;
4. `/api/admin/reports/[id]/resolve` resolves one row;
5. account export reads submitted rows;
6. account export reads received rows through the narrower projection;
7. account deletion removes details for either participant;
8. account deletion replaces resolved free-text notes for either participant;
9. account deletion auto-resolves unresolved rows against the deleted reported
   account.

The compatible preparation converts all nine operations to eight fixed
database authorities. It also replaces the newest-50 staff queue with a true
open count and oldest-first stable cursor, moves all staff reads/resolution to
the isolated staff credential, narrows the accepted target vocabulary to the
five target types staff can investigate, and separates participant-visible
resolution rationale from the internal staff note. RLS and predecessor table
grants remain unchanged until activation.

No ordinary application path needs direct UPDATE outside staff resolution and
account deletion. No ordinary application path deletes a report.

### Report creation and target authority

The route authenticates and materializes the current active account, applies a
fail-closed five-per-hour rate limit, rejects self-reporting, bounds and parses
the request, validates the target, sanitizes details, then inserts the report.

The route accepts a generic user report with no target or these target types:

| Target | Current database/application validation |
| --- | --- |
| `USER` | target id equals the reported user id |
| `LISTING` | actor-bound seller/listing authority |
| `REVIEW` | actor-bound seller/listing/review authority |
| `ORDER` | buyer/seller participant authority |
| `MESSAGE` | message participant authority |
| `MESSAGE_THREAD` | conversation participant authority |
| `BLOG_POST` | public post authored by reported user |
| `BLOG_COMMENT` | approved comment by reported user on public post |
| `COMMISSION_REQUEST` | open public request owned by reported user |
| `SELLER_PROFILE` | public seller profile owned by reported user |

The rendered product currently submits only `SELLER_PROFILE`, `LISTING`,
`MESSAGE_THREAD`, `REVIEW`, and `BLOG_COMMENT`. The broader API vocabulary is
still live and can be invoked directly.

Listing reports create a non-blocking seller notification bound to the exact
report row through `grainline_notification_create_core`. Failure to notify does
not undo the report and leaves bounded Sentry evidence.

### Staff queue and resolution

The admin page verifies the active EMPLOYEE/ADMIN account and the
session-bound PIN before querying. It reads unresolved reports and safe staff
labels, resolves several target types to context links, and shows a 30-day top
reporter aggregate. The admin API is also protected by the middleware PIN
boundary, repeats the active staff-role check, rate-limits the actor, requires a
non-empty bounded reason, and resolves the row together with an AdminAuditLog
witness in one transaction.

The report row stores the sanitized resolution note. The AdminAuditLog witness
stores only that a note was stored and its length; it does not duplicate the
note. The same report note is included in both the submitted-report and
received-report account exports. The staff form does not disclose that audience
or warn staff not to include the reporter's identity, private narrative, or
other third-party data. This is more privacy-minimizing than the current
`CLAUDE.md` statement that says the same note is copied into audit metadata,
but both the audit-witness contract and the participant-visible-note contract
must be reconciled before the fixed resolution authority is specified.

### Cross-domain service consumers

The full migration history's latest installed-source definitions contain three
database functions that read `UserReport`:

- `grainline_notification_create_core(...)` validates an exact listing-report
  notification source;
- `grainline_conversation_staff_report_visible(text)` permits the existing
  staff reported-thread RLS path only for an unresolved `MESSAGE_THREAD`
  report;
- `grainline_user_conversation_participants(text,text)` returns thread
  participants to an active staff actor only when the same unresolved report
  exists.

The activation package must derive the exact current installed `pg_proc`
catalog, including overload identity, owner, security mode, search path, source
identity and ACL. Historical migration grep is not sufficient.

## Authority Matrix

| Operation | Principal | Intended scope | Final authority shape |
| --- | --- | --- | --- |
| Submit generic report | active reporter | reporter plus one distinct non-deleted target user | actor-bound fixed transition |
| Submit resource report | active reporter | one accessible resource owned/authored by the reported user | actor-bound fixed transition with target validation |
| Submitted export | active reporter | reporter-owned rows, full reporter projection | actor-bound fixed export |
| Received export | active reported user | reported rows, no reporter identity/details | actor-bound narrow export |
| Staff queue | PIN-verified active staff | bounded unresolved rows and target context | staff-bound fixed page |
| Reporter aggregation | PIN-verified active staff | bounded time-window aggregate | staff-bound fixed aggregate |
| Resolve | PIN-verified active staff | one unresolved report plus audit witness | atomic staff-bound transition |
| Reported-thread access | PIN-verified active staff | exact unresolved thread report, boolean/participants only | retain narrow fixed service authority |
| Listing-report notification | exact notification source | one report/listing/seller tuple | retain narrow fixed service authority |
| Account deletion | claimed deletion worker acting as target | exact redaction/auto-resolution semantics | claim-bound fixed transition |

The database cannot authenticate possession of the admin PIN. Staff fixed
operations must validate the active database actor and role; the application
must retain the session-bound PIN check immediately before invoking them.

## Correctness, Privacy And Scale Findings

### USERREPORT-RLS-1: message attribution is not bound to the sender

Classification: `FIX_BEFORE_ACTIVATION`.

`grainline_message_report_target_valid` accepts a `MESSAGE` when the actor and
reported user are both endpoints. It does not require the reported user to be
the message sender. A participant can therefore submit the id of their own
message while naming the counterparty as the reported user. The current UI
submits thread reports, but the API explicitly accepts `MESSAGE`, so a direct
request can create misleading moderation evidence.

The message branch must require `message.senderId = reportedUserId` and the
reporter to be the other participant. A failing-first full-chain PostgreSQL
test must demonstrate the current false attribution and the corrected denial.

### USERREPORT-RLS-2: review attribution can be shifted to the seller

Classification: `FIX_BEFORE_ACTIVATION`.

`grainline_seller_actor_report_resource_target` accepts a review when either
the reviewer or the listing seller equals the reported user. The rendered
"Report this review" control names the reviewer. A direct caller can instead
name the seller for a buyer-authored review and create a report whose target
does not belong to the reported user under the product contract.

The `REVIEW` branch must bind the reported user to the review author. A
separate future product operation is required if seller-authored review replies
are to become reportable.

### USERREPORT-RLS-3: the oldest unresolved reports can disappear from staff

Classification: `FIX_BEFORE_ACTIVATION`.

The queue reads the newest 50 unresolved rows, has no cursor, and labels the
returned row count as the number open. With more than 50 unresolved reports,
the oldest and most overdue reports are invisible. New reports can keep them
invisible indefinitely. The existing `(resolved, createdAt, id)` index supports
a deterministic oldest-first page.

Before activation, the staff operation and UI must expose the true unresolved
count and an oldest-first cursor or otherwise prove every unresolved report is
reachable. This is the still-current root cause previously recorded as the
admin reports queue finding; a closed-ledger label is not evidence that current
source fixed it.

### USERREPORT-RLS-4: several accepted target types have no usable staff path

Classification: `FIX_OR_NARROW_BEFORE_ACTIVATION`.

The API accepts `ORDER`, `MESSAGE`, and `COMMISSION_REQUEST`, but the staff
queue renders no context link for them. `BLOG_POST` uses `targetId` directly as
a blog slug even though submission validates and stores the post id. These
types are not emitted by the current rendered controls, but authenticated
callers can still create them through the API.

Before the fixed submit authority is finalized, either:

- add bounded staff context resolution for every accepted target type; or
- remove unsupported types from the accepted vocabulary.

Do not preserve an API-only report type staff cannot investigate.

### USERREPORT-RLS-5: database invariants do not match the product contract

Classification: `FIX_BEFORE_ACTIVATION_AFTER_READ_ONLY_INVENTORY`.

The table has no CHECK constraints for self-reporting, reason vocabulary,
target pair/vocabulary, or resolution-state consistency. The activation must
first inventory production for:

- self-reports;
- unknown reasons and target types;
- half-populated target pairs;
- unresolved rows with resolution metadata;
- resolved rows without a resolution timestamp;
- resolved rows without a resolution note, separated into legacy and
  deletion-system outcomes.

Add only constraints that preserve reviewed legacy/legal records. Do not
delete or rewrite report evidence merely to satisfy a migration.

### USERREPORT-RLS-6: resolution-note storage and audience are ambiguous

Classification: `DESIGN_DECISION_BEFORE_IMPLEMENTATION`.

The code atomically records a full note in `UserReport` and a privacy-minimized
witness in `AdminAuditLog`; `CLAUDE.md` and the closed ledger claim both store
the note. The current single-note design avoids duplicating moderation
narrative and is sufficient to prove an audit row co-committed, while the
report row remains retained.

Separately, account export sends that same note to both the reporter and the
reported user. The staff form calls it a resolution reason but does not say it
is participant-visible. A well-intentioned staff member can therefore put the
reporter's identity, report details, or internal investigative material into a
field later disclosed to the reported user, contradicting the no-reporter-
identity/details projection.

Select and document both contracts before implementing the fixed transition.
This audit recommends preserving the privacy-minimized audit witness and either
making the one report note explicitly participant-safe (with clear form copy
and a behavior test) or splitting participant-facing rationale from an
internal note. Do not silently expose an unrestricted internal note through
account export.

### USERREPORT-RLS-7: current tests do not prove the report lifecycle

Classification: `TEST_GAP`.

Most report tests assert source text. Existing PostgreSQL proofs exercise the
reported-thread and notification consumers, but no current full-chain suite
executes the complete create, target-attribution, queue, resolve, export, and
account-deletion lifecycle through the production-shaped authorities. That is
why the attribution and queue defects remained while guardrails were green.

### USERREPORT-RLS-8: polymorphic target retention is intentional

Classification: `PRESERVE_DURING_SECURITY_RELEASE`.

`targetId` has no foreign key and may outlive removed content. That permits a
trust record to survive content deletion. The fixed submit statement must
validate the target at creation time, but later target removal must not delete
or invalidate the report. Staff projections must degrade to a missing-target
state without exposing whether an inaccessible private target exists.

## Concurrency And Recovery Requirements

- submission validates the actor, reported user, target visibility and target
  attribution in the same database statement that inserts the report;
- reporter and reported-user state is derived under the established User lock
  order without creating a new cross-domain lock inversion;
- duplicate submissions remain allowed, with the existing application rate
  limit as abuse control;
- target deletion after a valid insert retains the report and degrades staff
  context safely;
- listing-report notification failure never rolls back the report;
- resolution locks one unresolved row, writes the resolution fields and audit
  witness atomically, and returns a stale/no-longer-open result on replay;
- resolution racing account deletion produces one coherent terminal state:
  deletion may redact a committed staff note, while a deletion auto-resolution
  makes the later staff resolve a no-op;
- account deletion keeps submitted/received perspective semantics, redacts
  details for either participant, and never deletes retained report evidence;
- rollback restores predecessor CRUD and application behavior before removing
  or disabling the new authority;
- the security release does not add a purge policy, delete historical reports,
  or broaden staff visibility.

## Required Behavior Proof

The acceptance suite must run against the complete migrated PostgreSQL 17
schema and prove at least:

1. ordinary runtime and no-context direct SELECT/INSERT/UPDATE/DELETE fail;
2. generic user report succeeds only for a distinct active target;
3. each accepted target type succeeds for its exact valid owner/author and an
   authorized reporter;
4. forged target ownership, private-object oracle attempts, self-reporting,
   banned/deleted reporter, deleted target, half target pair, unknown reason,
   and unknown target type fail;
5. a participant cannot attribute their own message to the counterparty;
6. a review cannot be attributed to the listing seller when the seller did not
   author the review;
7. target deletion after insertion retains the report and makes staff context
   degrade safely;
8. submitted export contains the reviewed full reporter projection;
9. received export omits reporter identity and details;
10. staff queue requires an active staff actor, returns the true unresolved
    count, and makes every row reachable oldest-first with a stable cursor;
11. every accepted target type has usable, bounded staff context;
12. resolution requires an unresolved row, writes one terminal state plus its
    audit witness, and replays safely;
13. staff role without a valid application PIN never reaches the operation,
    and the chosen resolution-note audience is explicit and cannot disclose
    reporter identity/details to the reported-user projection;
14. reporter deletion redacts details without erasing the report;
15. reported-user deletion redacts details/notes and auto-resolves only open
    reports against that user;
16. resolver account deletion preserves the internal `resolvedById` reference
    to the anonymized retained User row without exposing deleted staff profile
    or contact data; a later hard deletion follows the existing `ON DELETE SET
    NULL` foreign key without losing the report or audit evidence;
17. listing-report notification source validation still accepts the exact row
    and rejects forged reporter/reported/listing tuples;
18. reported-thread staff access remains available only for active staff and
    an unresolved exact thread report;
19. every installed function referencing `UserReport` has an accepted owner,
    SECURITY mode, search path, source identity and ACL;
20. emergency rollback restores the exact predecessor application statements.

## Audit Decision

`GO` for isolated compatible preparation using accepted Option B and a split
participant-rationale/internal-note contract, but `NO-GO` for policy or grant
activation. USERREPORT-RLS-1 through -5 are preparation requirements, not
follow-ups: attribution, staff reachability, target vocabulary/context, and
data invariants must be corrected and behavior-proven before activation. See
`docs/user-report-rls-options.md` for the accepted final boundary.
