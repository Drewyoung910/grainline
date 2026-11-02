# Commission domain pre-RLS audit

## Decision and exact source

This audit covers `CommissionRequest` and `CommissionInterest` as one tightly
coupled lifecycle. It was completed against exact `main`
`12a4dfc492412ff52ff94d921e20e7026c4cff38` on 2026-11-01, before any new
Commission policy, grant, function, or migration design was started.

The decision is **GO for one additive compatible preparation** using the
fixed-operation design in `docs/commission-rls-options.md`. It is **NO-GO for
RLS activation or runtime table-grant revocation** until every
`FIX_BEFORE_ACTIVATION` item below is closed on the fully migrated PostgreSQL
17 schema and the compatible application is live with predecessor traffic
drained.

The earlier `docs/user-public-review-commission-pre-rls-audit.md` remains
authoritative for the already-live buyer identity and location snapshots. That
work removed public commission reads from the private `User` row. It did not
audit or authorize the complete CommissionRequest/CommissionInterest boundary.

## Compatible-preparation implementation status (2026-11-01)

The additive compatible preparation is now implemented on
`codex/commission-rls-preparation-20261101`, based on exact `main`
`12a4dfc492412ff52ff94d921e20e7026c4cff38`. It adds migration
`20261101060000_prepare_commission_domain_authorities`, converts the ordinary
application to the fixed Commission operations, and deliberately leaves RLS
off plus predecessor table privileges intact.

Verified preparation evidence:

- source inventory reports zero direct `CommissionRequest` or
  `CommissionInterest` Prisma/raw-SQL access in `src`;
- 235 focused source/behavior guardrails pass, including owner/public reads,
  account state, rate limits, location privacy, direct-upload references,
  notification routing and atomic interest creation;
- the complete 448-migration chain plus the Commission scenario passes on both
  disposable PostgreSQL 16 and PostgreSQL 17;
- the PostgreSQL scenario covers public column shape, anonymous/viewer block
  filtering, owner isolation, actor-bound interest, upload binding, ban/unban,
  account deletion, expiry, function ownership/ACLs and both two-session race
  orders between interest creation and owner transition. Staff ban/restore
  operations require the same short-lived PIN-authorized capability as their
  parent account operation, a different authorized administrator can perform
  restore, and a reciprocal block removes retained interested makers from
  detail access and close/expiry notification targets;
- TypeScript passes, lint has zero errors, and the remaining five lint warnings
  are unchanged navigation warnings outside this Commission batch.

This evidence makes the branch a **compatible preparation candidate**, not an
activation candidate. Activation remains separately blocked on the denial,
query-plan-at-volume, deployment-skew, hard-cascade and database-first rollback
proofs listed below, plus compatible deployment/drain and exact production
authorization.

## Product contract

### Public discovery

- An anonymous visitor may discover an `OPEN`, unexpired request only while the
  buyer account is active.
- A signed-in viewer gets the same result minus buyers or interested makers on
  either side of a Block relationship.
- The public shape is limited to the request id, public title and description,
  category, budget, timeline, verified reference images, public status and
  timestamps, national/prefer-local scope, privacy-safe location/metro labels,
  and the existing buyer public-name/image snapshots.
- Public reads do not expose the raw base row, internal buyer id, interest
  conversation ids, deletion state, or future moderation fields.
- A local request stores only the existing many-to-one privacy-safe location
  point. Exact seller-profile coordinates must never be copied into this table
  or a public projection.
- Drew's recorded product decision is to describe `isNational = false` as
  **prefer local**, not as a promise that only nearby makers can see or answer
  the request. The current "Local makers only" copy is inaccurate and must be
  corrected before activation.

### Buyer ownership and retained history

- An active buyer may create a request for themselves, list all of their own
  requests, and close or fulfill an eligible open request.
- Creation derives `buyerId` from the authenticated database context, binds the
  public identity snapshots, verifies reference uploads, and records durable
  upload references in the same transaction.
- A buyer may read their own retained request after it becomes `FULFILLED`,
  `CLOSED`, or `EXPIRED`. Public discovery still excludes those states.
- Terminal changes are one-way today. `IN_PROGRESS` exists in the enum but no
  current route sets it; it is reserved for the later chosen-maker workflow.
- Account export includes every retained request owned by the buyer, including
  terminal requests, plus a derived interest count.

### Maker interest

- An active, supported, Stripe-ready maker who is not on vacation may express
  interest once per request, never on their own request and never across a
  reciprocal block.
- Interest creation, canonical conversation creation/reuse, the system message,
  and the request count update are one atomic operation. The existing
  `grainline_message_create_commission_interest` authority already provides
  this boundary and rechecks both users, the block pair, seller orderability,
  request status, and expiry while holding the necessary rows.
- A maker may read their own retained interest and the associated request after
  the request becomes terminal. They may not read another maker's private
  `conversationId`.
- Public maker chips remain a bounded projection of currently public/orderable
  makers. The buyer's private owner summary is a separate projection and must
  honor reciprocal blocks and account lifecycle.
- A ban makes a maker's interests ineligible without destroying them. Unban can
  therefore restore eligibility. Account deletion may permanently remove or
  redact them under the active deletion claim.

### Lifecycle and service work

- Expiry is an atomic `OPEN -> EXPIRED` transition. The transition returns the
  exact buyer and interested-maker notification targets from the same locked
  state.
- Buyer `FULFILLED` and `CLOSED` transitions similarly return the exact
  notification targets from the transition statement. No maker can be admitted
  between recipient selection and the status change.
- A buyer ban closes active requests through a bounded staff transition. An
  accepted undo may restore only the exact requests and statuses captured by
  that ban.
- A seller ban changes interest eligibility without deleting interest rows.
  Account deletion uses the active deletion claim and repairs affected counts.
- Sitemap, static-parameter, metro, browse, detail, API and source-count callers
  all share the same public visibility predicate.
- Notification validation, public interest counts/cards, direct-upload
  reference maintenance, export, deletion and provider/cron work keep distinct
  least-privilege operations.

## Current data classification

| Data | Classification | Notes |
| --- | --- | --- |
| Title, description, category, budget, timeline | Public while request is discoverable | Retained privately for participants after terminal state |
| Reference image URLs | Public while request is discoverable | Must remain verified first-party public media and be released on deletion/redaction |
| `buyerName`, `buyerImageUrl`, buyer city/state snapshots | Public artifact snapshots | Trigger-owned; not a general User directory |
| `lat`, `lng` on CommissionRequest | Public approximate point only | Creation currently applies at least a 5 km many-to-one cell before storage |
| `buyerId` | Internal relationship key | Needed for ownership, blocks, deletion and messages; omit from anonymous transport |
| `CommissionInterest.sellerProfileId` | Private relationship with bounded public projection | Public cards expose only eligible seller profile display fields |
| `CommissionInterest.conversationId` | Private participant routing | Buyer, that seller and fixed message/service operations only |
| `interestedCount` | Derived cache | Must agree with authoritative interest rows or be retired from decisions |

## Measured current boundary

Current source contains 35 direct Prisma Commission delegate operations across
14 files, plus two raw `CommissionRequest` queries in
`src/app/commission/page.tsx`. The direct callers are:

| Caller family | Current operations |
| --- | --- |
| Public board/API/detail/metro/metadata/static params | Count, list and read open requests; read the viewer's own interest |
| Buyer account page | List the buyer's retained requests |
| Request API | Create, set metro ids, and transition status |
| Interest API | Pre-read request before the existing atomic interest authority |
| Expiry cron | Select batches, transition status, and count remaining work |
| Sitemap/source counts | Count and list public requests |
| Account export | Export owned requests and seller interests |
| Account deletion | Count blockers, collect media, close/redact requests, delete seller interests |
| Ban and undo | Snapshot/close/reopen buyer requests and delete seller interests |
| Interest cleanup | Read/delete interests and repair request counts |

Already-centralized database operations that must be retained rather than
rewritten casually:

- `grainline_message_create_commission_interest`
- `grainline_seller_public_commission_interest_counts`
- `grainline_seller_public_commission_interest_cards`
- `grainline_seller_owner_commission_interest_summaries`
- `grainline_seller_service_commission_interest_targets`
- `grainline_direct_upload_sync_commission_request`
- buyer public-state bind/sync triggers
- seller public-location snapshot sync trigger
- notification source validation and rendering functions
- direct-upload reference release trigger

The ordinary runtime role currently retains broad predecessor CRUD on both
tables. Neither table has RLS enabled.

## Authority matrix

| Operation | Principal | Required authority/result |
| --- | --- | --- |
| Public page/count/detail/metro/sitemap read | Anonymous or active viewer | Bounded discoverable projection; viewer block filtering when context exists |
| Read terminal request | Owning buyer, interested maker, PIN-authorized staff | Participant-safe retained projection; no public indexing |
| Create request | Active buyer | Actor-derived owner; validated/sanitized content, privacy-safe location and upload references committed together |
| List/export own requests | Active or deletion-claim owner | Complete owner projection with stable pagination/counts |
| Close/fulfill request | Active owning buyer | Locked one-way transition plus exact notification target result |
| Expire request | Cron/service operation | Locked bounded batch transition plus exact target result and restart cursor |
| Express interest | Active orderable maker | Existing atomic interest/conversation/message authority, bound to authenticated actor context |
| Read own interest/export | Interested maker | Only that maker's rows and conversation ids |
| Public interest count/cards | Anonymous or active viewer | Only discoverable request plus eligible, unblocked maker projections |
| Buyer interest summary | Owning buyer | Only interests for owned request; lifecycle/block-filtered cards and authoritative raw count contract |
| Buyer ban/undo | PIN-authorized staff capability | Close/restore exact snapshotted active requests atomically with ban audit evidence |
| Seller ban/unban | PIN-authorized staff capability | Change visibility/eligibility without deleting the relationship |
| Account deletion | Active deletion side-effect claim | Blocker count, media ids, close/redact requests, delete/redact seller interests and repair counts |
| Direct-upload maintenance | Fixed upload service | Sync/release only references derived from the locked owned request |
| Identity/location snapshot sync | Owner-private trigger | Update only artifact snapshots from the referenced User/SellerProfile row |

No generic runtime function may accept a buyer, seller, or staff id as proof of
authority. Owner operations use transaction-local `app.user_id`; staff work
uses the protected staff role/capability; deletion work uses the active
generation/token-fenced side-effect claim.

## State and invariant review

### Request state

The reachable current state graph is:

```text
OPEN -> FULFILLED
OPEN -> CLOSED
OPEN -> EXPIRED
```

`IN_PROGRESS` is present in schema and ban/deletion logic but has no writer. A
later chosen-maker flow may use it only after its principal, selected interest,
payment/custom-listing linkage, cancellation and notification semantics are
separately designed.

Required database invariants for the compatible preparation:

- public snapshot fields remain trigger-owned and `buyerId` cannot be rebound;
- budgets remain non-negative, bounded and ordered;
- a prefer-local row has valid privacy-safe coordinates and a bounded radius;
- a national row cannot be made to carry exact seller-profile coordinates by a
  generic update path;
- terminal status cannot return to `OPEN` except through the exact staff ban
  undo witness;
- `interestedCount` is never an authorization fact and cannot drift silently;
- an interest is unique per `(commissionRequestId, sellerProfileId)`;
- a non-null interest conversation belongs to the exact buyer/seller pair;
- content and arrays remain bounded at the database authority, not only in UI.

### Concurrency and recovery

The existing interest writer has the strongest part of the lifecycle: it locks
both users in canonical order, then SellerProfile, CommissionRequest,
CommissionInterest and Conversation, and co-commits the message and count.

The following predecessor races must be removed in preparation:

1. Buyer status PATCH selects notification targets before its conditional
   request update. A maker may be admitted between those steps and miss the
   terminal notification.
2. Expiry cron has the same target-before-transition race. A notification
   failure after the status flip is logged but not recoverable.
3. Metro assignment happens after create in a separate best-effort statement.
   It needs a bounded owner/service operation that refuses a changed, redacted
   or foreign request.
4. Ban deletes maker interests permanently. Undo cannot restore them and the
   public/owner projections do not all use identical lifecycle/block rules.
5. Account deletion and ban hand-maintain `interestedCount`; interruption or a
   future cascade can leave the cache stale.

Preparation therefore uses CommissionRequest as the serialization row for
create/status/expiry/interest cleanup transitions, returns notification work
from the locked transition, and makes replay idempotent. Multi-request workers
use `(expiresAt, id)` keyset order with bounded batches rather than an
ever-growing `NOT IN` list.

## Verified findings and disposition

### `FIX_BEFORE_ACTIVATION`

1. **#437/#158:** terminal or elapsed requests 404 for their buyer and
   interested makers, including links from the account page, messages and
   notifications. Add participant-safe retained detail access; keep public
   discovery closed and `noindex`.
2. **Status/expiry target race (this audit):** choose recipients and transition
   state atomically under the request lock, with restart-safe notification
   evidence.
3. **#CASEADM-22 commission portion:** a seller ban deletes interests and undo
   cannot restore them. Preserve rows and make eligibility projections hide
   banned sellers instead.
4. **#6273/#1356:** owner summaries and the main board do not consistently
   apply active/block-aware interest visibility. Use one projection contract.
5. **#116/#456/#746 and #246:** replace the false "Local makers only" promise
   with the recorded "Prefer local" behavior, and do not imply that ordinary
   buyers already have an account location control.
6. **#543:** do not render Express Interest on the viewer's own request.
7. **#1353:** consume commission creation/interest rate limits only after cheap
   authentication and input/eligibility validation.
8. **#1059:** pin time-zone semantics in both commission-interest projections;
   do not compare a UTC-naive column with session-dependent timestamptz.
9. Replace all 35 direct delegate calls and two raw public queries with reviewed
   public, owner, participant, staff, cron, export and deletion operations.
10. Prove location-shape constraints, upload-reference parity, count repair,
    pagination and hard FK cascades on the real full chain.

### `DEFERRED_PRODUCT_WORK`

- **#395/#552:** chosen-maker, `IN_PROGRESS`, custom-listing and paid-order
  linkage. Future writes must use a selected `CommissionInterest` and keep
  retained participant access.
- **#558/COMMUNITY-04:** commission email/digest delivery. Future producers use
  the fixed participant/fanout projections and recheck source eligibility at
  send time.
- **#476:** national requests do not populate city commission pages. Any future
  coarse buyer-location capture must remain separate from exact account data.
- Commission-specific warning/moderation tools. A future staff queue uses the
  staff role and participant-safe evidence, never public table access.
- Replacing the seller-profile-only source for prefer-local posting with a
  buyer location control. This requires separate consent/copy/privacy design.

These deferrals do not require broad table authority. Their future principals
and required boundaries are recorded above.

## Scalability and observability

- Public list functions must use the existing `(status, createdAt)` and metro
  indexes and deterministic `(createdAt, id)` ordering. Distance search needs a
  plan check at realistic volume; it must not expose raw coordinates.
- Owner history is bounded and keyset-ready; do not hard-code a permanent
  thirty-request ceiling without pagination metadata.
- Expiry uses bounded keyset batches and records remaining work, failures and a
  retryable cursor in cron evidence.
- Interest cards/counts remain bounded. Raw counts and eligible public counts
  are different named contracts.
- Ops health should count overdue OPEN requests, stale derived counts, failed
  expiry notifications and malformed local-location rows without exposing
  request text.
- The release reuses the catalog-driven private-table workflow. One preparation
  and one later activation cover both tables; no copied per-table workflow is
  permitted.

## Proof and release gate

The preparation may proceed only with failing-on-current-main then passing
PostgreSQL 17 behavior coverage for the items above. Activation additionally
requires:

- exact source inventory showing zero direct CommissionRequest or
  CommissionInterest access outside reviewed migrations/tests/operators;
- anonymous, owner, interested-maker, unrelated-user, blocked-pair, banned,
  staff, cron and deletion-claim behavior proofs;
- two-session interest-vs-status, interest-vs-expiry, ban/unban, deletion and
  upload-reference races;
- public projection column seal and query-plan bounds;
- runtime/PUBLIC direct table denial, function ownership/ACL proof, ENABLE plus
  FORCE readback and hard-cascade behavior;
- a tested database-first emergency rollback that restores only predecessor
  grants needed by the still-compatible application;
- exact compatible deployment, predecessor drain and explicit production
  authorization.

