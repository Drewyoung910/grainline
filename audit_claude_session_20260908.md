# Claude read-only audit — session of 2026-09-05 → 2026-09-08

**Status: historical Claude leads. #25, #59, and the staff-password error
path have been independently checked by Codex as of 2026-09-24; bounded
release-boundary checks of PR #447, PR #448, and `e2cd6ba1` are recorded below.
The remaining findings are UNVETTED. Do not merge this audit into `audit_open_findings.md` or
`audit_closed.md` raw.**
Per CLAUDE.md, parent Codex must independently re-read every cited line, check for adjacent
logic this audit missed, and reject any conclusion whose exploit shape or product logic does
not hold. Every claim below is a *lead*, not a fact.

Audit was read-only throughout: no file in the repo was edited, staged, or committed by this
session other than this document.

---

## How to read this file

- **CONFIRMED** — I read the cited code and the failure follows from it.
- **PLAUSIBLE** — the shape is wrong but I could not fully establish reachability.
- **DISPROVEN** — recorded deliberately, so the same suspicion is not re-raised later.
- Every finding states **what I checked to rule out an adjacent guard**. Where I considered a
  stronger version of a claim and rejected it, that rejection is written down too.

Line numbers are against `main` at `d450b76e` and the working tree as of 2026-09-08.

### Codex current-source correction, 2026-09-24

The scoreboard and severity headings below are the September 8 snapshot, not
the present release state. On exact public main `98654025`, #25's sold-out
reservation case is corrected in
`20260905130000_prepare_order_paid_checkout_authority/migration.sql`: the new
paid-checkout function accepts an already-reserved `IN_STOCK` listing that
another paid reservation marked `SOLD_OUT`, while retaining other listing
checks. Its two-reservation disposable PostgreSQL case passes. The old app
still serves the canonical aliases, so #25 remains relevant until promotion.

#59 is **HIGH and a blocker to promoting the staged candidate**. The new
`grainline_stripe_checkout_order_create` function in that same migration
clears `Order.buyerId` and buyer PII for a banned, deleted, or missing buyer,
but calls the older `grainline_checkout_reservation_complete` function, which
requires the Order buyer ID to equal the reservation's non-null buyer ID.
`src/app/api/stripe/webhook/route.ts` calls the blocked-checkout refund only
after that SQL returns. A disposable PostgreSQL test reproduced the old
failure and passed with a one-function successor migration at private,
deployment-disabled head `6608c8fdc96dacd681d2b5f4193aaa0d3d59fdb6`.
That source also prepares a separate, Production-reviewed one-migration
workflow. The migration is **not applied**; the READY staged app must not be promoted
until it is reviewed, merged, applied, and checked. The original line numbers
below describe the old TypeScript webhook path and are stale for the new SQL
path. See `ORDER-BLOCKING-INPUTS-20260923.md` for the current gate.

New staff-bootstrap lead: `scripts/order-staff-read-role-bootstrap.mjs`
constructs dynamic `CREATE ROLE ... PASSWORD` SQL from a transaction-local
secret. A failed `CREATE ROLE` in disposable PostgreSQL returned the plaintext
password and dynamic statement in provider error fields. The Node adapter
suppressed that error from its own output; this does **not** establish what
Neon logged. Private, deployment-disabled head
`de2c861d8e3cf558240c686e6707d983acf1d98a` catches role-creation
errors inside PostgreSQL and rethrows a generic message; the same failure no
longer returns the password in tested error fields. Full SQL statement logging
and backend-fatal errors remain unverified. An ambiguous role-creation result
must still be reconciled before any credential replacement; a blanket
"generate a new password on every error" rule could orphan a committed role.

Bounded independent source review of Claude's other three claims: merged PR
#447's protected prefix workflow is main-only, requires its typed confirmation
and Production environment, shares `production-database-migrations` concurrency,
and invokes a fixed-prefix runner rather than accepting arbitrary SQL. This
supports the stated *dispatch boundary*, not a fresh audit of all 17 applied
migrations. Merged PR #448 binds staged requests and restart state to the
reviewed immutable deployment URL, checks the bypass value against its digest,
and inspects each of the five known alias owners. It allows only the explicit
project alias on the candidate metadata; provider metadata and source tests do
not establish future alias ownership or authenticated runtime success. Commit
`e2cd6ba1` admits CLI deployment metadata without a custom `gitCommitSha` only
when both `gitSource.sha` and `githubCommitSha` exist and match the reviewed
commit; it rejects conflicting SHA labels. These labels are not proof of the
uploaded build bytes. None of these bounded conclusions overrides the current
#59 pre-promotion blocker or substitutes for the staged smoke.

---

## Scoreboard

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM-HIGH | 1 |
| MEDIUM | 29 |
| LOW-MEDIUM | 8 |
| LOW | 20 |
| **Total findings** | **65** |

Numbering runs #1–#66 with **no #16**: it was absorbed into #5 mid-audit, when the refund
reconciliation migration turned out to carry five fail-open operands rather than the three
originally filed. Numbers were never reused, so a reference to "#42" in the session transcript
and in this file mean the same finding.

Plus: 1 unresolved open question, 12 sub-threshold notes, 6 disproven candidates, 5 findings
confirmed already fixed, and a verified-clean inventory.

**Coverage.** All 14 RLS-live tables; the full 30-migration Order authority family; the Stripe
webhook; account deletion; checkout (cart + buy-now); the upload/media boundary; the admin
surface; the Case family; Conversation/Message; email + cron infrastructure; middleware/auth;
search/browse/discovery; commission; reviews; the listing publish + AI moderation boundary;
cart and anonymous cart; blog; Guild verification.

**Historical September 8 priority:** #59 and #25 were both reported CRITICAL
on the paid-checkout path. Their current release disposition is above.

---

## The dominant defect pattern

Roughly two-thirds of these findings are one shape: **a rule is correctly specified in one
place and only partially applied by its consumers.** The primitives in this codebase are
strong — lease fencing, generation-fenced claims, projection triggers, advisory-lock ordering,
composite FKs that make invalid states unconstructible. The failures are almost all at the
seams between them.

Representative instances:

| rule | applied correctly | applied incompletely |
|---|---|---|
| dispute projection (#13) | `public_aggregate` | seller analytics, seller metrics, eligibility |
| deauth hold sentinel (#11) | exported `..._SQL_PATTERN` constant | 5 hardcoded SQL literals |
| default-off prefs (#14) | settings page `isEnabled()` | delivery lib + prepared SQL |
| actor active-check (#17) | write authorities, detail v2 retrofit | 7 read authorities |
| private cache headers (#46) | `blog/search/suggestions` | `blog/search` |
| `featuredUntil` clearing (#55) | `unfeatureMaker`, account deletion | both revocation paths |
| cache invalidation (#56) | ~25 sites incl. both Guild crons | admin Guild transitions |
| CAS on publish (#49) | `publishListingAction`, custom, admin | `updateListing` |

The second-order observation is worse than any individual instance: **the documentation and
the guardrail tests usually enumerate instances rather than state the property.** `blog/search`
was missed because CLAUDE.md's rule lists "blog suggestions, blog comments, commission
list/detail" instead of saying "any handler that calls `getBlockedIdsFor`." The test file
mirrors the enumeration. So the docs, the tests, and the code all had the same blind spot in
the same place.

---

# CRITICAL

## #25 — Webhook auto-refunds a legitimate paid order when a listing sells its last units concurrently

**Current-source note:** corrected in the new, staged paid-checkout SQL at
`20260905130000_prepare_order_paid_checkout_authority/migration.sql:463-479`;
canonical aliases still serve the predecessor app. The lines below describe
the earlier webhook implementation.

**CONFIRMED.** `src/app/api/stripe/webhook/route.ts`, `src/lib/stripeWebhookState.ts`

Four facts, each read directly:

1. Stock reservation decrements `stockQuantity` but **never writes `status`**
   (`prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql:843-855`).
   A listing with all stock reserved is therefore still `ACTIVE`.

2. The webhook itself flips it, inside the same transaction as `Order.create`
   (`src/app/api/stripe/webhook/route.ts:1716-1722`):
   ```sql
   UPDATE "Listing" SET status = 'SOLD_OUT'
    WHERE id = ${paid.listingId} AND "stockQuantity" <= 0 AND status = 'ACTIVE'
   ```

3. Transaction-time revalidation treats any non-`ACTIVE` status as an invalid checkout
   (`src/lib/stripeWebhookState.ts:440`):
   ```ts
   if (listing.status !== "ACTIVE") return "Listing was no longer active before payment completion.";
   ```
   No `SOLD_OUT` exemption. No awareness that the reservation system is what emptied the stock.

4. An invalid reason issues a **full automatic refund** (`route.ts:1766-1771`) for
   `refundAmountCents = chargedTotalCents` (`route.ts:1157`).

**Failure scenario.** Listing has 2 units. Buyer A checks out (stock 2→1, still ACTIVE).
Buyer B checks out (stock 1→0, still ACTIVE). Both pay. A's webhook re-reads the listing —
ACTIVE, valid — creates the order, then flips it to `SOLD_OUT`. B's webhook re-reads,
sees `SOLD_OUT`, produces an invalid reason, creates B's order with the blocked-checkout
marker and nulled buyer PII, and refunds B in full.

B paid, has their money returned without asking, and does not receive the item. The seller
loses a completed sale. Per the audit agent, the seller may additionally be tagged with a
false `ownership_violation` security event (`route.ts:1046-1052`).

**Why this is not an exotic race.** This is "the last two units of an in-stock listing sell at
the same time" — the single most likely moment for concurrent checkouts on any listing. The
two sessions hold different `lockCheckoutSessionMutation` keys (keyed per Stripe session id),
so nothing serializes them, and under READ COMMITTED B's re-read sees A's committed flip.

**Second variant, no concurrency required.** Any seller action that legitimately takes a
listing out of `ACTIVE` — manual stock-to-zero, hide, mark sold — during the window after the
buyer paid but before webhook delivery produces the same auto-refund.
`expireOpenCheckoutSessionsForListing` (`src/lib/checkoutSessionExpiry.ts:121-176`) cannot
intercept it because it only enumerates sessions with `status: "open"`.

**Scope.** `IN_STOCK` listings only — the `SOLD_OUT` flip is gated on
`listing.listingType === "IN_STOCK"`.

**What I checked to rule out an adjacent guard.**
- Read the reservation SQL to confirm it never writes `status`, so the listing is genuinely
  still ACTIVE at reservation time for both buyers and the *only* thing making it `SOLD_OUT`
  is the first webhook's own bookkeeping.
- `invalidCheckoutListingReason` has no `SOLD_OUT` or reservation exemption, and
  `checkoutInvalidReasonState` applies it unconditionally to every listing in the order.
- The `already`-order short-circuit (`route.ts:876-901`) does not apply — B's order does not
  exist yet.
- Reservation restore does restore `SOLD_OUT → ACTIVE`, but restore never runs for a paid
  session.
- The same defect exists on the single/buy-now path: re-read at `1909-1936`, flip at
  `2076-2082`, refund at `2112`.

**The current test suite pins the wrong behavior.** `tests/stripe-webhook-state.test.mjs:539-547`
asserts `status: "SOLD_OUT"` produces an invalid reason, so nothing catches this.

**Fix direction.** The revalidation must distinguish "listing left ACTIVE for reasons unrelated
to this purchase" from "this purchase's own reservation emptied the stock." The reservation row
already carries that fact — `checkoutReservationId` is in the Stripe session metadata.

---

## #59 — A buyer banned mid-checkout is charged with no order, no refund, and a permanently failing webhook

**Current-source note:** independently reproduced on the new SQL path; HIGH
pre-promotion release blocker. The successor correction is private and has
not been applied. The line references below point to the earlier TypeScript
path; current Order creation and reservation completion are in
`20260905130000_prepare_order_paid_checkout_authority/migration.sql` and
`20260810190000_prepare_checkout_stock_reservation_authority/migration.sql`.

**CONFIRMED.** Two documented behaviors are in direct contradiction.

CLAUDE.md requires: *"If the buyer is missing, banned, or deleted at transaction time, the order
must not attach `buyerId` or retain a fresh buyer PII snapshot from Stripe/session metadata; keep
buyer snapshot fields null and stamp `buyerDataPurgedAt`."*

`grainline_checkout_reservation_complete` requires the opposite
(`prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql:1102-1110`):
```sql
PERFORM 1 FROM public."Order" AS source_order
 WHERE source_order."stripeSessionId" = p_session_id
   AND source_order."buyerId" IS NOT DISTINCT FROM source_reservation."buyerId"
   AND source_order."sellerProfileId" IS NOT DISTINCT FROM source_reservation."sellerId";
IF NOT FOUND THEN
  RAISE EXCEPTION 'Checkout completion is missing its durable order'
    USING ERRCODE = 'check_violation';
END IF;
```

**The chain, each link verified directly:**
1. `src/lib/stripeWebhookState.ts:465` — `effectiveBuyerUserId = buyerReason ? null : …` when
   `invalidCheckoutBuyerReason` fires (missing / `banned` / `deletedAt`, `:428-433`).
2. `:480` returns it as `buyerUserId` from `checkoutInvalidReasonState`.
3. `src/app/api/stripe/webhook/route.ts:1559` — `buyerId: cartInvalidState.buyerUserId` is written
   into `Order.create`, so `Order.buyerId` is **NULL**. (Mirror on the single path at `:1961`.)
4. The reservation's own `buyerId` is guaranteed **non-NULL** by the write trigger
   (`migration.sql:558-562`: a non-`'deleted'` `payloadHash` requires `buyerId IS NOT NULL`).
5. `NULL IS NOT DISTINCT FROM 'usr_x'` → FALSE → `NOT FOUND` → **RAISE**.
6. `markCheckoutStockReservationCompleted(tx, …)` at `route.ts:1728` runs on the **same transaction
   client, unconditionally** — it is not gated on `invalidReason`.

The raise therefore rolls back the `Order`, its `OrderItem`s, the payment-event rows, and the cart
cleanup. The blocked-checkout auto-refund at `route.ts:1766` sits *downstream of the transaction*
and never executes. Stripe retries and reproduces the identical state on every delivery.

**Net result: the buyer is charged, no `Order` ever persists, the automatic refund never runs, the
reserved stock stays decremented permanently, and the webhook fails on every retry.**

**Why the operator was chosen, and why that is the trap.** `IS NOT DISTINCT FROM` almost certainly
exists to tolerate the account-scrub case, where `grainline_checkout_reservation_account_scrub`
(`:1866-1874`) nulls the reservation's `buyerId`. The NULL-tolerant operator picked for one case is
exactly what breaks the other. It is the same root cause as the fail-open family — a NULL-tolerant
comparison used where an exact match is meant — except here it fails **closed and fatally**.

**What I checked to rule out an adjacent guard.**
- The `Order` existence check at `:1102` executes **before** the `already_completed` early return at
  `:1112-1114`, so a retry cannot short-circuit past it.
- `grainline_checkout_reservation_complete(p_event_id, p_claim_generation, p_reservation_id,
  p_session_id)` takes **no buyer parameter**, so the `sessionMeta.buyerId` the app passes is
  irrelevant — the comparison is against the reservation's own stored column.
- `sellerProfileId` is *not* nulled for the seller-invalid case (`route.ts:1560`), so this is
  buyer-side only.
- `Order.buyerId` is `String?` in `prisma/schema.prisma`, confirming NULL is a legal, intended
  value here.
- The reservation is found rather than `'absent'`: `bind_session` succeeded at checkout, so
  `stripeSessionId` is set and the lookup at `:1082-1092` matches.

**Worse than #25.** There the buyer is auto-refunded — they lose the item but recover their money.
Here they are charged with no order and no refund path at all.

---

# HIGH

## #1 — Blocked-checkout refund restores stock regardless of fulfillment state

**CONFIRMED.** `prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql`,
`grainline_blocked_checkout_refund_record_core`, lines 691–1194.

`fulfillmentStatus` appears **exactly once** in that entire 1,400-line migration — line 581,
inside `grainline_seller_refund_record`, a different function. `_core`'s stock-restore loop is
unconditional:

```sql
UPDATE public."Listing" SET "stockQuantity" = COALESCE(…,0) + …
UPDATE public."Listing" SET status = 'ACTIVE' … AND status = 'SOLD_OUT' AND "stockQuantity" > 0
```

The seller sibling has the fulfillment guard; the blocked-checkout sibling does not. Stock is
returned for a unit already shipped.

**Re-verified 2026-09-06** against `HEAD`: no later migration redefines `_core`, and the single
`fulfillmentStatus` reference is still at line 581 in the other function.

**Composes with #2.** Same webhook-retry window: #2 lets the refund proceed despite a purchased
label, #1 then returns stock for a unit in the mail.

---

## #2 — Blocked-checkout claim is missing the purchased-label guard

**CONFIRMED.** `prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql:386-396`

Line-for-line against its sibling `grainline_seller_refund_claim` (:194-205) in the same file,
seven of eight guards match. `labelStatus = 'PURCHASED'` is absent only from the
blocked-checkout side:

```
seller_refund_claim :194-205          blocked_checkout_refund_claim :386-396
  sellerRefundId IS NOT NULL            sellerRefundId IS NOT NULL
  sellerRefundLockedAt IS NOT NULL      sellerRefundLockedAt IS NOT NULL
  caseResolutionClaimId IS NOT NULL     caseResolutionClaimId IS NOT NULL
  refundClaimId IS NOT NULL             refundClaimId IS NOT NULL
  stripePaymentIntentId IS NULL         stripePaymentIntentId IS NULL
  paidAt IS NULL                        paidAt IS NULL
  labelStatus = 'PURCHASED'      ←──── ABSENT
  EXISTS (refund ledger…)               EXISTS (refund ledger…)
```

**This one changed shape during the audit.** `20260830030000_enable_order_payment_event_rls:504`
now **revokes** `grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)` from
`grainline_app_runtime`. That closes direct runtime access but **adds no guard** — the path is
now reached through `grainline_blocked_checkout_refund_claim_resume`, which delegates to it at
`20260824020000:127` and is what the app actually calls
(`src/lib/orderRefundClaimAuthority.ts:165`). Neither of the two newest OrderPaymentEvent
migrations mentions `labelStatus` at all. Still open.

---

## #3 — Checkout reservation repair fails open on NULL and unconditionally restores stock

**CONFIRMED.** `prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql`,
`grainline_checkout_reservation_repair_finalize`, entry guard at 1556-1564.

```sql
IF p_reservation_id IS NULL OR char_length(p_reservation_id) NOT BETWEEN 1 AND 191
   OR p_repair_generation IS NULL OR p_repair_generation < 1
   OR p_outcome NOT IN ('NO_SESSION_RESTORE','SESSION_EXPIRED_RESTORE','PAID_OR_COMPLETE',
                        'RETRIEVE_FAILED','UNRECOGNIZED','EXPIRE_FAILED') THEN
```

Two of three parameters get an explicit `IS NULL`; `p_outcome` does not. With `p_outcome = NULL`
the `NOT IN` yields NULL, the guard does not fire, and downstream:

- `:1614` `IF p_outcome IN ('PAID_OR_COMPLETE', …)` → NULL → the deferred path is **skipped**
- `:1632` `IF (p_outcome = 'NO_SESSION_RESTORE' AND …) OR (…)` → NULL → consistency check **skipped**
- `:1639` `restore_items(…)` runs
- `:1650` `SET status = 'RESTORED'` — unconditional fall-through

Net effect: an unconditional stock restore with no consistency check — **oversell**.

Rated HIGH-latent rather than HIGH because reachability depends on a caller passing NULL, and
the TS wrapper normalizes today. It sits on the inventory path with an oversell outcome, and the
identical guard shape is correct two lines above it.

---

## #17 — Six live Order-read functions have no active-actor check, and two routes reaching them don't either

**CONFIRMED.** Three legs, each verified independently.

**The SQL.** `grep -c banned` returns **0** in both
`prisma/migrations/20260901080000_prepare_order_participant_summary_authority/migration.sql`
and `…20260901090000_prepare_order_participant_cursor_authority/migration.sql`. The functions
check participation only:

```sql
WHERE source_order."buyerId" = p_actor_user_id          -- buyer side
JOIN "SellerProfile" seller ON seller.id = source_order."sellerProfileId"
 AND seller."userId" = p_actor_user_id                   -- seller side
```

The four `deletedAt` hits in those files are all on `buyer.` — the buyer being *described* for
PII suppression, not the actor.

**The precedent proves it is an oversight, not a decision.** The sibling *detail* functions
shipped with the same gap and were then retrofitted.
`20260901100000_prepare_order_participant_detail_projection/migration.sql:107-111` wraps v1 and
adds exactly the missing predicate:

```sql
FROM public.grainline_order_buyer_detail(p_actor_user_id, p_order_id) AS detail
JOIN public."User" AS actor
  ON actor.id = p_actor_user_id
 AND actor.banned = false
 AND actor."deletedAt" IS NULL
```

…then `REVOKE`s the unguarded v1s from `grainline_app_runtime` at `:381-383`. So the team
identified this exact gap in one branch of the family and did not propagate it.

**The app layer does not cover it.**
`src/app/dashboard/orders/page.tsx:42-43` and `src/app/dashboard/sales/page.tsx:81-82`:
```ts
const me = await prisma.user.findUnique({ where: { clerkId: userId } });
if (!me) redirect("/sign-in?redirect_url=/dashboard/orders");
```
Bare `findUnique`, no `banned`/`deletedAt` branch, `me.id` fed straight into
`readBuyerOrderSummaryPage`. This is verbatim the anti-pattern CLAUDE.md names: *"must not fall
back to a minimal `prisma.user.findUnique()` that skips banned/deleted checks."*
`/account/orders` and `/account` use `ensureUserForPage` and are fine.

**Scope is six functions, not four.** Those two routes reach:
```
countBuyerOrders          → grainline_order_buyer_count
readBuyerOrderSummaryPage → grainline_order_buyer_summary_page / _after_page
countSellerOrders         → grainline_order_seller_count
readSellerOrderSummaryPage→ grainline_order_seller_summary_page / _after_page
```

**The structural picture.** I built the actor-check matrix across all 18 Order authority
migrations. **Write** authorities consistently verify the actor is live (fulfillment 6, label 5,
case invariants 23, checkout receipt 2, staff read 4, detail projection v2 4). **Read**
authorities mostly do not (export, eligibility, seller analytics, seller metrics, summary,
cursor, list-correction, snapshot-correction — all 0). The detail retrofit is the tell that the
team's own standard for reads is "check it."

Rated HIGH not critical because middleware is a real mitigating layer — but it is app-layer only
with a documented 60-second account-state cache TTL, and these functions become the *sole* Order
read path once RLS activates, at which point the DB check is the only one left.

---

## #21 — Manual fulfillment races an in-flight label purchase, and the label recorder then overwrites fulfillment state unconditionally

**CONFIRMED.** Two facts, both verified by direct read.

**`labelClaimStatus` appears zero times** in
`prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql` and zero
times in `src/lib/orderFulfillmentAuthority.ts`. The fulfillment transition has no awareness of
an in-flight label claim.

**The label recorder's SUCCESS write is unconditional**
(`prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql:678-712`):
```sql
UPDATE public."Order"
   SET "labelStatus" = 'PURCHASED',
       "fulfillmentStatus" = 'SHIPPED',
       "shippedAt" = now_utc,
       "trackingCarrier" = p_carrier,
       "trackingNumber" = p_tracking_number, …
 WHERE id = locked_order.id;          -- no fulfillmentStatus predicate
```

**Sequence.** `label_claim` sets `labelClaimStatus = 'PROVIDER_PENDING'` but leaves `labelStatus`
un-purchased. The fulfillment guard only rejects `labelStatus = 'PURCHASED'`, so while the route
is blocked on the Shippo call (`maxDuration = 60`), a concurrent
`POST /fulfillment {action:"shipped"}` passes every guard and writes SHIPPED with manual
tracking. The buyer can then confirm receipt → DELIVERED. Shippo returns, and line 687 reverts
`DELIVERED → SHIPPED` while `deliveredAt` stays set, silently replacing the tracking number the
buyer was already emailed.

**Why this is more than a tight race.**

*The invariant predates the state machine it needs to cover.* CLAUDE.md says *"its final
state-change SQL predicate must keep that label-status guard so a manual tracking submit cannot
race a Grainline label purchase."* That guard — `labelStatus = 'PURCHASED'` — is present and
satisfied. It is simply insufficient: `labelStatus` marks a *completed* purchase, while the
state meaning "purchase in flight" is `labelClaimStatus`, which was added later. The rule is met
and the property it was written to guarantee is not.

*It compounds with #11.* The AMBIGUOUS branch (`20260901140000:626-640`) parks the order at
`labelClaimStatus = 'PROVIDER_AMBIGUOUS'` with `reviewNeeded = true` and a note starting
`'AMBIGUOUS LABEL: '`. The fulfillment transition's only `reviewNeeded` gate is a prefix match
on `'Seller Stripe account was deauthorized after payment.%'` — so it does not catch this note.
After an ambiguous Shippo outcome, **where a label may actually have been bought**, the seller
can keep manually marking shipped indefinitely until staff reconcile. That is the wide window,
and it is exactly the fragility #11 describes: a prefix-matching hold cannot catch a hold
someone else wrote.

**What was checked to rule out an adjacent guard.** `sellerLabelPreflight` (`:154-160`),
`grainline_order_seller_label_quote_replace` (`:330-333`), and
`grainline_order_seller_label_claim` (`:451-457`) **all** guard
`labelClaimStatus IN ('PROVIDER_PENDING','PROVIDER_AMBIGUOUS','PROVIDER_RECORDED')` — confirming
the guard exists throughout the label family and is missing only from the fulfillment family.
`grainline_order_label_clawback_claim_batch` does not compensate.

---

## #44 — A seller editing a listing's type permanently wedges the inventory repair queue

**CONFIRMED**, including the starvation half.

`grainline_checkout_reservation_restore_items`
(`prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql`,
relative lines 24-31 of that function) requires the listing still be in-stock:

```sql
UPDATE public."Listing" AS listing
   SET "stockQuantity" = ...
 WHERE listing.id = ... AND listing."listingType" = 'IN_STOCK';
GET DIAGNOSTICS updated_count = ROW_COUNT;
IF updated_count <> 1 THEN
  RAISE EXCEPTION 'Reserved listing could not be restored';
```

**Nothing catches the raise.** The entire 1,958-line file contains only two `EXCEPTION` handler
blocks (lines 516 and 993); neither is in `repair_finalize`. So the whole finalize transaction
aborts — including the back-off `UPDATE "expiresAt" = source_now` that was meant to defer this
row.

**The claim batch then re-selects it forever** (`repair_claim_batch`, relative lines 11-19):
```sql
WHERE reservation.status IN ('RESERVED','SESSION_CREATED')
  AND reservation."expiresAt" < source_now - interval '2 hours'
  AND (reservation."repairClaimedAt" IS NULL
       OR reservation."repairClaimedAt" < source_now - interval '5 minutes')
ORDER BY reservation."expiresAt" ASC, reservation.id ASC
LIMIT safe_limit
FOR UPDATE SKIP LOCKED
```
`repairClaimedAt` *is* committed by the claim call (a separate transaction) but goes stale after
five minutes. `expiresAt` never advances because that update died with the aborted finalize. And
`ORDER BY expiresAt ASC` means the poison row always sorts **first**.

**Two compounding harms.**
1. **Permanent stock loss.** The reserved units are never returned. Inventory is silently short
   forever.
2. **Queue starvation, self-amplifying.** Every five minutes the cron re-claims the same poison
   rows, aborts, and re-claims them next cycle. Once `safe_limit` poison rows accumulate at the
   front of the ordering, the repair job is permanently wedged and *no* reservation is ever
   restored again — a marketplace-wide inventory failure growing from a single bad row.

**The trigger is an ordinary seller action.** A seller editing a listing from `IN_STOCK` to
`MADE_TO_ORDER` while any checkout reservation is open poisons it. No malice and no narrow race
window — the edit form offers this, and the poison persists forever once created. A hard-deleted
listing does the same.

**Second queue, worse.** `grainline_checkout_reservation_account_claim_batch` (the
account-deletion cleanup queue, relative lines 17-28) selects with **no `expiresAt` filter at
all** and orders by `createdAt ASC`, which never changes. Even a successfully committed deferral
could not move a row down that ordering. The repair queue at least *has* a back-off mechanism
that would work if the transaction survived; this one has none.

---

## #60 — A session-less reservation can be restored twice by two independent ledgers

**CONFIRMED code path; PLAUSIBLE frequency.**

`grainline_checkout_reservation_webhook_restore` returns `'absent'` only when **no row has
`stripeSessionId = p_session_id`** (`migration.sql:1241-1249`) — so a reservation whose row exists
but has `stripeSessionId IS NULL` is invisible to it. And `'absent'` falls straight through to a
second, independently-ledgered restore (`src/lib/checkoutStockRestore.ts:294-307`, `:369-378`):
```ts
if (transition.result === "absent") return false;
…
if (await handleFixedReservationTransition(reservationRestore, input.sessionId)) return;
await restoreLegacyUnorderedCheckoutStockOnce(input);
```

**How a session-less RESERVED row arises.** At `src/app/api/cart/checkout-seller/route.ts:655-688`
(mirror at `single/route.ts:631+`), when `bindCheckoutStockReservationSession` returns false the
route attempts `stripe.checkout.sessions.expire(session.id)`. If **that call throws**,
`staleSessionExpired` stays false, `abortCheckoutStockReservation` is skipped, and the route
returns 409 — leaving a live Stripe session plus a `RESERVED`, session-less reservation holding
decremented stock.

**The double restore.**
1. Stripe's `checkout.session.expired` → `webhook_restore` → `'absent'` →
   `restoreLegacyUnorderedCheckoutStockOnce` restores from Stripe line items under
   `grainline_legacy_stock_restore_claim(sessionId)` (`src/lib/stripeWebhookMaintenance.ts:36-44`)
   — **restore #1**.
2. The session-less row later trips `repair_claim_batch` (`expiresAt < now-2h`) and
   `repair_finalize` with `NO_SESSION_RESTORE` → `restore_items` — **restore #2**.

Net stock **inflation** equal to the reserved quantity — the inverse of an oversell guard, letting
the seller sell units they do not have.

**What I checked to rule out an adjacent guard.** The legacy ledger is a separate SQL function keyed
only on `sessionId`, with no reference to `CheckoutStockReservation`; and `repair_finalize`'s
superseded guard (`:1585-1588`) tests `repairGeneration` / `repairClaimedAt` / `stripeSessionId`,
none of which the legacy path touches. The same fallback exists in
`restoreBuyerExpiredCheckoutStockOnce` (`:380-392`) and `restoreSellerExpiredCheckoutStockOnce`
(`:394-406`). A second, lower-probability trigger: a >90-day manual Stripe replay, after
`prune_batch` deleted the terminal reservation (30d) and the webhook-event row was pruned (90d).


---

# MEDIUM-HIGH

## #13 — The dispute projection is applied by one of four sibling authorities

**CONFIRMED.**

The database maintains two denormalized eligibility flags on `Order`, and the architecture behind
them is the best thing in this codebase.
`grainline_order_payment_projection_state(orderId)` derives both from the `OrderPaymentEvent`
ledger; a BEFORE INSERT/UPDATE trigger (`projection_guard`) **raises** if the app writes a value
disagreeing with the derivation (`'Order payment eligibility projections are database-managed'`);
and a second trigger on the ledger recomputes them on every write. The application cannot make
them drift. The derivations are exactly right:

```sql
-- refund_blocked
eventType = 'REFUND'  AND (status IS NULL OR lower(status) NOT IN ('failed','canceled','cancelled'))
-- conversion_dispute_blocked
eventType = 'DISPUTE' AND (status IS NULL OR lower(status) NOT IN ('won','warning_closed'))
```

Both treat NULL as blocking — the fail-closed direction, and the opposite of the nine fail-open
guards elsewhere in this report.

**The defect is on the consumer side.** Four sibling authority migrations written the same day:

| migration | `paymentRefundBlocked` | `paymentConversionDisputeBlocked` |
|---|---|---|
| `20260901040000` order eligibility | 3 | **0** |
| `20260901050000` public aggregate | 5 | **2** ✅ |
| `20260901060000` seller analytics | 7 | **0** |
| `20260901070000` seller metrics | 2 | **0** |

One of four applies the dispute flag — and it is the *public* surface. The three omitting it are
the seller-facing and trust-gating ones.

**Three concrete consequences.**

1. **Seller analytics overstate revenue.** `20260901060000` backs Total Revenue, Total Orders,
   Avg Order Value, chart buckets, Top Listings, Recent Sales, and completed-order count — all
   seven paid-order predicates exclude refunds but not disputes. An order lost to a chargeback
   still shows as revenue on the seller's own dashboard. These RPCs are **wired**
   (`src/lib/orderSellerAnalyticsAuthority.ts:49-123`, imported by both analytics routes), so
   this is live.

2. **Guild thresholds count clawed-back money.** Both sales paths carry the gap:
   `grainline_order_seller_verification_sales` (eligibility authority — the Guild Member $250
   threshold) and `grainline_order_seller_metrics_facts` (metrics authority — `totalSalesCents`
   and `completedOrderCount` feeding Guild Master's $1,000 threshold and the admin approval
   check). Badges can be earned on revenue the platform lost to chargebacks. Given that Guild
   status is the buyer-facing trust signal and gates homepage spotlight rotation, this is the
   consequence I would rank highest.

3. **Chargeback buyers keep review rights.** `grainline_order_review_eligibility_lock`
   (`20260901040000:9-64`) excludes refunds via both `sellerRefundId IS NULL` and
   `paymentRefundBlocked = false`, requires `DELIVERED`/`PICKED_UP`, requires paid-with-Stripe-
   reference, and has a proper unique tie-breaker and `FOR UPDATE OF source_order` — but no
   `paymentConversionDisputeBlocked`. A buyer who filed and won a chargeback keeps the ability to
   review the seller they charged back.

**Fix.** One predicate per site, mirroring what `20260901050000` already does. The stronger fix
is folding both flags into a single shared paid-eligible predicate so a consumer cannot apply
half of it.

---

# MEDIUM

## #5 — Refund reconciliation authority: five fail-open operands across three guard statements

**CONFIRMED.** `prisma/migrations/20260824040000_prepare_order_refund_reconciliation_authority/migration.sql`

| line | operand | nullable on `Order`? |
|---|---|---|
| :200 | `source_order."sellerRefundId" NOT IN (…)` | yes — `String?` |
| :234 | `source_order."refundClaimSource" NOT IN ('SELLER','BLOCKED_CHECKOUT')` | yes — `String?` |
| :292 | `p_reason_code NOT IN (…)` | parameter, no `IS NULL` companion |
| :310 | `locked_order."sellerRefundId" NOT IN (…)` | yes |
| :316/:320 | `locked_order."refundClaimSource" <> 'SELLER'` / `<> 'BLOCKED_CHECKOUT'` | yes |

**:292** is the clearest asymmetry — `p_claim_id IS NULL` and `p_claim_generation IS NULL` are
both explicit in the same statement; `p_reason_code` is not.

**:304-320 is the densest guard found in the audit.** The two leading disjuncts are genuine
booleans, so they cannot rescue the chain — `FALSE OR FALSE OR NULL` is still NULL:
```sql
IF NOT FOUND                                                   -- boolean
   OR locked_order."refundClaimProviderAuthorizedAt" IS NULL    -- boolean
   OR locked_order."sellerRefundId" NOT IN ('pending','ambiguous_refund_pending_reconciliation')
   OR (p_reason_code LIKE 'SELLER_%'  AND locked_order."refundClaimSource" <> 'SELLER')
   OR (p_reason_code = 'BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS'
                                       AND locked_order."refundClaimSource" <> 'BLOCKED_CHECKOUT')
THEN RAISE …
```

**:234 is the worst individually.** It is the final disjunct of the claim-shape validation, and
with `refundClaimSource` NULL the whole chain evaluates NULL — bypassing not just the source check
but the **idempotency-scope binding** it guards:
```sql
OR source_order."refundClaimIdempotencyScope" IS DISTINCT FROM
   'seller-refund:' || source_order."refundClaimId" || ':FULL:' || claim_amount::text
```
That predicate proves the claim's scope string matches its derived amount and origin. It is the
anti-replay binding on a path that decides whether staff re-issue money Stripe may or may not
have already moved.

The file currently fails *closed* in some cases only because
`OrderRefundReconciliation.action`/`providerDisposition` are NOT NULL and the INSERT precedes the
release UPDATE. That is incidental, not designed.

**Recommend handing Codex this as one item** — "rewrite every guard in this file with NULL-safe
operators" — rather than five line fixes.

## #4 — Order label authority: `p_outcome` / `p_resolution` fail open at three sites

**CONFIRMED.** `prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql:566`, `:827`, `:1151`

At :566, every sibling parameter in the same `IF` has an explicit `IS NULL`; only `p_outcome`
lacks one:
```sql
IF p_actor_user_id IS NULL OR p_actor_user_id !~ '…'
   OR p_order_id IS NULL OR p_order_id !~ '…'
   OR p_claim_id IS NULL OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
   OR p_claim_generation IS NULL OR p_claim_generation < 1
   OR p_outcome NOT IN ('REJECTED', 'AMBIGUOUS', 'SUCCESS')     ← no IS NULL
   OR (p_error_summary IS NOT NULL AND char_length(p_error_summary) > 500) THEN
```
Downstream dispatch is all-negative — `:580 IF p_outcome <> 'SUCCESS' THEN RETURN NULL`
(the disabled-actor gate, skipped on NULL), `:610 = 'REJECTED'`, `:627 = 'AMBIGUOUS'`, falling
through to SUCCESS at ~647. So **NULL ≡ SUCCESS** on a label-purchase authority, and it bypasses
the disabled-actor gate on the way.

`grainline_order_label_clawback_finalize` was checked and is **clean** — a five-way fence under
`FOR UPDATE` (`labelClaimId`, `labelClaimGeneration`, `labelClawbackGeneration`,
`labelClaimStatus = 'PROVIDER_RECORDED'`, `labelClawbackStatus = 'RETRYING'`).

## #6 — DirectUpload's function-surface proof is name-scoped; one runtime-granted function escapes it

**CONFIRMED.** See #51 for the generalized form.

`20260801194000_enable_direct_upload_rls` pins **35** function bodies by `md5(prosrc)` plus
`prokind`, `prosecdef`, `proleakproof` false, exact `proconfig`, owner, exact runtime *and*
cleanup EXECUTE booleans, and no PUBLIC execute. Its postflight asserts ENABLE+FORCE on both
tables, zero policies, and zero privileges across all 7 privilege types × 2 roles × 2 tables plus
column-level ACLs. It is the strongest activation proof in the repo.

But the inventory is scoped by `proname LIKE 'grainline\_direct\_upload\_%'` with **no
name-independent backstop** — unlike `StripeWebhookEvent`'s FORCE preflight, which additionally
counts runtime-executable functions by `strpos(prosrc, '"StripeWebhookEvent"') > 0`.

I scanned every function body in the migration history for references to the two DirectUpload
tables. Exactly one falls outside the prefix: **`grainline_case_reply`**, which is
`GRANT EXECUTE`-ed to `grainline_app_runtime`
(`20260729052000_prepare_case_reply_authority/migration.sql:449-451`) and whose current body reads
and `FOR UPDATE`-locks `public."DirectUpload"` at
`20260801175000_retire_direct_upload_compatibility_key/migration.sql:518`, `:548`, `:606`. It
appears **zero times** in the activation migration.

**And its body is md5-pinned nowhere.** The Case RLS migrations name it in an allowlist
(`20260804160000:304`, `20260804191000:253`) but contain **zero md5 pins** (`grep -c` returns 0).
So the sole holder of DirectUpload authority outside the pinned set is the least body-pinned kind
of function in the codebase.

Not exploitable today — its own guards are correct: the upload's `userId` must equal the actor,
`endpoint` must be `caseEvidenceImage`, `publicUrl` must be NULL (private storage only), and the
key must be exactly 4 segments deep. The actual `CLAIMED` transition happens in
`grainline_direct_upload_case_attachment_bind()`, a trigger that *is* pinned. The design is sound;
the assurance boundary has a one-function hole.

## #7 — Four of ten accepted user-report target types are dead-lettered

**CONFIRMED.** The API accepts ten `targetType` values and ownership-validates them
(`src/app/api/users/[id]/report/route.ts:28-38`): `USER`, `LISTING`, `ORDER`, `MESSAGE`,
`MESSAGE_THREAD`, `BLOG_POST`, `BLOG_COMMENT`, `REVIEW`, `COMMISSION_REQUEST`, `SELLER_PROFILE`.

The admin queue renders context links for six
(`src/app/admin/reports/page.tsx:179-196`): `LISTING`, `SELLER_PROFILE` (+ legacy `SELLER`),
`MESSAGE_THREAD`, `BLOG_POST`, `REVIEW`, `BLOG_COMMENT`.

**`ORDER`, `MESSAGE`, and `COMMISSION_REQUEST`** are accepted, ownership-validated, durably
stored — then surface to staff as an opaque ID with no way to reach the reported content.
(`USER` is the fourth but is fine; the reported user is already linked in the row.)

Related negative worth recording: `grainline_message_report_target_valid:565-586` requires *both*
reporter and reported user to be participants for `MESSAGE` and `MESSAGE_THREAD` alike, so a
non-participant cannot file a thread report to force
`grainline_conversation_staff_report_visible` to expose an arbitrary private thread to staff. The
defect is render-side only.

## #11 — The Stripe-deauthorization hold is a free-text sentinel duplicated six times with nothing binding it

**CONFIRMED.** The hold blocks label purchase and fulfillment when a seller loses Stripe
authorization *after* payment. It is a prefix match on `Order.reviewNote`:

```sql
IF locked_order."reviewNeeded"
   AND COALESCE(locked_order."reviewNote", '') LIKE
     'Seller Stripe account was deauthorized after payment.%' THEN
```

That literal is hardcoded at **five SQL sites** —
`20260901130000_prepare_order_fulfillment_authority:110`,
`20260901140000_prepare_order_label_authority:144`, `:330`, `:446`,
`20260901010000_prepare_order_participant_detail_authority:320` — and a sixth time as the
TypeScript constant in `src/lib/orderReviewHolds.ts:5-6`. **No test binds them**
(`grep -rln DEAUTHORIZED_SELLER_REVIEW_NOTE_PREFIX tests/` returns nothing).

I chased the obvious break first and it is not there. **All three `reviewNote` writers were
verified and every one appends rather than prepends:** `src/lib/ban.ts:250`
(`appendBannedSellerReviewNote`), `src/app/admin/actions.ts:94` (`recordLabelVoided`), and
`appendNote` at `:167-168`. The length cap *refuses* rather than truncating (`:169-170`), so the
prefix cannot be trimmed off the front, and `appendNote` additionally uses
`where: { id: orderId, reviewNote: order.reviewNote }` (`:174`) — a compare-and-swap on the
free-text column, so a concurrent append cannot silently drop one. The convention is consistent
across every writer, which means **the risk here is purely forward-looking**: a future writer that
prepends, or a reword of the constant.

**What makes it a finding is the evidence that it is drift rather than design.**
`src/lib/orderReviewHolds.ts:7` exports:
```ts
export const DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN = `${DEAUTHORIZED_SELLER_REVIEW_NOTE_PREFIX}%`;
```
That constant exists for exactly this purpose and is **used nowhere** — a dead export. Someone
intended the SQL pattern to have one source; the five migrations then hardcoded it by hand.

**Failure scenario.** Any reword of the staff-facing message — a word, capitalization, moving the
period — silently disables all five SQL gates at once. New orders get a note the SQL no longer
matches, and sellers whose Stripe account was deauthorized after payment can buy labels and mark
orders shipped. Nothing fails loudly; the gate just stops firing.

**The asymmetry is the tell.** The *adjacent* hold in the same functions,
`paymentOpenDisputeBlocked`, is a dedicated boolean column — added precisely so it would not
depend on note text. The deauthorization hold, same class, ten lines away, was left on string
matching.

**Also see #21**, where this directly causes harm: the AMBIGUOUS-label review note cannot be
caught by a prefix-matching hold.

## #14 — Four notification types the UI says are "off by default" are delivered to everyone (LIVE)

**CONFIRMED, and live in production.**

The settings page implements a correct two-sided rule
(`src/app/account/settings/page.tsx:16-21`, `:40-43`):
```ts
const DEFAULT_OFF = ["SELLER_BROADCAST","NEW_FAVORITE","NEW_BLOG_COMMENT","BLOG_COMMENT_REPLY","EMAIL_SELLER_BROADCAST"];
function isEnabled(type) {
  if (DEFAULT_OFF.includes(type)) return prefs[type] === true;   // default OFF
  return prefs[type] !== false;                                   // default ON
}
```

The sender implements only one side (`src/lib/notificationDeliveryPreferences.ts:3-9`):
```ts
export function isInAppNotificationEnabled(preferences, type) {
  return normalized[type] !== false;
}
```

`User.notificationPreferences` is `@default("{}")` (`prisma/schema.prisma:124`), and
`normalizeNotificationPreferences` copies only keys physically present — it does not inject
defaults. So until someone touches a toggle there is no key at all, and:

- the settings page renders the toggle **off** (`prefs[type] === true` is false when absent);
- the seller dashboard copy says **"(off by default)"** verbatim
  (`src/app/dashboard/seller/page.tsx:524`, `:528`, `:529`);
- `createNotification` delivers anyway, because `undefined !== false` is `true`.

The user is told a notification is off, sees it off, and receives it. The only way to stop it is
to toggle it **on** then **off**, writing an explicit `false` the sender will finally respect.

**This is live, not prepared.** The same one-sided gate is in the production
`grainline_notification_create_core` at
`prisma/migrations/20260722051500_prepare_notification_rls/migration.sql:729` — and `Notification`
is `RLS_LIVE_FORCE`. All four types are reachable: `favorite` → `create_social_event` (2070),
`seller_broadcast`/`blog_comment` → `create_source_fanout` (2030), both calling `create_core`.

**And it is about to be cemented.** The prepared Order receipt authority reproduces it exactly
(`20260901120000_prepare_order_receipt_notification_authority:191`), so the notification write
path converting to that function moves the defect into the database authority layer where it is a
migration to fix.

The pattern exists in the codebase — `DEFAULT_OFF_EMAIL_KEYS` in
`src/lib/notificationEmailPreferences.ts:6` — it was just never extended to the four in-app keys.
`SELLER_BROADCAST` is the one to weight: makers broadcasting to followers is marketing-adjacent,
and "you were told this was off" is the wrong place to be wrong.

## #15 — Reconciliation claim can be released with no refund lock present

**CONFIRMED.** `grainline_case_staff_resolution_reconcile`,
`prisma/migrations/20260901160000_correct_case_order_invariants/migration.sql:2610-2618`:

```sql
IF locked_claim.status NOT IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED')
   OR locked_order."sellerRefundId" NOT IN ('pending','ambiguous_refund_pending_reconciliation') THEN
  RAISE EXCEPTION 'Case reconciliation claim cannot be released';
END IF;
```

`Order.sellerRefundId` is `String?` (`prisma/schema.prisma:668`) and NULL is its normal resting
state. When NULL: the first disjunct is FALSE, the second NULL, `FALSE OR NULL` is NULL, the
RAISE does not fire, and the function proceeds to release the claim.

The guard exists to prove a refund is in flight before releasing. It fires correctly for a
*wrong* non-null value — a real Stripe refund id yields `NOT IN` → TRUE → raise — and fails open
for the *absent* value. "Claim live but refund lock cleared" is exactly the drift it is meant to
catch: CLAUDE.md documents paths that clear the lock independently (`releaseStaleRefundLocks`,
and terminal dispute events clearing `sellerRefundLockedAt`).

## #18 — A second timezone-coercion variant, live in retention pruning and blog fanout

**CONFIRMED**, and it invalidated a negative result I had previously reported.

I had been sweeping for `clock_timestamp()::timestamp` — an *explicit* cast. The variant here has
no cast token at all: a bare `timestamptz` compared against, or assigned to, a
`timestamp without time zone` column, where PostgreSQL applies the session `TimeZone` in an
**implicit** coercion. Same bug, nothing to grep for. I had reported `naked=0` for the receipt
notification migration; that was true for my pattern and false for the bug class.

Re-running tree-wide with the corrected pattern, and filtering false positives
(`EXTRACT(EPOCH FROM clock_timestamp())` is timezone-independent since epoch is absolute; the
DirectUpload and retire hits are wrapped by `timezone('UTC', …)` two lines up), the real ones are:

**Live, on a FORCE-RLS'd table, in retention pruning** —
`20260722051500_prepare_notification_rls:2739` and `:2769`:
```sql
WHERE notification.read = true
  AND notification."createdAt" < pg_catalog.clock_timestamp() - interval '90 days'
```
`grainline_notification_prune_read_batch()` is defined exactly once, in that migration, never
redefined — so this is the current effective definition. Under a non-UTC session the 90-day and
365-day retention boundaries shift by the offset. Notifications get deleted early or retained
late against a stated retention policy.

**Blog fanout visibility**, replicated across three migrations
(`20260722051500:1725`, `20260825010000:1192`, `20260901120000:1212`):
```sql
AND source_post."publishedAt" <= pg_catalog.clock_timestamp()
```
CLAUDE.md requires `publishedAt <= now` specifically so future-dated posts cannot leak early. A
negative session offset lets a scheduled post fan out to followers before its publish time.

Nothing pins the session TimeZone — a search for `SET TimeZone` / `ALTER ROLE … TIME ZONE` across
`prisma/` and `src/lib/db.ts` finds none, which is exactly why the repo has an explicit-UTC rule
enforced by two existing tests. Across the tree the UTC-qualified form outnumbers the naked form
58 to 32.

## #22 — A DB failure after Stripe accepts a reversal is recorded as a Stripe failure

**CONFIRMED.** `src/app/api/orders/[id]/label/route.ts:352-373` places the success-recording call
*inside* the same `try` as `stripe.transfers.createReversal`, so the catch cannot distinguish
"Stripe rejected the reversal" from "Stripe accepted it and the local write failed." The latter
writes `outcome:'FAILED'`, which at `20260901140000:866-878` sets
`labelClawbackStatus='RETRY_PENDING'`, `reviewNeeded=true`, and a review note asserting
`'Stripe transfer reversal failed'` — **for an accepted reversal** — and schedules another attempt.

CLAUDE.md: *"Once Stripe accepts a label-cost transfer reversal, any local DB recovery path must
preserve the accepted reversal as REVERSED and must not schedule another reversal."*

Money risk is bounded — the retry reuses `labelClawbackIdempotencyKey`, so Stripe returns the
original reversal rather than creating a second one — but the persisted state and the staff note
are both wrong. The correct shape already exists in the sibling:
`src/app/api/orders/[id]/refund/route.ts:270-311` branches on `if (refundId)` precisely to
separate these two cases.

## #23 — Refund amount derivation diverges between the app layer and every SQL authority

**CONFIRMED as an inconsistency; PLAUSIBLE as a live defect.**

App prefers `chargedTotalCents` (`src/lib/refundRouteState.ts:20-33`); every SQL authority sums
components (`20260824010000:239-243`, repeated at `20260824050000:475-479` and `:668-672`).
`20260901150000_prepare_order_charged_total:14` documents `chargedTotalCents` as Stripe's exact
`amount_total`, explicitly *not* rewritten from local sums, and adds **no** constraint tying it to
that sum (only `>= 0`).

When they disagree, `src/app/api/orders/[id]/refund/route.ts:233-243` marks the claim **ambiguous
with no provider call ever made**, and `src/lib/refundLocks.ts:19-22` explicitly refuses to
time-release any lock holding a `refundClaimId`. So a purely local arithmetic disagreement
**permanently bricks that order's seller refund** until an ADMIN immutable reconciliation.

Fails closed rather than over-refunding. Reachability is narrow —
`src/lib/stripeWebhookState.ts:331` (`if (checkoutSubtotalCents == null) return 0`, dropping the
entire product subtotal) or any future Checkout discount/coupon. Legacy orders are safe because
`chargedTotalCents` is NULL and the app falls back to the same component sum.

## #26 — Blocked-checkout refund failure is swallowed and the event marked processed

**CONFIRMED.** `src/app/api/stripe/webhook/route.ts:1267-1282`:
```ts
} catch (refundError) {
  if (refundId || retryBlockedCheckoutRefund) { throw refundError; }
  await prisma.order.update({ …reviewNeeded: true, reviewNote: "…staff must reconcile manually." });
  Sentry.captureException(refundError, {…});
}
```

Any failure *before* Stripe returns a refund id — `releaseStaleRefundLocks`, the order re-read,
the guard-branch updates, `claimBlockedCheckoutOrderRefund`, the conflict `updateMany` — leaves
`refundId` null and `retryBlockedCheckoutRefund` false, so the error is absorbed, the handler
returns `{ok:true}`, and `processIdempotentEvent` marks the Stripe event **processed**. Stripe
never retries. A payment that policy says must be auto-refunded ends as a manual note only.

CLAUDE.md states the opposite requirement verbatim: *"must release the local sentinel, record
bounded review evidence, **and throw** so Stripe retries the checkout webhook instead of leaving
the paid checkout processed with only manual reconciliation."*

`retryBlockedCheckoutRefund` is set true only at `:1238`, inside the inner `else` (provider threw
with no refund id), and that branch already rethrows at `:1259` — it does not cover pre-claim
failures. `bindBlockedCheckoutTransfer` (`:1084-1091`) is *outside* the try, so its failures do
correctly propagate. The `existingBlockedCheckoutRetry` recovery cannot help because there is no
later delivery — the event was marked processed, and card-only checkout produces no
`async_payment_succeeded` follow-up.

## #27 — `OrderItem.listingSnapshot` retains a deleted maker's identity permanently

**CONFIRMED.** `grep -n "orderItem" src/lib/accountDeletion.ts` returns **nothing** — no write
path touches it. Yet the snapshot written at checkout
(`src/app/api/stripe/webhook/route.ts:1692-1701`) stores `sellerName`, the listing title and full
description, and R2 `imageUrls` embedding the maker's Clerk upload segment.

After deletion, `SellerProfile.displayName` becomes "Deleted maker"
(`accountDeletion.ts:1555`) and listing text becomes placeholders (`:1497-1500`) — but every past
buyer's order row still carries the real name, and it is re-served: `src/lib/orderItemSnapshot.ts`
parses `sellerName` back and only falls back to "Maker" when absent or blank (`:209`, `:237-238`).
It also flows into buyer account exports (`src/lib/orderParticipantExportState.ts`).

**The tell that this is an oversight**: `displayName` is already in this file's own redaction
needle set (`accountDeletion.ts:1236`), directly above the three profile media URLs
(`:1246-1248`). The code classifies display name as a value that must be scrubbed from other
rows' free text — the JSON copy was simply missed. `imageUrls` likewise embeds `clerkId`, which is
also a needle (`:1224`); the R2 objects are deleted, so those persist as dangling identifiers.

## #28 — Deletion blockers are checked once, before Clerk deletion, never re-checked in the transaction

**CONFIRMED code path; PLAUSIBLE exploitability.** `getAccountDeletionBlockers` has three call
sites — the import, `src/app/api/account/delete/route.ts:83`, and the Clerk-webhook path at
`accountDeletion.ts:1756`. The anonymization transaction (`withDbUserContext` at `:1159`) never
re-runs it.

The window is not theoretical — the code *detects* the racing payment and deliberately ignores
it (`accountDeletion.ts:924-926`):
```ts
const action = checkoutStockReservationRepairAction(session);
if (action === "skip_paid_or_complete") { outcome = "PAID_OR_COMPLETE";
```
That branch is **silent**, unlike `skip_unrecognized` which Sentry-warns at `:929`.

**Failure scenario.** A buyer's Stripe Checkout session is already paid but
`checkout.session.completed` has not landed. Deletion passes the blocker check, deletes the Clerk
user, and the cleanup sees the paid session and skips it silently. The webhook then creates a
`PENDING` order with a live `buyerId` and full shipping snapshot; the transaction at `:1316-1347`
nulls `shipToLine1/City/State/PostalCode`, `buyerName`, `quotedTo*` and stamps
`buyerDataPurgedAt`. **The seller now has a paid order they cannot ship.**

The `SELECT … FOR UPDATE` on `User` at `:1166-1171` serializes against message sends but does not
detect a committed `Order`. The Case redaction SQL *does* re-check its own precondition
(`20260901160000:2948-2965`, `active_case_count > 0` → raise); no equivalent exists for orders.

## #30 — An undone admin removal still costs the seller their Guild badge 30 days later

**CONFIRMED.** Six code paths call `syncGuildMemberListingThreshold` when a listing's public state
changes — including **both** admin listing routes
(`src/app/api/admin/listings/[id]/route.ts`, `.../review/route.ts` ×2), plus
`seller/[id]/shop/actions.ts`, `dashboard/page.tsx`, `dashboard/listings/new/page.tsx`, and
`api/listings/[id]/stock/route.ts`.

`src/lib/audit.ts` — the undo path — calls it **zero** times.

The helper stamps `listingsBelowThresholdSince` when a seller drops under five active public
listings:
```sql
SET "listingsBelowThresholdSince" = CASE
  WHEN (SELECT COUNT(*) FROM "Listing" l
         WHERE l."sellerId" = sp.id AND l.status = 'ACTIVE' AND l."isPrivate" = false) < 5
  THEN COALESCE(sp."listingsBelowThresholdSince", NOW()) ELSE NULL END
```

**Sequence.** Admin removes a listing → threshold syncs, seller drops to four,
`listingsBelowThresholdSince` stamped. Admin undoes the removal within the 24-hour window → the
listing is correctly restored to ACTIVE, but the timestamp is never cleared. Thirty days later
the daily `guild-member-check` cron sees `listingsBelowThresholdSince < 30 days ago` and revokes
Guild Member — for a seller who has had five active listings the whole time.

**The cost compounds.** Revocation stamps `MakerVerification.status = REJECTED`, triggering the
30-day reapplication cooldown. The seller loses a buyer-facing trust badge, loses homepage
spotlight eligibility, and cannot reapply for a month — all traceable to an admin action that was
*undone*. Nothing in the revocation path would reveal the cause.

## #32 — Replaying a valid verification token on an already-claimed upload deletes the live object

**CONFIRMED.** `src/app/api/upload/verify/route.ts:211-217`:
```ts
const lifecycleUpdated = await markDirectUploadVerified({ key, endpoint, userId: me.id });
if (!lifecycleUpdated) {
  await deleteObject(key).catch(…)   // deletes the R2 object
```
The backing SQL excludes `CLAIMED`
(`20260726185000_prepare_direct_upload_authority/migration.sql:571`):
```sql
AND upload.status IN ('PRESIGNED', 'VERIFIED');
```

Once a file is attached to a message or listing — status `CLAIMED` — a replayed verify matches
zero rows, returns `false`, and the route interprets "lifecycle row missing" as "orphaned object,
clean it up." It deletes media a delivered `Message` still points at.

The token permits it: no nonce or consumption state, 5-minute TTL, and both the ownership check
and the HMAC re-pass on replay. Rate limits (30/10min, 50/60min) do not come close to blocking it.

**It is not self-healing, and the ledger ends up lying.** On claim, `cleanupAfter` was set to
`NULL` (`:684`), and `grainline_direct_upload_cleanup_lease` only selects
`PRESIGNED/VERIFIED/DELETING/DELETE_FAILED` with `cleanupAfter <= now` (`:989-995`). So the row
stays `CLAIMED` — asserting the object exists — while the object is gone. Nothing reconciles it.
That breaks the core invariant the whole lifecycle ledger exists to maintain.

**Damage lands on the counterparty.** The uploader deletes their own object; what breaks is the
recipient's message attachment or the buyer-facing listing photo.

An ordinary double-submit is safe (both land while the row is still `VERIFIED`, which matches the
filter). The dangerous sequence is verify → claim → verify again, easy to do deliberately and
reachable from any client that caches and replays the verify call after attaching.

## #34 — A reopened case becomes permanently un-escalatable

**CONFIRMED.** `escalateUnlocksAt` is written in exactly **two** places in the entire migration
tree, and both are the same branch — the seller's first reply to an `OPEN` case
(`20260801175000_retire_direct_upload_compatibility_key/migration.sql:557-566`, and its
predecessor `20260729052000:344`):
```sql
IF locked_case.status = 'OPEN' AND locked_actor.id = locked_case."sellerId" THEN
  UPDATE public."Case"
     SET status = 'IN_DISCUSSION',
         "discussionStartedAt" = transition_at,
         "escalateUnlocksAt" = transition_at + INTERVAL '48 hours', …
```

The reopen branch immediately below clears both resolution marks but never sets the timer
(`:567-575`):
```sql
ELSIF locked_case.status = 'PENDING_CLOSE' AND actor_is_party THEN
  UPDATE public."Case"
     SET status = 'IN_DISCUSSION',
         "buyerMarkedResolved" = false, "sellerMarkedResolved" = false,
         "updatedAt" = transition_at
   WHERE id = locked_case.id;
```

And `mark_resolved` accepts `OPEN`
(`20260729050000_prepare_case_participant_resolution_authority/migration.sql:244-248`) — so a
case can reach `PENDING_CLOSE` before the seller has ever replied, meaning the timer was never set.

**Sequence.** Buyer opens a case → either party marks resolved → `PENDING_CLOSE` → the other
party replies → `IN_DISCUSSION` with `escalateUnlocksAt` still NULL. The escalate guard then does
exactly what it should — treats NULL as "not unlocked"
(`20260729060000_prepare_case_escalation_cron_authority/migration.sql:311-315`) — and raises
`55000` forever. **Neither party can ever escalate that dispute to staff.**

The failure is silent: `caseEscalationAvailable` (`src/lib/caseActionState.ts:12-22`) returns
false on a falsy timer, so the UI hides the button with no explanation.

**Escape hatches checked.** Staff can still escalate (the timer is bypassed for staff). The
`STALE_DISCUSSION` cron fires after 30 idle days — but any further message fires
`grainline_case_message_maintain_thread` (`20260730010000:710-728`) which bumps
`Case.updatedAt`, resetting that cutoff (`20260729060000:509`, `:582`). So an *actively
discussed* dispute stays stuck indefinitely; only going silent for a month frees it. That is
backwards: the more the buyer engages, the longer they are locked out of escalation.

## #38 — The Stripe webhook's direct-send path bypasses both email quota counters

**CONFIRMED.** The only two callers of the quota reservation helpers are inside
`processEmailOutboxJob` (`src/lib/emailOutbox.ts:266`, `:301`). The webhook fast path claims the
row itself (`src/app/api/stripe/webhook/route.ts:769-785`) and calls `sendRenderedEmail` directly
at `:782` with **no reservation**.

Every order-confirmed-buyer, order-confirmed-seller, and first-sale email that succeeds on the
fast path is therefore invisible to the global 3,000/day cap and the per-recipient 20/day cap. On
a high-volume day the global counter reads near zero, so the protection guarding sender
reputation never engages — and a runaway fanout later that day still gets the full 3,000 on top.

It is an inconsistency rather than a design choice: the five other fast-path callers
(`orderFulfillmentFinalization.ts:108`, `orderRefundFinalization.ts:84`/`:165`,
`orderLabelFinalization.ts:57`, `caseStaffResolutionFinalization.ts:103`) all route through
`processEmailOutboxJobById` → `processEmailOutboxJob` and do reserve.

## #39 — Email quota is never refunded when a send fails

**CONFIRMED.** `rollbackRecipientDailySendAllowance` is invoked at exactly one site —
`src/lib/emailOutbox.ts:303`, the global-cap deferral path — and no global rollback helper exists
in `src/lib/emailOutboxQuota.ts` at all. The provider-failure catch (`:337-360`) writes failure
state and returns without refunding either counter.

A permanently-undeliverable job (a Resend 4xx on a bad domain, which `isRetryableEmailSendError`
correctly does not retry) still retries up to `EMAIL_OUTBOX_MAX_ATTEMPTS = 10`, burning **10 of
that recipient's 20 daily slots**. Two such jobs exhaust the allowance, and every legitimate order
receipt for that person is deferred to the next UTC midnight.

The contrast makes it an oversight: the *deferral* path correctly does
`attempts: { decrement: 1 }` (`src/lib/emailOutboxState.ts:72`) so caps do not burn the retry
budget, while the *failure* path has neither a decrement nor a quota refund.

## #40 — ops-health structurally cannot see a stuck `PROCESSING` email row

**CONFIRMED.** `src/app/api/cron/ops-health/route.ts:86-91`:
```ts
prisma.emailOutbox.count({
  where: { status: { in: ["PENDING", "PROCESSING"] },
           nextAttemptAt: { lt: staleEmailBefore } },
})
```
Every claim path sets `nextAttemptAt: null` — `src/lib/emailOutbox.ts:232` and
`src/app/api/stripe/webhook/route.ts:774`. A Prisma `{ lt: date }` filter on a nullable column
does not match `NULL`. So a row left `PROCESSING` by a killed worker is **never counted** —
precisely the class of stuck row this metric exists to detect.

If the drain cron stops running (dropped schedule, repeated 500s), rows pile up in `PROCESSING`
with `nextAttemptAt = null`, the stale counter stays 0, and ops-health returns 200 while order
receipts stop being delivered. The 10-minute self-heal reclaim only helps if the drain runs — the
exact condition this alert covers. `FAILED` is also absent from the status filter, so an overdue
`FAILED` row is invisible too.

## #41 — ops-health's partial-issue recognizer misses three real result shapes

**CONFIRMED.** `src/lib/cronRunPartialIssues.ts:1-2`:
```ts
export const CRON_RUN_PARTIAL_ISSUE_KEYS = ["failures", "errors"];
export const CRON_RUN_PARTIAL_ISSUE_NUMERIC_KEYS = ["failed", "manualReview", "partialIssueCount"];
```

Unrecognized shapes actually produced: `capped` (`emailOutbox.ts:410`); five `*Complete: false`
booleans from `notification-prune` (`route.ts:49-59`); and `staleRefundLocksReleaseFailed`
(`:53`, set true at `:78`).

**The consequence lands on retention.** `pruneEmailOutboxRetention` returns `{ complete: false }`
when it hits its time budget (`src/lib/emailOutboxRetention.ts:46`). `EmailOutbox.html` holds
full rendered email bodies up to 200,000 chars. So the 30-day retention promise can silently stop
being met — full email bodies accumulating indefinitely — and nothing alerts, because ops-health
reads only those five keys.

## #42 — Eight Conversation/Message RPCs silently switch `app.user_id`

**CONFIRMED.** Every `SECURITY INVOKER` RPC in
`20260726022500_prepare_conversation_message_authority/migration.sql` (`:225-228`, and identically
at `:284-287`, `:354-357`, `:441-444`, `:504-507`, `:544-547`, `:611-614`, `:702-705`) does:
```sql
IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
  RAISE EXCEPTION 'conversation actor context was not set' USING ERRCODE = '55000';
END IF;
```

SavedSearch does the same *plus* a refusal
(`20260717024500_add_saved_search_owner_rpcs/migration.sql:21`, `:38-43`):
```sql
prior_user_id text := pg_catalog.current_setting('app.user_id', true);
…
IF prior_user_id IS NOT NULL AND prior_user_id <> '' AND prior_user_id <> p_user_id THEN
  RAISE EXCEPTION 'refusing to switch SavedSearch user context' USING ERRCODE = '42501';
```

`grep -c "prior_user_id"` over the Conversation migration returns **0**, and
`grep -rln "refusing to switch" prisma/migrations/` returns **only the two SavedSearch
migrations**. CLAUDE.md states the invariant generally; only SavedSearch enforces it.

**Failure scenario.** Call any of the eight with `db = tx` inside a
`withDbUserContext(userA, …)` transaction and `p_user_id = userB`, and the GUC is silently
re-pointed to userB **for the remainder of that transaction** — so every subsequent RLS-mediated
read on that connection (SavedSearch, Notification, Conversation, Message) evaluates as userB.
All eight accept an arbitrary client parameter (`src/lib/conversationMessageAuthority.ts:417`,
`:463`, `:520`, `:567`, `:715`, `:729`, `:796`, `:822`).

Not currently reachable: the one path that crosses a context transaction
(`accountDeletion.ts:1291` and `:1255`) passes the same id as the enclosing context. It is a
latent privilege-confusion primitive that an unrelated refactor would arm — and the guard that
prevents it already exists twenty lines away in a sibling migration.

## #45 — Commission interest creation revalidates existence only, not state

**CONFIRMED.** `grainline_message_create_commission_interest` is reached through a helper
documented as *"Co-commits commission interest, its canonical Conversation, and its opening
Message after revalidating **every relationship** at the write boundary"*
(`src/lib/commissionInterestMessageAccess.ts:27-29`). The actual revalidation
(`20260726022500:1707-1713`):
```sql
SELECT commission."buyerId" INTO initial_buyer_id
  FROM public."CommissionRequest" AS commission
 WHERE commission.id = p_commission_request_id;
IF NOT FOUND THEN
  RAISE EXCEPTION 'commission request is unavailable' USING ERRCODE = '42501';
END IF;
```

Existence only. No `status = 'OPEN'`, no `expiresAt`, no `buyer.banned`/`deletedAt`, and no
`FOR UPDATE` — the commission row is not even locked.

The entire state gate lives in the route's pre-check
(`src/app/api/commission/[id]/interest/route.ts:102`), reading from a non-locking `findUnique` at
`:79`. A plain read-then-write gap.

CLAUDE.md: *"Commission close/fulfill **and interest creation** must use
`openCommissionMutationWhere()` inside the write predicate so terminal, expired, or
inactive-buyer requests cannot be mutated after a stale read."* `openCommissionMutationWhere`
appears in exactly one file — the PATCH route — and the interest path never uses it.

The sibling gets it right (`src/app/api/commission/[id]/route.ts:175-181`):
```ts
const result = await prisma.commissionRequest.updateMany({
  where: openCommissionMutationWhere(id, new Date(), { buyerId: me.id }),
  data: { status },
});
if (result.count === 0) return 409 "Commission request is no longer open";
```

**Failure scenario.** A commission is closed, fulfilled, or expired (the expiry cron runs on a
schedule) between the route's read and the SQL write. The interest is created anyway — a
`CommissionInterest` row on a terminal request, a `commission_interest_card` message in a fresh
conversation, a `COMMISSION_INTEREST` notification to a buyer who already closed the request, and
`interestedCount` incremented on it. `openCommissionBaseWhere` also includes
`buyer: { banned: false, deletedAt: null }`, which the SQL omits, so a seller can open a
conversation against a buyer banned or deleted in that window. I checked whether
`lock_pair_core` compensates — it locks both `User` rows `FOR SHARE`, requires `ROW_COUNT = 2`,
and does the reciprocal `Block` check, but I did not find an account-state check there, so I am
not claiming that half is covered either way.

## #46 — `/api/blog/search` returns viewer-varying results with no private cache headers

**CONFIRMED.** The handler resolves the viewer (`auth()` at `:57`), computes reciprocal block sets
(`getBlockedIdsFor` at `:69`), and applies them to both the raw ranked SQL (`:84-89`, `:113-114`)
and the Prisma paths (`:145`, `:174`). The body varies by Clerk cookie. All three exits
(`:136`, `:159`, `:189`) use bare `NextResponse.json` — no `Cache-Control: private, no-store`, no
`Vary: Cookie`.

A shared or proxy cache keyed on URL alone can serve one viewer's block-filtered results to
another. A blocks maker M, searches `?bq=walnut`, a downstream cache stores a response missing
M's post, and B — who has not blocked M — never sees it.

**What makes this more than an isolated miss is how thoroughly it fell through every net.**
- The **sibling** `blog/search/suggestions` route uses the private helpers four times, for an
  identical viewer-varying shape.
- The **guardrail test** `tests/private-json-cache-headers.test.mjs` asserts on
  `src/app/api/search/suggestions/route.ts` (`:88`) and
  `src/app/api/blog/search/suggestions/route.ts` (`:337`) — and **not** on `blog/search/route.ts`.
- **CLAUDE.md's rule enumerates instances** rather than stating the property: *"blog suggestions,
  blog comments, and commission list/detail APIs are auth-varying and must return through private
  response helpers."* `blog/search` is not in that list.

The docs enumerate, the test mirrors the enumeration, and the one endpoint outside it is
unguarded. **The durable fix is not the one-line change** — it is making the test assert the
property ("any handler that calls `getBlockedIdsFor` must return through `privateJson`") instead
of naming files.

Severity Medium rather than High because Next's default dynamic behavior for a handler calling
`auth()` bounds exposure to CDN/proxy layers rather than Next's own cache.

Related LOW in the same file: `:136` returns the unclamped `page` while `:159`/`:189` return
`clampedPage`, so an out-of-range `page` on a zero-result relevance search echoes back an
out-of-range value.

## #48 — Images can be silently dropped from AI review, and the listing auto-approves on text alone

**CONFIRMED.** `src/lib/aiReviewSafety.ts:25` filters with no signal:
```ts
return (urls ?? []).filter((url) => isAllowedUrl(url)).slice(0, 10);
```
called as `filterAIReviewImageUrls(listing.imageUrls, isR2PublicUrl)` (`src/lib/ai-review.ts:173`).

If every stored photo URL fails `isR2PublicUrl` — legacy `utfs.io` rows, a CDN-domain migration,
or `CLOUDFLARE_R2_PUBLIC_URL` absent at module init, since `configuredPublicUrls` is computed once
at load (`src/lib/urlValidation.ts:1-19`) — the model is asked to moderate **text only** and can
legitimately return `approved:true, flags:[], confidence:0.95`. That satisfies the auto-approve
gate exactly, and the listing goes ACTIVE with its photos never examined. The entire IMAGE REVIEW
section of the system prompt (`ai-review.ts:203-236`, including *"REJECT if the listing has only
ONE image and that image does not clearly show the described product"*) becomes unreachable, with
no flag and no log.

Nothing downstream notices: no caller compares `imagesToReview.length` against the submitted photo
count, and `normalizeAIReviewResult` pads `altTexts` to the *filtered* length
(`aiReviewResultState.ts:39-41`), so a zero-image review looks well-formed.

Exposure is on `publishListingAction` (`shop/actions.ts:271-276`) and `updateListing`
(`edit/page.tsx:486-491`), which read URLs straight from `Photo` with no re-verification.
`createListing` is safer because its URLs were verified at submission (`new/page.tsx:88-94`).

**The asymmetry that makes it a defect**: the missing-API-key path *is* explicitly fail-closed
(`ai-review.ts:115-130`). Dropped images are not. The moderation boundary fails closed on
provider absence and fails open on input absence.

## #49 — `updateListing` is the only publish path with no compare-and-swap

**CONFIRMED.** `src/app/dashboard/listings/[id]/edit/page.tsx:365-366`:
```ts
const updated = await tx.listing.update({
  where: { id: listingId },
  data: { …, ...(needsPublicContentReview ? { status: ListingStatus.PENDING_REVIEW } : {}) },
```
Bare id. No `status`, no `updatedAt`, no `sellerId`, no `rejectionReason`. Both
`needsPublicContentReview` (`:352-354`) and `approvedPublicStatus` (`:355-360`) are computed from
the read at `:288-298`.

`publishListingAction` by contrast (`src/app/seller/[id]/shop/actions.ts:344-352`):
```ts
where: { id: listingId, sellerId: listing.sellerId, status: listing.status,
         updatedAt: listing.updatedAt,
         ...(IN_STOCK ? { stockQuantity: { gt: 0 } } : {}),
         OR: [{ rejectionReason: null }, { rejectionReason: { not: STAFF_REMOVAL_REJECTION_REASON } }] }
```
A six-way fence including an explicit staff-removal guard. `createCustomListing` (`:239`, `:252`)
and admin approve (`review/route.ts:139-147`) also fence correctly.

**Failure scenario.** Seller submits Save while the listing is ACTIVE. Before the transaction
lands, staff removes it (`api/admin/listings/[id]/route.ts:46-53` → `REJECTED` +
`isPrivate:true` + `rejectionReason`), or the seller archives it in another tab. The transaction
unconditionally overwrites status to `PENDING_REVIEW`, and the AI-approved branch (`:533-534`)
then restores ACTIVE.

**Severity bounded, and I verified the bound.** Both staff removal and archive set
`isPrivate: true`, and `publicListingWhere` requires `isPrivate: false`
(`src/lib/listingVisibility.ts:24`). I grepped every `isPrivate: false` occurrence in `src/` —
**every hit is a `where:` predicate, none is a `data:` write** — so `isPrivate` is a genuine
one-way door. Impact is moderation-state corruption (the listing re-enters the review queue and
reads ACTIVE on seller-facing surfaces), not public resurrection.

`listingEditBlockReason` (`src/lib/listingEditState.ts:11-32`) does reject staff-removed and
archived listings, but only against the stale read at `:300`. The `updatedAt` fences at `:521`
and `:534` use `updatedListing.updatedAt` from this action's *own* transaction, so they fence
concurrent *sellers*, not the admin write that already happened.

## #51 — Every table's activation proof counts only its own function family, but cross-family access is pervasive and intended

**CONFIRMED. This is the generalized form of #6 and #8, and the highest-leverage item in the
report.**

I generalized the DirectUpload convergence gap across the RLS-live tables:

| protected table | functions touching it from *other* families |
|---|---|
| **StripeWebhookEvent** | 11 — blocked-checkout family (`_claim`, `_claim_resume`, `_record`, `_record_core`, `_reconciliation_record`), `blocked_checkout_transfer_bind`, `order_payment_signed_refund_apply`, `..._dispute_apply`, `seller_payout_event_apply`, `checkout_reservation_complete`, `..._webhook_restore` |
| **CaseMessageAttachment** | `grainline_direct_upload_case_attachment_read`, `..._reference_case_attachment` |
| **OrderRefundReconciliation** | `grainline_case_seller_refund_apply`, `grainline_seller_refund_record` |
| **SellerPayoutEvent** | `grainline_notification_create_core` |
| **DirectUpload** | `grainline_case_reply` (#6) |

**Every one of these is legitimate by design.** The signed refund/dispute authorities,
blocked-checkout family, payout apply, and reservation complete all *must* read
`StripeWebhookEvent` to validate the lease — `sourceObjectId`, `claimGeneration`, `processedAt`.
CLAUDE.md documents exactly that. The notification core reads `SellerPayoutEvent` to build
payout-failure content. None of this is unauthorized access.

**The defect is that the proof mechanism was written as a point-in-time count of one naming
family, and the architecture deliberately outgrew it.**

### This substantially upgrades #8

I originally reported #8 as a single vestigial grant on a superseded 2-arg `begin` overload. The
real picture: `StripeWebhookEvent`'s FORCE preflight
(`20260810172000_force_stripe_webhook_event_rls/migration.sql:301-318`) asserts
```sql
AND has_function_privilege('grainline_app_runtime', procedure.oid, 'EXECUTE')
AND strpos(procedure.prosrc, '"StripeWebhookEvent"') > 0;
IF table_function_count <> 6 THEN
  RAISE EXCEPTION 'StripeWebhookEvent FORCE runtime function surface drifted: %'
```

I verified **five** of the eleven post-FORCE additions are runtime-granted
(`blocked_checkout_refund_claim_resume`, `order_payment_signed_refund_apply`,
`seller_payout_event_apply`, `checkout_reservation_complete`, `blocked_checkout_transfer_bind`).
So the surface has roughly doubled past the asserted 6, and the guard Codex wrote specifically to
catch this — with the error string *"runtime function surface drifted"* — has been silently
violated for weeks. It cannot fire because it is a one-shot migration that already ran, and it
still passes on a fresh database only because migrations replay in filename order and it runs
before the additions exist.

### Why this is the highest-leverage item

Every table's activation migration ends with the same claim: *these N exactly-pinned functions are
the complete authority surface.* That claim is true at the moment it runs and untested forever
after. `DirectUpload` pins 35 bodies by `md5(prosrc)`; `StripeWebhookEvent` pins 6; neither can
see a function added tomorrow by another family.

**The fix is one CI job, not one migration**: re-run every table's surface assertion against the
live catalog on each build. That converts ~14 historical claims into standing invariants and
would have caught #6, #8, and this.

## #52 — Signing in silently and permanently destroys saved cart lines

**CONFIRMED.** `src/lib/anonymousCartMerge.ts:18-22` classifies retryability by HTTP status alone:
```ts
if (status == null) return true;
if (status === 401 || status === 408 || status === 409 || status === 425 || status === 429) return true;
return status >= 500 && status <= 599;
```

But `/api/cart/add` returns **400 for transient conditions** — `CartAddError` defaults to
`BAD_REQUEST` (`src/app/api/cart/add/route.ts:48`), and three of its throw sites are temporary:
- `:175` `Only ${stockQuantity} available.` — restock is routine; the entire back-in-stock
  notification feature exists because of it
- `:179` `Your cart can hold up to 50 different items.`
- `:184` `Your cart can hold up to 200 total items.`
- (`:111` `This listing is not available.` also covers temporarily-HIDDEN and PENDING_REVIEW
  listings, which can return to ACTIVE within minutes)

A 400 is classified terminal, so the line is **not** pushed to `remainingItems`
(`anonymousCartMerge.ts:67-75`), and `src/app/cart/page.tsx:233-236` then overwrites localStorage
with only the retryable remainder. The line is gone, with no server-side copy anywhere —
`writeAnonymousCartItems` (`src/lib/anonymousCart.ts:136-147`) unconditionally replaces the stored
array rather than merging.

**The limits guarantee it.** `MAX_ANONYMOUS_CART_LINES = 100` in the browser
(`anonymousCart.ts:37`); `MAX_CART_DISTINCT_ITEMS = 50` on the server (`add/route.ts:36`). An
anonymous shopper who saves 60 lines and signs in **will** lose lines 51–60 every time — the
mismatch makes this a designed-in outcome, not an edge case.

The user sees at most three deduplicated error strings (`anonymousCartMerge.ts:34` `.slice(0, 3)`,
surfaced at `cart/page.tsx:413`) with no count and no list of what vanished — and if any line also
failed retryably, only `errors[0]` is shown, so the deletions produce no message at all.

## #53 — Cart merge retry is not idempotent, so a dropped response doubles quantity

**CONFIRMED.** `src/lib/anonymousCartMerge.ts:54-58` treats a rejected `fetch` as retryable and
retains the item. But a rejected fetch — connection reset, mobile network drop, tab closed
mid-flight — is indistinguishable from "server committed, response lost." And add is an
**increment**, not a set (`src/lib/cartOwnerAccess.ts:157-160`):
```ts
data: { ...data, quantity: { increment: quantity } }
```
The merge body carries only `listingId`, `quantity`, `selectedVariantOptionIds`
(`src/app/cart/page.tsx:218-224`) — no idempotency key.

A buyer who signs in on a flaky connection can end up with 2× the quantity they saved, silently.
Same for any 5xx raised after the transaction committed. `addOrIncrement`
(`add/route.ts:161-243`) commits before the response is serialized at `:275`, and there is no
request-scoped dedup token anywhere in `cartOwnerAccess.ts`; the `lineKey`/`variantKey` uniqueness
collapses rows, not repeated increments.

## #55 — A maker whose Guild badge is revoked for cause keeps the homepage spotlight

**CONFIRMED.** There are exactly **three** writes to `featuredUntil` in the entire codebase:
`featureMaker` sets it seven days out (`src/app/admin/verification/page.tsx:893`),
`unfeatureMaker` clears it (`:919`), and account deletion clears it
(`src/lib/accountDeletion.ts:1623`). **No revocation path touches it** — neither `revokeMember`
(`:435-445`) nor `revokeMaster` (`:718-729`).

And the homepage Tier-1 read has no Guild filter (`src/app/page.tsx:98`):
```ts
where: activeSellerProfileWhere({ featuredUntil: { gt: now } }),
```
`activeSellerProfileWhere` contains **zero** references to `guildLevel` (`grep -c` returns 0). It
covers banned, deleted, vacation, `chargesEnabled`, and `stripeAccountVersion` — not Guild status.

**Failure scenario.** An admin features a Guild Master, then revokes the badge an hour later for
an unresolved 90-day dispute or two consecutive metric failures. The seller loses the badge and
keeps the "Maker of the Week" homepage spotlight for the remaining week. The platform's most
prominent editorial placement keeps promoting a maker whose trust status was just revoked, for
exactly the reasons a buyer would want to know about.

`featureMaker` gates on `guildLevel IN (GUILD_MEMBER, GUILD_MASTER)` at *feature* time
(`:881-886`). There is no ongoing check. Tiers 2 and 3 both filter by `guildLevel` correctly —
Tier 1 is the gap.

**Compounds with #56**, which is the five-minute half of the same problem.

---

## #61 — `items_valid` never rejects duplicate `listingId` entries, which `restore_items` then sums

**CONFIRMED gap; no current exploit.** `restore_items` aggregates before restoring
(`migration.sql:649-651`):
```sql
pg_catalog.sum((item.value->>'quantity')::integer)::integer AS quantity
  FROM pg_catalog.jsonb_array_elements(p_reserved_items) AS item(value)
 GROUP BY item.value->>'listingId'
```
so a `reservedItems` array containing the same `listingId` twice restores the **summed** quantity,
while the creation path only ever decremented once.

`grainline_checkout_reservation_items_valid` (`:473-522`) validates element shape, quantity range,
and `sellerId` binding — but never uniqueness.

**Not currently reachable**: every writer de-duplicates — `create_cart:795-810`,
`create_single:952-956`, and the live successor `create_cart_consistent`
(`20260814053000:294-310`, `GROUP BY listing.id`); `account_scrub:1866-1874` re-aggregates but
preserves an already-unique set; and `20260815060000:532-533` revoked all table CRUD from the
runtime, so no direct write can inject duplicates.

The defect is that the trigger — now the **sole** DB-level invariant under FORCE RLS — does not
enforce the uniqueness `restore_items` silently depends on. `items_valid` is where that check
belongs.

## #62 — `restore_items` has no NULL-stock guard, so units can silently vanish

**PLAUSIBLE.** `migration.sql:654-657`:
```sql
UPDATE public."Listing" AS listing
   SET "stockQuantity" = listing."stockQuantity" + source_item.quantity
 WHERE listing.id = source_item.listing_id
   AND listing."listingType" = 'IN_STOCK';
```
`Listing.stockQuantity` is `Int?`. For a NULL-stock `IN_STOCK` listing, `NULL + q = NULL` — but the
row still **matches**, so `ROW_COUNT = 1`, the `<> 1` check at `:658-661` passes, and the
reservation is stamped `RESTORED` with restore evidence while the units silently vanish. The
follow-up visibility update (`:663-668`) tests `stockQuantity > 0` → NULL → the listing stays
`SOLD_OUT` permanently.

**The asymmetry is the bug**: the decrement side *is* protected — `create_cart:843` and
`create_single:990` both carry `AND listing."stockQuantity" >= …`, a `WHERE` filter where NULL fails
closed.

Rated PLAUSIBLE because no current app path produces `IN_STOCK` + NULL stock:
`dashboard/listings/[id]/edit/page.tsx:217-218` writes NULL only when `listingType` becomes
`MADE_TO_ORDER` and rejects `IN_STOCK` + NULL at `:270`; `api/listings/[id]/stock/route.ts:118-124`
always writes a non-null integer. But `Listing` carries no RLS, no trigger, and no revoked grant —
`stockQuantity` integrity is entirely app-enforced. The same missing guard exists in the TypeScript
fallback partner, `src/lib/checkoutStockRestore.ts:125-130`, which additionally never inspects row
count at all.


---

# LOW-MEDIUM

## #8 — Vestigial runtime grant on the superseded lease acquirer

**CONFIRMED.** See #51, which upgrades this considerably.

`20260805012000_prepare_order_payment_shipping_compatibility/migration.sql:517-525` creates
`grainline_stripe_webhook_begin(text, text)` and grants EXECUTE to `grainline_app_runtime`.
`20260810190000:424-463` then adds the 3-arg overload that atomically pairs lease acquisition with
immutable `sourceObjectId` binding, with the comment:

> *"The runtime calls one statement so lease acquisition and immutable source binding cannot
> partially commit."*

The 2-arg version was **never revoked**. Both overloads are runtime-executable, so the runtime can
still acquire a lease without binding the source object — exactly the split the comment says is
prevented.

**Not exploitable.** All seven downstream consumers use `IS DISTINCT FROM`
(`20260815210000:108`, `20260824030000:134`/`:456`, `20260824010000:346`, `20260824020000:55`,
`20260826010000:60`, `20260828010000:121`, `20260828020000:92`), and
`NULL IS DISTINCT FROM 'ch_x'` is TRUE, so an unbound lease is rejected by all of them. It fails
closed. The cost is a consumed claim generation and a two-minute stuck `in_progress`.

Fix is one line: `REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_begin(text, text) FROM
grainline_app_runtime;` — the 3-arg wrapper is SECURITY DEFINER and does not need it.

**Bounded class**: a tree-wide sweep for functions created twice with `CREATE FUNCTION` (rather
than `CREATE OR REPLACE`) returns **only** `grainline_stripe_webhook_begin`. This specific
overload-drift class does not repeat.

## #19 — `dedupScope` is accepted at 12+ call sites and silently discarded

**CONFIRMED.** The dedup key is built at
`20260722051500_prepare_notification_rls/migration.sql:1952-1962` from
`'grainline-notification-v1' | userId | type | sourceType | sourceId | relatedUserId`. **No
UTC-day bucket, no `link`, no `dedupScope`.**

App-side, `createNotificationServiceRow` forwards six fields (`src/lib/notifications.ts:91-97`)
and `dedupScope` is not among them — it reaches only `Sentry.captureException`'s `extra` on the
error path (`:103`).

12+ call sites pass it: all nine Guild verification transitions
(`src/app/admin/verification/page.tsx:300`, `:377`, `:468`, `:603`, `:680`, `:752`, `:866`),
blog comment approval (`src/app/admin/blog/page.tsx:78`, `:93`), seller broadcast
(`src/app/api/seller/broadcast/route.ts:306`), commission interest
(`src/app/api/commission/[id]/interest/route.ts:166`), follow
(`src/app/api/follow/[sellerId]/route.ts:191`).

CLAUDE.md documents it as functional and names its purpose: *"Approved comment notifications link
to `#comment-{commentId}` and pass `dedupScope: commentId` so multiple approved comments on the
same post in the same day do not collide on the notification dedup key."*

**I downgraded this after checking that exact case.** At `admin/blog/page.tsx:78-81` it passes
`dedupScope: commentId` **and** `sourceId: commentId` — the `sourceId` already carries the
discriminator, so there is no live suppression. The same coincidence covers the other sites I
checked.

So this is a dead parameter plus a documentation divergence — but it is a trap: the docs
instruct callers to use `dedupScope` for exactly this purpose, so a future call site with a
discriminating `dedupScope` and a coarse `sourceId` gets silent notification suppression with no
signal. Either wire it into `replay_material` or delete it from the API and the docs.

Related: `NEW_MESSAGE` leaves `dedupScope` unset and passes a per-message `sourceId`
(`src/app/messages/[id]/page.tsx:366-374`), so the documented "one per conversation per UTC day"
contract is not what runs — it is one per message. Whether that is desirable is a product call,
but docs and implementation disagree.

## #24 — The dispute check in `grainline_seller_refund_claim` is weaker than the projection it replaces

**CONFIRMED SQL asymmetry; PLAUSIBLE exploitability.**

Route precheck at `src/app/api/orders/[id]/refund/route.ts:157` reads
`order.paymentOpenDisputeBlocked` from the order loaded at `:142`. The final predicate,
`grainline_seller_refund_claim`, **never references `paymentOpenDisputeBlocked` or
`paymentRefundBlocked`** — it substitutes its own scans (`20260824010000:203-236`).

For `paymentRefundBlocked` the substitution is equivalent — the flag is a DB-managed projection
of the same ledger. For disputes it is **not**. The projection
(`20260830020000_prepare_order_payment_event_transition_authority/migration.sql:70-77`) blocks on
an open status **or** conflicting statuses at the same latest second:
```sql
) NOT IN ('won','lost','prevented','warning_closed')
…
OR pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(pg_catalog.lower(payment.status))) > 1
```
whereas the claim (`20260824010000:213-236`) uses
`DISTINCT ON (dispute_key) … ORDER BY seconds DESC, createdAt DESC, id DESC` and inspects **one**
row, with no conflict clause. Same-second `charge.dispute.updated` + `charge.dispute.closed` pairs
are common in Stripe.

**Failure scenario.** The ambiguous dispute pair lands between the route's `findFirst` at `:142`
and the claim's `FOR UPDATE`; the route's flag read was stale-false, and the claim's tie-break
selects the closed row, so a real Stripe refund is issued on a charge the projection considers
disputed.

Ruled out: `OrderPaymentEvent_source_shape_check` (`20260829010000:87-89`) forces
`metadata->>'stripeEventCreated' = "stripeEventCreatedSeconds"::text` for DISPUTE rows, so the two
orderings do **not** diverge — the conflict clause is the only real difference. The flags are
trigger-maintained and cannot be forged by the runtime role.

This is the one genuine precheck-only guard in the whole order-mutation family.

## #35 — NULL `buyerId` lets staff post into RESOLVED/CLOSED cases

**CONFIRMED.** `20260801175000_retire_direct_upload_compatibility_key/migration.sql:344-352`
(live; identical to the target `20260729052000:125-133`):
```sql
actor_is_party := locked_actor.id = locked_case."buyerId"
               OR locked_actor.id = locked_case."sellerId";
actor_acts_as_staff := NOT actor_is_party AND locked_actor.role IN ('EMPLOYEE','ADMIN');
```

`Case.buyerId` is `String?` with `onDelete: SetNull`. For a staff actor who is not the seller:
`actor_is_party` = `NULL OR FALSE` = **NULL**, so `actor_acts_as_staff` = **NULL**, and the
closed-case guard at `:358-377` collapses to NULL and does not fire. Staff can append a
`CaseMessage` to a `RESOLVED` or `CLOSED` case whose buyer row was hard-deleted, bumping
`updatedAt` on a terminal dispute record. The recipient block at `:379` is also skipped, and
`actor_kind` falls to `'STAFF'` at `:180-186`.

**What makes it a clear defect rather than a judgment call**: the two *sibling* files in the same
family use the correct form — `COALESCE(x = y, false)` at
`20260729050000:108-115` and `20260729060000:153-160`. Same author, same week, same pattern, two
of three get it right. `Case.sellerId` is NOT NULL, so `buyerId` is the sole NULL source, and the
non-staff stranger path is caught separately by an explicit
`IF locked_case."buyerId" IS NULL THEN RAISE` at `:387-389` — only the staff branch leaks.

No trigger blocks the insert: `grainline_case_message_author_valid` (`20260730010000:601-667`)
checks only author/kind/timestamps, and no CHECK constraint references `Case.status` from
`CaseMessage`.

## #36 — A NULL delivery reference leaves the case window open forever

**CONFIRMED.** `20260729051000_prepare_case_open_authority/migration.sql:421-440` derives
`window_reference_at` from `deliveredAt`, `pickedUpAt`, or `estimatedDeliveryDate` — all three
nullable — then:
```sql
IF window_reference_at IS NOT NULL
   AND window_reference_at + INTERVAL '30 days' < transition_at THEN
  RAISE EXCEPTION 'Case-open window has closed'
```
When all three are NULL the guard is skipped and a buyer can open a dispute against that order
indefinitely. Directly answers "verify a NULL deadline never means unlocked" — here it does.

The `estimatedDeliveryDate` future-check at `:412-419` is also `IS NOT NULL`-gated, and the
paid/refund/label/shipped guards at `:374-411` do not bound age. This is a **faithful port**, not
a regression introduced by the migration — `src/lib/caseCreateState.ts:30` (`if (!value) return
null`) and `:42` (`Boolean(closesAt && closesAt < now)`) have identical NULL-open semantics.

## #37 — A Guild Member with a pending Guild Master application cannot be revoked, silently

**CONFIRMED.** `revokeMember` (`src/app/api/cron/guild-member-check/route.ts:166-172`) aborts
before touching `SellerProfile` if no `MakerVerification` row is in a revokable status:
```ts
const verificationUpdated = await tx.makerVerification.updateMany({
  where: { sellerProfileId: seller.id,
           status: { in: [...GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES] } }, … });
if (verificationUpdated.count === 0) return null;   // silent
```
The revokable set is only two of the six enum values
(`src/lib/guildVerificationState.ts:8-11`): `["APPROVED", "GUILD_MASTER_REJECTED"]`.

A seller who applies for Guild Master keeps `guildLevel: GUILD_MEMBER` — so the cron's
`where: { guildLevel: "GUILD_MEMBER" }` still selects them — but their status is now
`GUILD_MASTER_PENDING`, which is **not** in the set. Both revocation reasons then no-op: a
dispute unresolved for 90+ days, and listings below the five-listing threshold for 30+ days.

**The realistic path is not adversarial.** `applyForGuildMaster` is gated on meeting Guild Master
criteria, which include `activeCaseCount = 0`, so the dispute route cannot be entered
deliberately. But Guild Master requirements contain **no listing-count criterion**. So a seller
legitimately applies, the application sits in the admin queue, their active listings drop below
five during review, and the daily revocation silently skips them for as long as the application is
unreviewed. An unreviewed queue makes it indefinite.

**It is invisible**: `return null` emits no Sentry event and no log. The route's `revokedMember`
counter simply does not increment, so ops-health sees a clean run. Nothing anywhere indicates a
seller escaped enforcement.

## #56 — Admin Guild transitions are the only mutation surface that skips featured-maker cache invalidation

**CONFIRMED.** `revalidateFeaturedMakerCaches()` is called from roughly **25 sites** — listing
create/edit/stock, reviews, refunds, case resolution, checkout restore, audit undo, admin listing
routes, the Stripe webhook, and **both Guild crons**
(`src/app/api/cron/guild-member-check/route.ts:209`, `src/app/api/cron/guild-metrics/route.ts:362`).

`src/app/admin/verification/page.tsx` appears in that list **zero times**. Every Guild-level
transition there ends with `revalidatePath("/admin/verification")` alone: `:325`
(approveGuildMember), `:491` (revokeMember), `:628` (approveGuildMaster), `:774` (revokeMaster),
`:871` (reinstateGuildMember). The only `revalidateTag` calls in the file are `:909`/`:935`, inside
`featureMaker`/`unfeatureMaker`.

So the cron that revokes a badge invalidates the cache; the admin doing the same thing by hand does
not. The cached `home-featured-makers-v4` entry (`src/app/page.tsx:184`, `revalidate: 300`) keeps
serving the revoked maker for up to its TTL.

**These compound with #55.** #56 is the five-minute half; #55 is the seven-day half. Together, a
staff revocation removes the badge everywhere except the single most visible surface on the site.

---

# LOW

## #9 — Conversation file-payload `kind` check fails open

**CONFIRMED.** `20260726022500_prepare_conversation_message_authority/migration.sql:1201-1208`.
Three of six conditions in the same `IF` use `COALESCE`; `parsed_file->>'kind' <> 'file'` gets
neither `COALESCE` nor a NULL check, so a payload with the key absent skips validation:
```sql
IF pg_catalog.jsonb_typeof(parsed_file) <> 'object'
   OR parsed_file->>'kind' <> 'file'                    ← NULL if key absent
   OR COALESCE(parsed_file->>'url', '') = ''
   OR pg_catalog.char_length(parsed_file->>'url') > 2048
   OR pg_catalog.char_length(COALESCE(parsed_file->>'name', '')) > 255
   OR pg_catalog.char_length(COALESCE(parsed_file->>'type', '')) > 100 THEN
```
Contained at read time: a body reaching the DB without a `kind` key stores fine, but
`parseFileMessageBody` (`src/lib/messageBodies.ts:86-100`) returns `null` and
`ThreadMessages.tsx:503` renders it as plain text, never as a trusted attachment.

## #10 — SavedSearch owner list has no unique tie-breaker

**CONFIRMED.** `ORDER BY saved_search."createdAt" DESC LIMIT p_take` with millisecond precision
and no `id` suffix, in both `20260717024500_add_saved_search_owner_rpcs/migration.sql:57-58` and
the hardened redefinition at `20260717025000:73-74` (which rewrote the projection to 16 explicit
columns but carried the ordering forward).

Violates the explicit CLAUDE.md capped-query rule. Reachability is narrow: `p_take` is capped at
25 and the dashboard passes 20, so a user needs 21+ saved searches plus two sharing a `createdAt`
millisecond for *membership* (not just order) to flip between identical requests. Writes go
through a serializable transaction rate-limited at 20/60min. Fix: `, saved_search.id DESC`.

Not a sibling-inconsistency: there is no Prisma `findMany` for saved searches — all list reads go
through the RPC.

## #12 — `p_type` fail-open in the receipt notification authority

**CONFIRMED.** `20260901120000_prepare_order_receipt_notification_authority/migration.sql:96-141`.
The source-type ↔ notification-type consistency matrix is one OR-chain in a single `IF … RAISE`.
With `p_type` NULL and a matching `p_source_type`, that disjunct evaluates NULL while all others
are FALSE, so the whole condition is NULL and the RAISE never fires — the entire authorization
matrix ("only source X may produce type Y") is skipped. `grep -rn "p_type IS NULL"` over the
migration tree returns **zero hits**; the prologue null-guards `p_notification_id` (`:41`),
`p_user_id` (`:45`), the `p_source_type`/`p_source_id` pair (`:48`), and `p_related_user_id`
(`:143`) — `p_type` is the one parameter with no null check.

Fails closed downstream because `Notification.type` is NOT NULL, so the INSERT at `:1452` dies on a
`23502` — but with a dirty error that aborts the caller's already-committed state transition,
rather than the intended clean `22023`. The function also has no app caller yet.

Branches that constrain `p_type` in their own `WHERE` fail closed to `RETURN NULL` at `:1413`;
branches that do not reference `p_type` (`case_message`, `commission_interest`,
`commission_request`, `checkout_low_stock`, `manual_low_stock`, `followed_maker_new_listing`,
`followed_maker_new_blog`, `seller_broadcast`, `favorite`, `follow`, `review`) derive a full
payload and reach the INSERT — but each is single-typed in the matrix, so there is no cross-type
confusion, only the dirty error.

## #20 — All ten granted notification wrappers fail open on NULL `p_source_type`

**CONFIRMED.** `20260722051500_prepare_notification_rls/migration.sql:2030, 2070, 2105, 2140,
2180, 2215, 2250, 2285, 2320, 2355`. Every wrapper guards with `p_source_type NOT IN (…)` or a bare
`<>` (`:2105`), with no NULL companion. NULL slips through to `create_core`, where it then
suppresses **two** authorization checks:
- `:735` `AND p_source_type <> 'banned_seller_order'` → NULL → the banned/deleted related-user
  check (`:734-745`) is skipped
- `:745-763` `AND p_source_type IN ('blog_comment', … 'seller_broadcast')` → NULL → the
  **reciprocal `Block` check is skipped entirely**

It fails closed — but **by accident**, at a payload sanity check (`:1929`, "derived notification
payload is invalid") rather than at any authorization guard, because no derivation branch matches
and the ELSIF chain (`:778-1924`) has no `ELSE`. No writes occur before `:1929` — only
`PERFORM … FOR SHARE` locks and a preference `SELECT`.

**The tell that this is drift**: `:714` in the *same function* uses the NULL-safe
`IS DISTINCT FROM 'banned_seller_order'` while `:735` uses a bare `<>` for the same comparison.

## #29 — Two cleared values are missing from all three redaction needle sets

**CONFIRMED.** `galleryImageUrls` (`src/lib/accountDeletion.ts:1609`, cleared to `[]`) and
`User.imageUrl` (`:1660`, cleared to null) are both absent from the needle array built at
`:1222-1254`, which *does* include the sibling profile-media URLs `bannerImageUrl` (`:1246`),
`avatarImageUrl` (`:1247`), and `workshopImageUrl` (`:1248`).

A workshop-gallery URL pasted into a message, case description, support closure note, or admin
audit `reason` is cleared from `SellerProfile.galleryImageUrls` but survives verbatim in that
quoted text, still carrying the deleted user's Clerk upload segment.

Consistent three-way omission, not TS-only drift: both parallel SQL needle sets omit it too —
`grep -c galleryImageUrls` returns 0 for
`20260726022500_prepare_conversation_message_authority/migration.sql` (needle set at `:43-72`) and
0 for `20260901160000_correct_case_order_invariants/migration.sql` (needle set at `:2977-3006`).

## #31 — Admin undo restores a listing to ACTIVE without re-checking seller orderability

**CONFIRMED.** The undo restore guards current listing state properly
(`src/lib/adminListingUndoState.ts`): `REMOVE_LISTING` undo requires the listing still be
`REJECTED` + `isPrivate: true`, `HOLD_LISTING` requires still `HIDDEN`, and a zero-row update
throws "Listing changed before undo could be applied" (`src/lib/audit.ts:387`). Metadata parsing
also fails closed — an invalid `previousStatus` falls back to `HIDDEN` and forces
`isPrivate: true`, so a malformed audit row cannot resurrect a listing to public ACTIVE.

What it does not do is check the seller. The admin **approve** route has an explicit block
function (`src/app/api/admin/listings/[id]/review/route.ts:32-39`) rejecting banned,
non-`chargesEnabled`, and vacation-mode sellers before making a listing ACTIVE. The undo path —
the other admin route that makes a listing ACTIVE — has no seller join at all.

Impact bounded: public read surfaces all filter on `seller.chargesEnabled` and `user.banned`, so
it would not actually be visible. State-consistency defect and a clean sibling asymmetry rather
than an exposure.

## #33 — `listingVideo` presign is live at 128 MB with no consumer

**CONFIRMED.** `src/lib/uploadRules.ts:43` sets a 128 MB cap and the endpoint is reachable from
`src/app/api/upload/presign/route.ts:47`, `:114`. But `grep -rn "VideoUploader" src` returns only
the component's own file — it is rendered nowhere, so `Listing.videoUrl` has no current writer.

A seller can mint 30 presigns per 10 minutes × 128 MB of `PRESIGNED` objects, reclaimed only by
`cleanupAfter = now + interval '2 hours'`
(`20260726185000_prepare_direct_upload_authority/migration.sql:385`) — and per CLAUDE.md that
cleanup worker is **manual-only** during the retirement handoff. Live storage-cost exposure on a
dead code path; cheapest fix is removing the endpoint from the presign enum until the uploader
ships.

## #43 — The seller response-metrics function has no actor binding at all

**CONFIRMED.** `grainline_seller_message_response_metrics`
(`20260726022500_prepare_conversation_message_authority/migration.sql:2365-2376`) is
`SECURITY DEFINER`, granted to the runtime at `:2542`, and its entire authorization is an
*existence* check (`:2392-2397`):
```sql
IF NOT EXISTS (SELECT 1 FROM public."SellerProfile" AS seller
               WHERE seller."userId" = p_seller_user_id) THEN
  RAISE EXCEPTION 'seller response metric source is unavailable';
```
No actor parameter, no `app.user_id` read, and it bypasses RLS — so it returns any maker's private
inbound-message volume and response record for any real seller id. Every other granted DEFINER
function in the family either takes an actor and routes through
`grainline_conversation_lock_pair_core` (`:895`), or derives all identity from locked rows.

Sole caller passes `seller.userId` from a locked SellerProfile row
(`src/lib/metrics.ts:172`), so nothing leaks today. It is a DB-boundary authorization gap in a
design whose premise is that the DB boundary *is* the authority.

## #47 — `BrowseByCity` links are not block-filtered

**CONFIRMED.** `src/app/browse/page.tsx:786` invokes `<BrowseByCity />` with no props, so the
`blockedSellerIds` already resolved at `:236` is out of scope, and `publicListingWhere()` at
`:797-798` runs unfiltered. A city whose only public inventory belongs to a blocked seller still
renders as a "Browse by city" link — which then 404s, because `/browse/[metroSlug]` *is*
block-aware (`:134-141`) and calls `notFound()` at `:180` when its filtered count is zero. Weakly
signals a blocked seller's geography.

Both comparable nearby-link surfaces get it right — `browse/[metroSlug]/page.tsx:206-219` passes
`blockedSellerListingWhere`, and `makers/[metroSlug]/page.tsx:144-156` passes a block-aware seller
filter. Same shape, third instance missing.

## #50 — `updateListing` has no banned/deleted account check

**CONFIRMED.** Ownership is proven by `seller: { user: { clerkId: userId } }` alone
(`src/app/dashboard/listings/[id]/edit/page.tsx:288-299`), and `listingEditBlockReason` cannot
compensate because it receives a seller select of only `{ userId: true }` (`:291`).

The siblings do check — `getOwnedListing` (`src/app/seller/[id]/shop/actions.ts:51-56`) loads
`{ banned, deletedAt }` and returns "Account access is restricted", and dashboard `setStatus`
(`src/app/dashboard/page.tsx:52-54`) does the same. CLAUDE.md requires this inside the action
rather than relying on middleware. Middleware is currently the only thing stopping a suspended
seller from editing listing content.

## #54 — Cart storage-write return values are discarded, producing the same doubling as #53 without a network failure

**CONFIRMED.** `src/app/cart/page.tsx:233-237`:
```ts
if (result.remainingItems.length > 0) { writeAnonymousCartItems(result.remainingItems); }
else { clearAnonymousCart(); }
```
Both helpers return `boolean` and both swallow storage exceptions internally
(`src/lib/anonymousCart.ts:140`, `:144-146`, `:149`, `:153-155`), returning `false` on
quota-exceeded or disabled storage. When the write fails, localStorage still holds the **original
full list including the lines that were just successfully merged**, so the next `/cart` load
re-merges them and doubles their quantity. `load()` (`:391-436`) unconditionally re-reads storage
on every invocation and is re-entered from `setQuantity` at `:468`.

## #57 — `/api/verification/apply` writes verification state with no current-state predicate

**CONFIRMED.** `src/app/api/verification/apply/route.ts:139-158`:
```ts
const record = await prisma.makerVerification.upsert({
  where: { sellerProfileId: seller.id },
  create: { … },
  update: { status: "PENDING", reviewedById: null, reviewNotes: null, reviewedAt: null, appliedAt: new Date() },
});
```
Bare upsert, no transaction, authorized by a state read at `:64-84` — four aggregate queries
earlier. Every sibling transition uses a status-predicated `updateMany` plus
`assertGuildVerificationTransition` (`applyForGuildMaster` at
`src/app/dashboard/verification/page.tsx:297-318`, `approveGuildMember:258-274`,
`revokeMember:421-445`).

**Failure scenario.** The seller's row is `REJECTED` with an expired cooldown; the block check at
`:77` passes; an admin concurrently runs `reinstateGuildMember` (setting `status = APPROVED` +
`guildLevel = GUILD_MEMBER`, `:815-846`); the seller's unguarded upsert then stomps `status` back
to `PENDING` and nulls `reviewedAt`/`reviewedById`/`reviewNotes`. Result: `guildLevel =
GUILD_MEMBER` alongside `status = PENDING` — an active badge, a phantom entry in the admin pending
queue, and the cooldown anchor erased. Recoverable, not escalation — a subsequent
`approveGuildMember` re-converges the state.

## #58 — A documented audit cleanup was applied to one publish path and not its sibling

**CONFIRMED.** `AI_HOLD_LISTING` is written from exactly one place —
`src/app/seller/[id]/shop/actions.ts:331-338`:
```ts
await logAdminAction({
  adminId: listing.seller.userId,     // ← a SELLER's id in AdminAuditLog.adminId
  action: "AI_HOLD_LISTING",
  targetType: "LISTING",
  targetId: listingId,
  reason: aiResult.reason,
  metadata: { flags: aiResult.flags, confidence: aiResult.confidence },
});
```

`src/app/dashboard/listings/new/page.tsx` has **zero** `logAdminAction` calls, matching CLAUDE.md's
documented removal: *"AI_HOLD_LISTING removed from audit log … AI review hold is automated and
shouldn't clutter the admin audit trail."* The cleanup landed on one of two publish paths.

**The trail is still polluted.** `src/app/admin/audit/page.tsx:19` has a color mapping for
`AI_HOLD_LISTING`, so the UI renders it as a recognized action, and the page's `where` is
`actionFilter ? { action: actionFilter } : {}` — no exclusion. Every AI-held seller publish inserts
a row into the default unfiltered admin audit queue.

**A seller is written into `AdminAuditLog.adminId`.** That column is
`→ User @relation("AdminActions")`, and CLAUDE.md states the relation *"intentionally points to real
`User` rows for human admin actions and undo semantics"* — the reason cron and webhook actors were
pushed out to `SystemAuditLog`. A seller lands there anyway: `/admin/audit` renders that seller's
name and email in the admin column, `User.adminActions` now includes seller-triggered automated
rows, and account deletion's rule about retaining `adminId` on administrative logs — written for
*administrators* — retains sellers under it.

No undo risk: `UNDOABLE_ADMIN_ACTIONS` is `['BAN_USER','REMOVE_LISTING','HOLD_LISTING']`
(`src/lib/audit.ts:18`), so the Undo button never renders. If the row is worth keeping at all,
`SystemAuditLog` with `actorType: 'user'` is where it belongs — which is what the seller fulfillment
and label paths already do.

**What I checked to rule out an adjacent guard.** Grepped `AI_HOLD_LISTING` repo-wide: one writer,
one UI color mapping, no filter excluding it from the audit list. Confirmed the new-listing path has
no `logAdminAction` call at all. Confirmed the action is absent from `UNDOABLE_ADMIN_ACTIONS`.

---

## #63 — Three "order exists → COMPLETED" branches discard their row count

**CONFIRMED.** `migration.sql:1251-1262`, `:1326-1337`, `:1398-1409`. Each runs a correctly
compare-and-swapped `UPDATE` but returns `'completed'` unconditionally:
```sql
     WHERE reservation.id = source_reservation.id
       AND reservation.status IN ('RESERVED', 'SESSION_CREATED');
    RETURN QUERY SELECT 'completed'::text, source_reservation."checkoutLockKey"::text, 0;
```
If the row is already `RESTORED` (stock handed back) while an `Order` exists for that session, the
guard correctly refuses the write but the caller is told `'completed'`.
`handleFixedReservationTransition` (`checkoutStockRestore.ts:298`) then returns true and the
discrepancy is swallowed — an oversell condition with no signal. The ordering is deliberate (the
`EXISTS` branch precedes the terminal-status check) and `complete()` raises on a `RESTORED` row at
`:1115-1117`, so the fixed order-creation path cannot produce this pairing; a legacy or
out-of-band `Order` write could.

## #64 — `bind_session` has no `expiresAt` predicate

**CONFIRMED.** `migration.sql:1027-1036` requires `status = 'RESERVED'`,
`stripeSessionId IS NULL`, and `repairClaimedAt IS NULL` — but not that the reservation is
unexpired. A reservation past its 31-minute window can still be attached to a fresh Stripe session.
Bounded: `repair_claim_batch` claims at `expiresAt < now - 2h` and sets `repairClaimedAt`, which
line `:1036` does exclude — so the gap is roughly 31 min → 2 h 5 min, and in practice the checkout
route binds within seconds.

## #65 — `account_scrub` locks every reservation for the account with no `LIMIT`

**CONFIRMED.** `migration.sql:1858-1864` takes `FOR UPDATE` over the account's full reservation set
inside the account-deletion transaction, which CLAUDE.md documents as running under
`{ timeout: 30000, maxWait: 10000 }`. Every comparable batch caps itself —
`prune_batch:1770` and both claim batches use `LEAST(p_limit, 50|100)`.

## #66 — A NULL-buyer reservation would abort the entire account export

**PLAUSIBLE.** `migration.sql:1794` projects `reservation."buyerId" = p_user_id`, which yields SQL
`NULL` (not `false`) when `buyerId` is NULL, and the TS parser is strict —
`src/lib/checkoutStockReservationAuthority.ts:419` calls `exactBoolean(row.exported_as_buyer, …)`,
which throws on a non-boolean (`:70-75`), aborting the user's **entire** account export.

Currently unreachable: `account_scrub:1868-1871` always nulls `buyerId` and `sellerId` together, so
a NULL-buyer row also fails the `WHERE` at `:1816-1817` and is never selected. A fragile coupling
rather than a live bug — any future path that nulls only one of the two columns turns this into a
hard export failure.


---

# Sub-threshold notes

Real, verified, and deliberately not counted as findings.

1. **Seller-orderability is a precheck only on three of five ACTIVE-writing paths.**
   `new/page.tsx:65-70` → write `:403-410`; `shop/actions.ts:250-256` → write `:344-352`;
   `edit/page.tsx:485` → write `:533-534` (which also omits `vacationMode` and banned/deleted).
   Only `review/route.ts:139-147` puts it in the final predicate. `reviewListingWithAI` can take
   ~60s (`ai-review.ts:307` 30s timeout, `:326-327` retry), so a Stripe deauthorization inside
   that window still ends at ACTIVE. **Not exploitable**: `publicListingWhere`/`isPublicListing`
   (`listingVisibility.ts:19-30`, `:63-73`) re-check all of it at every read.

2. **Alt-text index desync.** `src/lib/photoAltTextBackfillState.ts:15-20` pairs `altTexts[i]`
   with `photos[i]` over **all** photos, but `altTexts` was padded to the *filtered*
   `imagesToReview.length`. If any photo is dropped by the URL filter (#48), alt text lands on the
   wrong photo. Accessibility/SEO only; seller-provided alt text is still never overwritten
   (`:17`).

3. **Sign-out clears local state after an awaited redirecting `signOut`.**
   `src/components/Header.tsx:175-183` and `src/components/UserAvatarMenu.tsx:122-130` sequence
   the clear after the navigation, and the catch branch does not clear at all.
   `AccountDeletionButton.tsx:92-93`, `:101-102` do it in the correct order. Not a leak —
   `RecentlyViewedAuthBoundary` (mounted globally via `Providers.tsx:30`) clears one render later
   via `recentlyViewedAuthTransition` (`src/lib/recentlyViewed.ts:68-71`), which also covers the
   A→B user-switch case at `:63`.

4. **Unreachable-but-broken P2002 fallback** at `src/app/api/cart/add/route.ts:203-205`. Swallowing
   P2002 and continuing on the same `tx` cannot work — Prisma interactive transactions do not
   savepoint individual queries, so the block is already aborted and everything after fails with
   `25P02` as a generic 500. Unreachable today because the `FOR UPDATE` cart lock at `:163`
   serializes inserts and the probe at `:165` uses exactly the unique key — but the comment at
   `:157-160` presents it as the idempotency mechanism, which will mislead whoever weakens that
   lock.

5. **`lockOwnerCartItem` is a plain `findFirst` with no `FOR UPDATE`** despite the name
   (`src/lib/cartOwnerAccess.ts:201-211`). Harmless today because the cart-row lock serializes
   writers; the name promises something it does not do.

6. **`rejectGuildMaster`'s seller-side write is the one unguarded half of a paired transition**
   (`src/app/admin/verification/page.tsx:657-660`) — no current-state predicate, no
   `assertGuildVerificationTransition`. Blast radius is a stale `guildMasterReviewNotes`; the
   verification-side `updateMany where status: GUILD_MASTER_PENDING` at `:651-655` with a
   `count === 0` bail prevents double-rejection. Would become load-bearing if `guildLevel` were
   ever added to that `data` block.

7. **Guild application rate limiters use two key spaces.**
   `src/app/api/verification/apply/route.ts:37` keys on `me.id`;
   `src/app/dashboard/verification/page.tsx:262` keys the same limiter on the Clerk `userId`. One
   seller gets two independent 5-per-24h buckets. Latent, not live — Member goes through the route
   and Master through the action.

8. **Blog featured-listing verification omits `isPrivate`** at the write
   (`dashboard/blog/[id]/edit/page.tsx:131-136`, `dashboard/blog/new/page.tsx:128-133`), relying
   entirely on `publicListingWhere` at render (`blog/[slug]/page.tsx:197-201`). The documented
   private-listing rule is "enforce at the write boundary."

9. **Cross-origin POST guard coverage is 34 of 66 routes, and the ranking is odd.** `favorites`,
   `follows`, and `review helpful votes` are guarded; `admin/users/[id]/ban`,
   `admin/audit/[id]/undo`, `admin/email`, `admin/reports/[id]/resolve`, `account/accept-terms`,
   `verification/apply`, `seller/broadcast`, and the three upload routes are not. **Not called a
   vulnerability**: CLAUDE.md documents Clerk SameSite cookies as the primary CSRF defense with no
   CORS headers set, the enumerated must-have sets are money and interaction routes, and
   `/api/admin/*` additionally requires the signed PIN cookie. Webhook and public-intake omissions
   are all correct. Still worth a consistency question: if it is worth adding to a helpful-vote
   endpoint, `account/accept-terms` (a durable legal consent record with an audit row) is a strange
   omission.

10. **Relevance-sorted browse reports a capped total.** `src/app/browse/page.tsx:414-421` derives
    the user-visible `total` from a 200-row candidate fetch, so a query matching thousands prints
    "200 results" (`:723`) and caps at 9 pages (`:446`), while the standard branch at `:423` uses a
    real `prisma.listing.count`. The 200-candidate cap is documented; deriving the displayed total
    from it is not.

11. **Staff read authority returns empty rather than raising on authorization failure**
    (`20260901020000_prepare_order_staff_read_authority/migration.sql:33-43` → `RETURN;`), while
    the input-validation branch two lines above raises. Matches the established convention for
    participant reads, but here it means a misprovisioned staff credential renders the review queue
    as *empty* rather than erroring — "nothing to review" instead of "auth is broken" — on a queue
    whose whole purpose is surfacing orders needing attention.

12. **`grainline_case_cron_transition_batch` carries no actor scope**
    (`20260729060000_prepare_case_escalation_cron_authority/migration.sql:408-411`), granted at
    `:690-692`. Unlike every sibling it takes no `p_actor_user_id` and derives no authority from a
    locked row — it can bulk-resolve `PENDING_CLOSE` and bulk-escalate `OPEN`/`IN_DISCUSSION` cases
    100 per call with the only gate outside the database. Not exploitable: single caller chain
    (`src/lib/caseCronTransitionAuthority.ts:150` ← `src/app/api/cron/case-auto-close/route.ts:155`,
    `:180`, `:205`), cron-authenticated first statement, and the old `id=all` bulk path is gone.

---

# OPEN QUESTION — highest priority, unresolved

## Does the Resend SDK signal API errors by throwing?

**Could not verify.** `node_modules/` is not present in this checkout.

`sendEmailWithRetry` reacts only to **thrown** errors (`src/lib/emailRetry.ts:83-95`) —
`return await operation(attempt)` inside a `try/catch`. And `src/lib/email.ts` never reads
`.error` off the send result; `:298` awaits `sendEmailWithRetry(...)` and discards the value.

If the `resend` SDK (`package.json:297`, `^6.12.3`) returns a `{ data, error }` discriminated
result for API-level failures rather than throwing — which is its documented style — then a Resend
4xx/5xx never propagates, `throwOnFailure` never fires, and `processEmailOutboxJob` marks the row
`SENT` (`src/lib/emailOutbox.ts:341-344`). Quota consumed, dedup key burned, row pruned after 30
days, no trace. **Order receipts would silently never arrive.**

No test exercises `send()`'s error branch — the three test files mentioning resend cover
sanitization, webhook config, and body bounds.

**Codex has the installed package.** Reading `node_modules/resend/dist/index.js`
`emails.send()` / `post()` to confirm whether API errors throw is a two-minute check that either
closes this or turns it into the most severe finding in the email path. **Do this before anything
else in this section.**

---

# Disproven candidates

Recorded so they are not re-raised.

1. **Checkout restore paths rely on an advisory lock that might not match the TS side.** The
   session-keyed restore paths check `EXISTS (SELECT 1 FROM "Order" WHERE "stripeSessionId" = …)`
   **without locking any Order row**, relying entirely on `pg_advisory_xact_lock` also being held
   by the order-creating webhook. If the keys differed, paid orders could have their stock
   restored. **They match exactly**: all five SQL sites use
   `pg_advisory_xact_lock(913337, hashtext(session_id))` and
   `src/lib/checkoutStockRestore.ts:37` uses `pg_advisory_xact_lock(913337, hashtext(${sessionId}))`
   — same classid, same hash, same input. A second namespace (913338) is keyed on reservation id,
   and the one site taking both acquires them session-then-reservation, so ordering is consistent.

2. **`normalize_write` NULL fail-open.** `IF NEW.status NOT IN (…)` and the `payloadHash` branch
   looked fail-open, but both columns are `String` (**NOT NULL**) in `prisma/schema.prisma`. A bare
   `NOT IN` on a NOT NULL column is correct.

3. **`create_cart` inserting a reservation with `reservedItems = '[]'`.** An all-`MADE_TO_ORDER`
   cart legitimately has nothing to reserve, and `restore_items` over an empty array iterates zero
   times and returns cleanly.

4. **`labelClaimGeneration` / `labelClawbackGeneration` bare `<>`.** Both are
   `BigInt @default(0)` — NOT NULL — so the bare comparison is correct
   (`20260901140000:599`, `:839`, `:840`, `:1170`).

5. **The three `labelClaimStatus` `<>`/`NOT IN` sites** (`20260901140000:613`, `:628`, `:652`) are
   reachable only past the NULL-safe `labelClaimId IS DISTINCT FROM p_claim_id` fence at `:597`,
   and the `ELSE` branch at `:652` is protected by `IS DISTINCT FROM` comparisons that reject NULL
   claim fields.

6. **`prevented` disputes excluded from conversion counting.** Not a defect — CLAUDE.md documents
   "only `won` and `warning_closed` count" as intentional. Separately, `prevented` **is** correctly
   treated as terminal for dispute *state* in the four-level latest-dispute selector
   (`20260901160000:354-369`). Two different questions, both handled deliberately.

7. **Seller `some` vs `every` ownership.** Looked like a possible mixed-seller read. It is
   structurally impossible: `20260805012000:109-118` adds **validated** composite FKs
   `OrderItem(orderId, sellerProfileId) → Order(id, sellerProfileId)` and
   `OrderItem(listingId, sellerProfileId) → Listing(id, sellerId)`, and the BEFORE trigger
   `grainline_order_item_seller_key_bind` (`:138-195`) forcibly sets
   `NEW."sellerProfileId" := listing."sellerId"` and raises
   `'Order cannot contain items from multiple sellers'` at `:189-190`, closing the MATCH-SIMPLE
   NULL hole. A mixed-seller order cannot exist.

---

# Confirmed already fixed

Verified against `HEAD` — **do not re-report these.**

1. **Refund amount displayed without refund state.** Now correct: `orderPaymentPresentationState()`
   takes `refundRecorded` and `providerRefundStatus` from a separate `refundOutcome` map across all
   three list pages (`src/app/account/orders/page.tsx:130-140`), with a comment noting the bounded
   summary exposes an amount only after local finalization.

2. **Case message `authorKind` missing `'STAFF'`** — closed by
   `20260901160000_correct_case_order_invariants`.

3. **Seven naked timezone casts across five functions** — closed by the same correction
   (`naked=0 utc=9`). Note this is the *explicit-cast* variant only; see #18 for the second variant
   that survived.

4. **`paymentOpenDisputeBlocked` not checked before the staff-resolution replay return** — closed.

5. **Staff-resolution replay returning before its guards.** The corrected
   `grainline_case_staff_resolution_prepare` now re-validates **all four** guard families *inside*
   the replay branch (`20260901160000:1267-1290`) — `labelStatus = 'PURCHASED'`,
   `paymentOpenDisputeBlocked`, the refund lock pair, and the REFUND ledger with correct
   `failed/canceled/cancelled` non-blocking semantics — behind a 7-way claim-identity fence. A
   better fix than the one I would have asked for.

---

# Verified-clean inventory

**Record this so the next audit does not redo it.** Each entry was checked, not assumed.

### Injection and rendering
- **SQL injection: none in scope.** `$queryRawUnsafe` exists only at
  `src/app/commission/page.tsx:147` and `:209`; the category fragment is a *fixed literal*
  (`AND cr.category::text = $9` / `= $5`) with the value bound via `args.push`. The historical
  `$4` bug is fixed — the full positional map was traced for both count and select and every index
  is consistent. Enum values that look interpolated (`${type}::"BlogPostType"`,
  `${category ?? "OTHER"}::"Category"`) are bound parameters with a static cast. No dynamic column
  names, sort keys, or ORDER BY fragments derive from user input.
- **Markdown XSS: closed.** `renderBlogMarkdown` is the only markdown→HTML path (repo-wide `marked`
  appears twice, both in that file; the only non-JSON-LD `dangerouslySetInnerHTML` is
  `blog/[slug]/page.tsx:368`, fed by it). Truncation runs *before* parsing; schemes limited to
  `https`/`mailto`; `a` allows only `href`/`title`; `img` has no `srcset`; an `exclusiveFilter`
  drops images failing `isR2PublicUrl`. `tests/blog-markdown-sanitization.test.mjs:52-80` exercises
  the real renderer against `<svg onload>`, `<math xlink:href>`, entity-obfuscated `javascript:`,
  `<object>`, and `<form>`.
- **Path traversal in upload keys: closed.** Presign builds keys server-side from a Zod enum
  endpoint + normalized segment + timestamp + `randomBytes(12)` + an allowlisted extension.
  Verification requires the literal `${endpoint}/${segment}/` prefix and rejects `..`. The
  double-encoding gap was probed specifically: `%252E%252E%252F` survives the single-decode check
  but the key is only ever used as a literal R2 object key where percent sequences are literal
  bytes, so it resolves to nothing; and the database re-derives and re-rejects `..` and control
  characters independently.

### Authorization and isolation
- **Whole-order seller ownership** — structurally guaranteed (see Disproven #7).
- **Cross-user cart access** — every helper funnels through
  `ownerCartItemWhere(userId, …) = { AND: [{ cart: { userId } }, where] }`, and the mutating
  helpers repeat the predicate in their own `deleteMany`/`updateMany`, so ownership is enforced at
  the write, not only the read.
- **Conversation/Message participant authorization** — every granted write RPC routes through
  `grainline_conversation_lock_pair_core` (`:895-953`), which locks both `User` rows
  `FOR SHARE … ORDER BY id`, requires `ROW_COUNT = 2`, and derives `LEAST/GREATEST` itself rather
  than trusting caller ordering. `get_or_create_core:1029-1032` independently rejects
  `p_user_a_id >= p_user_b_id`.
- **Notification recipient authorization** — all eight granted read/mutation functions constrain
  every statement with `notification."userId" = p_user_id`; `mark_conversation_read` uses exact `=`
  on the link, not `LIKE`.
- **No cross-user notification creation** — the ten wrappers forward `p_user_id` unvalidated, but
  `create_core` independently proves the recipient from the locked source row in **all 26**
  branches.
- **Staff read authority** — `SESSION_USER <> 'grainline_staff_read_runtime'` is the right
  primitive (survives SECURITY DEFINER, unreachable via `SET ROLE`), paired with a live-staff-row
  check, `REVOKE ALL` with **no grant**, and a required `client` parameter in the TS helper so it
  cannot be wired to the ordinary connection.
- **Cursor pagination leaks** — cursors are ordering bounds in the same `WHERE` as the actor
  predicate, never looked up against `Order`.
- **Report-target validation** — `grainline_message_report_target_valid:565-586` requires both
  reporter and reported user to be participants for `MESSAGE` and `MESSAGE_THREAD`.

### Middleware / auth boundary
- **Public matcher** — no over-matching pattern. `/seller/((?!payouts|map)[^/]+)` uses a negative
  lookahead; `/commission/((?!new)[^/]+)` excludes `/commission/new`. The `(.*)`-suffixed API
  entries are the documented "auth handled in route" pattern, covered by
  `tests/public-api-auth-inventory.test.mjs`.
- **Geo bypass** — narrow allowlist (`src/middleware.ts:189-205`): 12 exact matches, one
  `/api/cron/` prefix, one anchored regex. **No blanket `/api`.**
- **Ordering** — geo → cron `verifyCronRequest` (before `auth()`) → `auth()` → signed-out →
  account state → terms → admin role → admin PIN. No state mutation precedes an authorization
  decision.
- **Account state applies on public routes too** — the gate is
  `if (userId && (!isSuspendedAccountAllowed(req) || !isTermsAcceptanceAllowed(req)))`, so the
  fetch is skipped only when a route is in *both* allowlists.
- **Account-state cache invalidation is complete** — the five invalidating files
  (`api/account/accept-terms`, `api/clerk/webhook`, `accountDeletion.ts`, `audit.ts`, `ban.ts`) are
  the **only** writers of `banned`, `deletedAt`, `termsAcceptedAt`, `termsVersion`, `ageAttestedAt`.
  Verified by isolating `data:` writes from `select:`/`where:` matches.
- **Open redirect** — three layers, no bypass constructible. `unsafeInternalPathPrefix` rejects
  control characters anywhere, caps the prefix at 64 chars, loops **three decode passes**
  re-checking `//` and `/\`, treats a malformed percent sequence as unsafe, and terminates at a
  fixed point; `safeInternalPath` then resolves against the app origin and rejects any mismatch.

### Concurrency and money
- **Refund double-issue: closed.** Generation-fenced CAS under `FOR UPDATE`
  (`20260824010000:265-272`), and the lock **is** re-verified as held at record time
  (`20260824050000:620-635`).
- **Cart-row lock coverage** — `lockOwnerCart` is a real `SELECT … FOR UPDATE` throwing unless
  exactly one row matches, and it is the *first* statement in both add and update transactions.
  All three caps, the stock read, and every write sit inside it.
- **Block enforcement is race-free** — `lock_pair_core` takes `FOR SHARE` on the sorted `User`
  pair while `lockBlockUserPair` takes `FOR UPDATE` on the identically sorted pair. Those conflict,
  so a concurrently-committed block either blocks the send or waits for it. Documented in a comment.
- **Email double-send between fast path and drain: closed.** The webhook claim requires
  `status: "PENDING", attempts: 0`; the drain requires `PENDING`/`FAILED` or a stale `PROCESSING`;
  both are atomic `updateMany`s checking `count !== 1`; and **both pass the same `dedupKey` as the
  Resend idempotency key**.
- **Checkout "reservation is the last validation"** — holds in both routes. The only
  post-reservation returns are inside the reservation-failure catch, where nothing was claimed.
- **Checkout money model** — `transfer_data.amount` with no `application_fee_amount`, and session
  creation carries an `idempotencyKey` derived from the checkout lock owner token.
- **Shipping subject hash** — both routes bind quantity, `variantKey`, `unitPriceCents`,
  `priceVersion`, and all four package dimensions, symmetrically.
- **Cart price integrity** — checkout recomputes from the live listing plus live variants, compares
  against *both* the snapshot and `priceVersion`, and returns `PRICE_CHANGED` rather than
  proceeding.
- **Stripe webhook** — idempotency reservation precedes thin-event retrieval and all side effects;
  unmatched charge ids on `charge.refunded`/`dispute.*` raise and stay reclaimable; cart line-item
  authority is Stripe-sourced with hard failures on unresolvable lines; restore paths take the
  advisory lock *before* the order-existence check.
- **StripeWebhookEvent lease vs timeout** — reclaim window is 2 minutes; `maxDuration` is 60 on the
  platform route and 30 on connect/v2. A handler cannot outlive its own lease.
  `health_summary` uses the same 2-minute threshold.

### Data lifecycle
- **Account deletion ordering** — lock → Clerk delete → enqueue → anonymize, with the Clerk-failure
  path releasing before any enqueue.
- **Short-name redaction** — `(?<![\p{L}\p{N}])` boundaries at length 2, one-char needles dropped
  entirely, matched on both the TS and SQL sides. "Li" cannot match inside "listing".
- **Email identity coverage** — excludes addresses now held by another live user *and*
  Gmail-folded collisions before deriving email-keyed rows.
- **Deletion blocker refund proof** — requires non-sentinel `sellerRefundId` **and** amount `>=`
  the full component sum. A partial refund, a `'pending'` sentinel, or a bare ledger row cannot
  waive it.
- **R2 media cleanup ownership** — every collected URL passes `isFirstPartyMediaUrlForUser`, which
  requires the segment to match the deleted user's Clerk id. Another user's media quoted in the
  deleted user's blog body is filtered out.
- **Buyer PII purge suppression** — per-field `CASE WHEN "buyerDataPurgedAt" IS NULL THEN … ELSE
  NULL END` across export and detail projections, plus an exposed
  `buyerDataPurgedAtEpochMillis` so consumers can distinguish purged from never-set.
- **Notification retention prune** — `LIMIT 1000`, `ORDER BY createdAt ASC, id ASC`,
  `FOR UPDATE SKIP LOCKED`.
- **StripeWebhookEvent prune** — deletes only `processedAt IS NOT NULL` rows past 90 days; failed
  and unprocessed rows retained.
- **Email retention status coverage** — covers all three terminal statuses (`SENT`, `SKIPPED`,
  `DEAD`). The gap is completion *visibility* (#41), not coverage.

### Upload / media
- **Verification token binding** — expiry evaluated **before** the HMAC compute; comparison is
  `timingSafeEqual`; the canonical input binds key, endpoint, size, lowercased content type, and
  expiry, so cross-endpoint/size/type replay are signature failures.
- **`PRESIGNED` is not claimable** from either the SQL or the app gate.
- **Claiming is transactional** — all 13 `sync*DirectUpload*References` call sites pass
  `client: tx`; the Case-evidence path is enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint
  trigger.
- **`CLAIMED` rows are sticky** — `COALESCE(upload."claimedByType", …)`; private uploads get
  `exclusive = true` backed by a partial unique index.
- **Private Case evidence never emits a public URL** — rejected at both public entry points,
  `publicUrl: null` enforced by a hard SQL reject, reads return only `key` + `contentType`.
- **Signature enforcement** — magic bytes checked before Sharp and over a 512-byte range read on
  the direct path; SVG explicitly rejected; unknown types fall through to `false`.

- **No swallowed errors.** Zero empty-body `catch {}` blocks across **594** catch sites in `src/`.
  The two on the Stripe money path are deliberate and well-commented: `route.ts:515` preserves the
  webhook lease rather than marking it failed when a concurrent delivery won the
  `stripeSessionId` race, so the outer duplicate-session branch can complete the distinct event;
  `route.ts:2394` narrowly scopes the P2002 success return to `stripeSessionId` only ("Other unique
  constraint failures are real bugs and must surface") and routes everything else through
  `sanitizeEmailOutboxError`.
- **No floating promises on side effects** — the documented past bug (11 missing `await`s) has
  stayed fixed. Every `createNotification` call site that looks un-awaited is collectively awaited,
  with good patterns chosen: `await Promise.allSettled(orders.map(…))` for ban fanout
  (`src/lib/ban.ts:96`) so one failure does not abort the rest, `await mapWithConcurrency(followers,
  10, …)` for follower fanout (`src/lib/followerListingNotifications.ts:71`) so it does not fan out
  unbounded, a `Promise<unknown>[]` array for case notifications, and `await Promise.all([…])` in
  the webhook. The `void`-prefixed calls are all client-side event handlers and effects, where
  `void` is the correct idiom and serverless termination does not apply.
- **Post-response `after()` blocks handle their own errors** — every `after(async () => …)` opens
  with a `try {` immediately inside (5 of 5 sampled across shop actions, listing create, blog
  create/edit, and seller broadcast), so a throw after the response has been sent cannot go
  unreported.

### Discovery surfaces
- **Visibility predicate drift: none.** Every raw discovery query carries the legacy-null Stripe
  clause `(sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')` — nine call
  sites — plus `chargesEnabled`, `vacationMode = false`, banned/deleted, `status='ACTIVE'`,
  `isPrivate = false`.
- **Count/list agreement** — every paged surface applies the identical predicate to both.
- **Block filtering** — complete across every documented surface except #47.
- **Pagination determinism** — every capped ORDER BY ends in a unique key; every page param is
  clamped after counting.
- **Input bounds** — `parseBoundedPositiveIntParam` regex-gates `^\d+$` and requires
  `Number.isSafeInteger`; nothing reaches Prisma or raw SQL as `NaN`/`Infinity`.
- **Trigram thresholds** — both fuzzy paths set the GUC transaction-locally inside an interactive
  transaction and keep *both* the indexable `%` predicate and the explicit `similarity() >` filter.
  No session-level `SET` anywhere.

### Moderation and trust
- **AI review fail-closed: no fail-open path.** Every return and throw traced — missing key,
  duplicate detection, non-OK HTTP (retried once then caught), `response.json()` throwing,
  empty/refusal content producing `JSON.parse('')`, `finish_reason: "length"` truncation. All land
  on `approved: false`. `normalizeAIReviewResult` forces `false` on non-array flags, non-boolean
  approved, non-finite confidence, and the semantic contradiction of `approved:true` with flags.
  All four callers gate identically on `!approved || flags.length > 0 || confidence < 0.8`, and
  `confidence` is `required` in the strict schema.
- **Prompt injection** — `systemPrompt` (`ai-review.ts:175-269`) contains **zero** `${}`
  interpolations; seller data goes only into `userListingData`, each field through
  `redactPromptInjection`, JSON-stringified inside a `randomUUID()` delimiter.
- **Staged-photo boundary** — exactly three `Photo` write sites in the entire tree;
  `/api/listings/[id]/photos` returns 410; re-review fires on *any* save of a public listing rather
  than on a photo diff.
- **In-stock zero-quantity** — blocked on all five ACTIVE-writing paths, including admin approve's
  in-transaction SOLD_OUT correction.
- **Guild eligibility** — enforced server-side independently at both application and approval, with
  the $250 waiver gated behind an explicit override and logged when it fails; Guild Master approval
  refuses to proceed on stale cached metrics.
- **Guild paired transitions** — status-predicated `updateMany` on both sides in one transaction,
  bail on `count === 0`, conflict surfaced as an `ActionState` error (except #57).
- **Admin role split is exact** — `reinstateGuildMember`/`featureMaker`/`unfeatureMaker` are
  ADMIN-only; the six review actions are staff-wide; no other call sites.
- **Guild revocation write predicates** — the `listing_threshold` guard re-checks
  `listingsBelowThresholdSince < threshold` in the write predicate, and the `unresolved_case` guard
  deliberately omits the Case relation because `getCaseGuildUnresolvedGuard(seller.id, tx)` is
  genuinely re-run on the transaction client and aborts if no longer blocking. The comment
  explaining this is accurate.
- **Review system** — advisory lock first in `refreshSellerRatingSummary`, all four call sites pass
  `tx`; creation is rate-limit → self-review block with security event → duplicate 409 → eligibility
  under the parent Order row lock → `P2002` → 409; editing enforces ownership (404, not 403, so no
  existence leak), the seller-reply lock, and the 90-day window.
- **Comment moderation** — notifications fire only from `approveComment` after a
  `where: { id, approved: false }` claim bailing on `count !== 1`; replies attach only to approved
  comments by active authors; depth capping flattens level 4+ to level 3; GET filters unapproved,
  inactive-author, and viewer-blocked comments at all three nesting levels.
- **Cron auth** — `verifyCronRequest` is the first statement in all 16 `/api/cron/*` handlers; a
  missing/empty `CRON_SECRET` returns false before any comparison so `Bearer undefined` cannot
  match; comparison is `timingSafeEqual` over SHA-256 digests. The stale-`RUNNING` reclaim deletes
  with `{ id, status: "FAILED", startedAt }` and cannot delete a fresh replacement row.
- **Email suppression semantics** — one-click unsubscribe does not block transactional mail;
  `BOUNCE`/`COMPLAINT`/account-deletion do; the delivery path uses the narrow variant.
  Quota outage is correctly distinguished from exhaustion, and the recipient counter *is* rolled
  back when the global reservation fails, using the same `quotaCheckedAt`.
- **Blog cache invalidation is complete** — four sites covering create, edit/publish, archive,
  unarchive; there is no hard-delete path.
- **Latest-dispute selection** — four-level ordering (signed Stripe event time → terminal-status
  priority → local `createdAt` → unique `id`) with `LIMIT 1 FOR SHARE` and a
  `~ '^[0-9]{1,12}$'` guard before the bigint cast.

---

# Structural recommendations

**Four separate finding classes all collapse to one root cause: every check in this codebase runs
exactly once.**

## 1. Re-run activation surface assertions in CI (closes #6, #8, #51)

Every table's activation migration ends with *"these N exactly-pinned functions are the complete
authority surface."* True at the moment it runs, untested forever after. `StripeWebhookEvent`'s
count has roughly doubled past its asserted 6; the guard written to catch that — error string
*"runtime function surface drifted"* — cannot fire because it is a one-shot migration.

A CI job that re-runs each table's surface assertion against the live catalog converts ~14
historical claims into standing invariants.

## 2. A NULL-safety lint with **table-qualified** nullability (closes #3, #4, #5, #9, #12, #15, #20, #35, #36)

Nine findings are one bug: `<>` or `NOT IN` on a nullable operand inside an `IF … THEN
RAISE/RETURN` guard with no NULL companion in the same statement.

The precise rule — refined twice during this audit after two false-positive rounds:

> Flag `<>` or `NOT IN` where the operand resolves to a **nullable column on its own table** or an
> unguarded parameter, **and** the expression sits in an `IF … THEN RAISE/RETURN` guard (not a
> `WHERE` row filter, where NULL fails closed), **and** no `IS NULL` / `IS DISTINCT FROM` /
> `COALESCE` covers it in the same statement.

Name-based column matching produces ~80% false positives (`SellerProfile.userId` is NOT NULL but
shares a name with nullable columns elsewhere). Table qualification is what makes it usable.

## 3. Ban both timezone variants (closes #18, and the failing Order smoke test)

Two distinct bugs, and the first sweep only caught one:
- **(a)** `clock_timestamp()::timestamp` — explicit cast.
- **(b)** bare `clock_timestamp()`/`now()`/`CURRENT_TIMESTAMP` compared against or assigned to a
  `timestamp without time zone` column — **implicit** session-TimeZone coercion, with no cast token
  to grep for.

Correct forms: `AT TIME ZONE 'UTC'` or `timezone('UTC', …)`. Note the Order authenticated-route
smoke test is currently failing on *"a cleanup timestamp-without-time-zone round-trip defect"* —
the same class.

**The durable fix is structural, not a lint.** DirectUpload solved this by defining one
`grainline_direct_upload_utc_now()` helper used at all 8 sites and has zero occurrences; Case/Order
solved it by repetition and got it wrong seven times including one reintroduction.

## 4. Assert properties, not instance lists (closes #46, and the class behind #13, #55, #56)

`blog/search` was missed because CLAUDE.md's rule *enumerates* — "blog suggestions, blog comments,
commission list/detail" — and `tests/private-json-cache-headers.test.mjs` mirrors the enumeration.
The docs, the tests, and the code shared one blind spot.

Rewrite guardrail tests to assert the property:
- *any* handler calling `getBlockedIdsFor` must return through `privateJson`
- *any* consumer of `paymentRefundBlocked` must also consume `paymentConversionDisputeBlocked`
- *any* path clearing `guildLevel` must also clear `featuredUntil` and invalidate the featured cache
- *any* path making a listing ACTIVE must fence on `status` + `updatedAt`

## 5. A guard-column sibling-diff check (closes #1, #2, #13, #17, #21, #49)

The single most productive method in this audit was building a matrix of which guards each sibling
function carries, then reading the gaps. It mechanically reproduced both original HIGH findings
before any logic was read:

```
seller_refund_claim                  SRID CASE LBL      ← has label guard
blocked_checkout_refund_claim        SRID CASE          ← #2 ✓
seller_refund_record                 SRID FUL           ← has fulfillment guard
blocked_checkout_refund_record_core  (absent)           ← #1 ✓
staff_resolution_prepare        SRID LBL FUL DISP CASE  ← reference
```

CI rule: **fail when a new function's guard-column set is a strict subset of an established
sibling's without an annotated exemption.**

---

# Method notes

Recorded because the sweeps were wrong twice before they were right.

1. **Prove the pattern matches something before concluding "clean."** Six grep failures during
   this audit produced false negatives: `ALTER TABLE "?[A-Za-z]+"?` missed `public."SavedSearch"`;
   `^CREATE OR REPLACE FUNCTION` missed `CREATE FUNCTION` (deliberate in newer migrations);
   `paidAt|…|REFUND` missed `paymentRefundBlocked` because the pattern was case-sensitive and the
   column name was not in the alternation — that one nearly produced a false "regression" report.
2. **Parameter-only sweeps are structurally blind to record fields.** Matching `p_[a-z_]+` misses
   `locked_order."sellerRefundId" NOT IN (…)`. Extending to record fields found #15 and doubled #5.
3. **A fixed lookback window produces both kinds of error.** A 12-line window missed a NULL guard
   at distance 13 (false positive) and suppressed a genuine mixed-safety statement where an
   *adjacent* operand used `IS DISTINCT FROM` (false negative). Same-statement scoping is correct;
   proximity is not.
4. **Agent deaths cost tokens, not findings — if prompted correctly.** Five agents died on spend
   limits. Every prompt required stating candidate findings **before** further investigation, so a
   dying agent still delivered. One died mid-verification having listed five candidates; all five
   were then verified by hand (one became #44, three disproven, one folded in).
5. **Verify every agent claim independently.** Agents were right about the code far more often than
   not, but severity and reachability needed correction repeatedly — one HIGH was downgraded after
   an adjacent guard was found; a dedup finding was downgraded after checking that `sourceId`
   already carried the discriminator; and two agent findings were *upgraded* after checking scope
   (#17 from four functions to six; #8 into #51).

---

# Round 2026-09-24 to 09-26: Order zero-direct prefix review (numbered #67–#80)

Scope: the 17 Order migrations applied to production on 2026-09-24 (run `35947133047`,
0 → 17), the banned-buyer successor `20260905180000` (applied 2026-09-25, run `36078038174`),
and PRs #447–#457. Read from origin/main `5c1ffd73`. Four read-only reviewers covered the
SQL; every finding below marked "verified" was re-traced by hand against the cited lines.

## Status updates to earlier findings

- **#59 — FIXED.** `20260905180000` widens `grainline_checkout_reservation_complete` to accept a
  NULL-buyer Order only when all 20 buyer/PII fields are NULL, `buyerDataPurgedAt` is set and the
  reservation buyer is currently missing/banned/deleted. Verified: the create function NULLs exactly
  those 20 fields (`20260905130000:636-670`); the invalid-buyer reasons (`:284-292`) mirror the
  fix's "not active" test; both User rows are locked `FOR UPDATE` in the same transaction; the live
  app (`c2db1860`) never writes `quotedToLine1/2`, so the fix covers it too. Test reproduces the old
  failure first. Severity was also overstated earlier: failed webhooks surface in ops-health.
- **#25 — FIXED in the new app** (`20260905130000:462-472` SOLD_OUT carve-out); live in the serving
  app until the zero-direct app is promoted.
- **#11 — no longer forward-looking.** Realized as #70 below.

## #67 — CRITICAL — the new create function rejects every real paid checkout (verified)

`20260905130000:234` requires reservation `status IN ('RESERVED','COMPLETED')` for a row matched by
`stripeSessionId = p_session_id`; `:614` then requires `RESERVED`. But the live trigger
`CheckoutStockReservation_normalize_write` (`20260810190000:578`) forbids `RESERVED` with a non-NULL
session, and `grainline_checkout_reservation_bind_session` (`:1027`) sets `SESSION_CREATED`. The
webhook calls `readExistingCheckoutOrder` then `createOrderFromPaidCheckout`
(`src/app/api/stripe/webhook/route.ts:607`, `:990`) with nothing in between that changes status.
Every real paid checkout therefore raises; the buyer is charged, no Order, Stripe retries ~3 days.
Not yet live (the serving app does not call it). Missed because the fixture
(`tests/helpers/order-paid-checkout-fixture.mjs:240`) inserts `RESERVED` + `cs_test_proof` into a
table without the trigger and stubs `reservation_complete`, and the authenticated smoke never pays
(it expires the session and seeds Orders directly via the owner connection).

## #68 — HIGH — LIVE — refunds on orders with a purchased label cannot be recorded (verified)

`Order_provider_claim_mutual_exclusion_check` (`20260905030000:53-73`, validated, applied
2026-09-24) forbids `sellerRefundId`/`refundClaimId` when `labelStatus='PURCHASED'` or a label claim
is active. `grainline_order_payment_signed_refund_apply` (`20260828010000:~430`, used by the serving
app via `src/lib/orderPaymentSignedWebhook.ts`) takes its final ELSE branch and sets
`sellerRefundId` → 23514 → the ledger row and audit roll back; every Stripe retry fails. Seller
refund (`refundRouteState.ts:138`) and staff Case refund (`20260901160000:1275`, `:1381`) both
refuse labelled orders, so a damaged item delivered on a Grainline label has no working refund path:
the Stripe Dashboard refund is the only route and it now fails to record.

## #69 — HIGH — in-flight sessions at promotion get no Order (verified in SQL)

`20260905130000:237` raises when `sourceSnapshot IS NULL`. Snapshots are written only by the new
`create_*_snapshot` functions (`20260905110000`) called by the new app. A session created on the
old app and paid after promotion fails permanently. Requires a ≥31-minute checkout drain before
promotion, or a successor legacy path.

## #70 — MEDIUM — seller-deauthorization hold is lost when the order already has a note (verified)

`20260905120000:228-232` preserves any non-blank `reviewNote`; the fulfillment hold
(`20260901130000:108-110`), label holds (`20260901140000:143-144`, `:329-330`, `:445-446`),
participant detail (`20260901010000:320`) and `orderReviewHolds.ts` all key on the note prefix.
`sellerDeauthorizedAt` is written but read nowhere (only occurrence is the defining migration).
A deauthorized seller whose order carried a staff/clawback note can still ship or buy a label.
Second trigger (reviewer-traced): ban → deauthorize → unban restore (`20260905100000:416-445`)
clears the note and `reviewNeeded`. The predecessor route overwrote the note, so this is a regression.

## #71 — MEDIUM (product) — no path moves SHIPPED to DELIVERED without the buyer (verified)

Only buyer confirmation sets DELIVERED; none of the 16 `vercel.json` crons does. An unconfirmed
order stays SHIPPED forever: the case window never starts, both parties' account deletion stays
blocked, and `order-pii-prune` never prunes it. Needs carrier-tracking delivery or a timeout policy.

## #72 — MEDIUM — staff bootstrap password can land in database logs (verified)

`scripts/order-staff-read-role-bootstrap.mjs` (commit `e60acb4d`) builds
`CREATE ROLE ... PASSWORD %L` via `EXECUTE format(...)`. If it fails, PL/pgSQL's error CONTEXT
includes the statement text with the plaintext password in the server log. The previous production
attempt failed at exactly this statement (`XX000`). Wrap the EXECUTE in
`BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '<generic>'` and regenerate the password after
any failed run. Parameter logging of the `set_config` bind under full statement logging is not proven
either way for Neon.

## #73 — LOW-MEDIUM — staff "mark reviewed" erases the blocked-checkout signal (verified mechanism)

`grainline_order_staff_mark_reviewed` (`20260905090000`) clears `reviewNeeded` checking only
clawback status. `existing` (`20260905140000:66-77`) and `postpayment` (`20260905150000:58-66`) treat
an order as blocked only via `reviewNeeded` + "Order was held for staff review." If staff clear it
before the refund is recorded and Stripe retries, post-payment side effects run (confirmation
notifications/emails for an order meant to be refunded), or raise 23514 forever when the buyer was
detached. The blocked state should be durable and mark-reviewed should refuse while it is unrefunded.

## #74 — LOW — public "fulfilled" and "pieces sold" still count lost-dispute orders (verified)

`20260901050000`: only `public_listing_counts` (`:188`) and `marketplace_listing_metrics` (`:255`)
filter `paymentConversionDisputeBlocked`; `public_fulfilled_count` and `public_seller_stats` do not,
while `20260905170000` added it to all eight seller-private functions. Related (reviewer-traced):
analytics average processing time now drops lost-dispute orders while Guild on-time shipping keeps
them. Decide the intended rule and make siblings match.

## #75 — LOW — NULL-tolerant guards in applied functions (verified for two)

`20260905040000:37` `p_claim_source NOT IN (...)` passes NULL (contained: the WHERE then matches no
row and the TS caller throws). Reviewer-traced: JSON-null provider fields skip the `!~`/`<>` chains in
`20260905130000:133-148`, `:185-194`, `:580` (contained today by the route). Add explicit `IS NULL`
checks in any successor.

## #76 — LOW — ban fails closed above 5,000 open orders (verified)

`20260905100000:216-220`. A product limit, not unsafe.

## #77 — LOW — record-core can refuse a real provider refund (reviewer-traced, not re-verified)

`20260905170000:~1318-1331` raises if fulfillment left PENDING between claim and record; admin
CONFIRMED_PROVIDER_EFFECT reuses the same core. Only reachable through predecessor direct Order CRUD,
so it disappears when direct grants are revoked at Order ENABLE; until then it needs manual repair.
Also: the claim-conflict path writes the misleading staff note "refund or dispute state changed".

## #78 — LOW — misattributed security telemetry and unbound actor ids (reviewer-traced)

`20260905140000:106-115` returns seller ids on every retry, so buyer- or listing-caused blocked
checkouts log `ownership_violation` against an innocent seller. `grainline_seller_refund_preflight`
and `grainline_case_legacy_refund_lock_release` trust a caller-supplied actor id without binding it
to `app.user_id` (current callers pass server-derived ids; no escalation found).

## #79 — extends #60 — metadata fallback double-counts buy-now quantity (verified)

`restorableStockItemsFromMetadata` (`src/lib/checkoutStockRestore.ts:105-120`) sums both
`listingId/quantity` and `reservedStock`; the single route sets both (`single/route.ts:551`, `:574`).
Only reached when Stripe line items are absent (`:317-319`), on the same path as #60.

## #80 — process — the end-to-end smoke can pass without proving shipping or payment

PR #455 accepts a pickup-only quote when the test seller's carrier preferences exclude test rates, and
the smoke never completes a paid checkout. Add a real test-mode paid checkout through the staged app
before promotion; record which quote mode was proven.

## Not yet reviewed (reviewer ran out of budget)

Deauthorization fallback when a seller reconnects a new account and a second closed event arrives;
refund commit-proof interaction with finalize generations; the cart route's bind/abort failure paths;
undo snapshot choice when a user has several BAN_USER logs; full reads of the five related docs.

---

# Round 2026-09-27: verification of Codex fixes and today's merges (numbered #81–#85)

Read from origin/main `2d511a90`. Production runs since last round: Release Corrections
`36286591886` / `36300488258` (applied `20260926010000`–`012200`), Checkout source cutover
`36330287044` (applied `20260926012300`, 15:40 UTC). The six broad reviewers launched this round all
hit the account spend limit before reporting; the work below is my own.

## Fix verification

- **#67 FIXED (verified).** `20260926011000` changes only the two status gates to `SESSION_CREATED`
  (diffed against `20260905130000`: 4 changed lines). **Residual:** every proof still hand-builds
  `CheckoutStockReservation` without the production trigger `CheckoutStockReservation_normalize_write`;
  `tests/helpers/order-paid-checkout-fixture.mjs` still stubs `reservation_complete`. A state production
  forbids can still be inserted in tests, which is how #67 shipped.
- **#68 recording FIXED (verified).** `20260926010000` narrows the constraint to
  `labelStatus/labelClaimStatus AND refundClaimId`, so a provider refund on a labelled order records.
  **Still open (product):** seller refund and staff Case refund both refuse labelled orders, so there is no
  in-app refund path for a damaged item delivered on a Grainline label.
- **#69 ADDRESSED.** `20260926012300` retires the legacy creators; the cutover run waited the 31-minute
  window and proved no active legacy checkout remained.
- **#70 FIXED (verified).** Fulfillment (`20260926012000:106`), label (`012100:77,262,376`), projection
  (`012200:128`) and `orderReviewHolds.ts` now key on `sellerDeauthorizedAt IS NOT NULL`, independent of
  note text and `reviewNeeded`. Buyer receipt confirmation deliberately does not check it.
- **#72 FIXED (verified).** The dynamic `CREATE ROLE` is wrapped in
  `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'staff bootstrap role creation failed'`.
- **#79 upgraded (verified).** The expired-session webhook fetches Stripe line items only when
  `cartId && sellerId` (`src/app/api/stripe/webhook/route.ts:~1213`), so every buy-now session that
  reaches the legacy restore uses the doubling metadata path. Still gated on reaching the legacy path (#60).

## #81 — MEDIUM — the seller-deauthorization hold can never be released (verified)

`sellerDeauthorizedAt` is written once (`20260905120000:225`) and cleared nowhere in any migration or
`src/`. Since #70's fix the hold no longer depends on `reviewNeeded`, so staff "mark reviewed" (which
previously released it) cannot. A `PENDING` order of a closed seller account can never be shipped or
labelled; the buyer cannot open a Case while `PENDING`; staff Case refund needs a Case. The only exit is a
Stripe Dashboard refund (recordable after #68's fix). Decide the intended outcome: a staff release
operation, or an explicit staff refund path for these orders.

## #82 — MEDIUM (process) — the ENABLE workflow does not check that the old app is gone (verified)

`.github/workflows/order-core-enable-production.yml` binds exact main, green CI and cutover run
`36330287044`, and the migration preflight checks database posture. Nothing verifies that the canonical
site serves the zero-direct build, that the staged authenticated smoke passed, or that old deployments
reachable with Vercel bypass keys are contained (all stated preconditions in
`order-rls-completion-plan-20260907.md`). Dispatched early, ENABLE breaks every order page, dashboard and
Stripe webhook the old app serves. The smoke already has the needed check (`verifyDeploymentBoundary`,
canonical `dpl=` marker vs a READY deployment for the reviewed commit); reuse it as a hard gate.
Verified clean alongside: no direct Prisma or raw-SQL access to `Order`, `OrderItem`, `Case` or the
payment tables remains in `src/`, and all seven trigger functions that read `Order` are SECURITY DEFINER.

## #83 — OPS — checkout is disabled on the live site unless the new app is already promoted (verified)

The old app `c2db1860` starts checkouts via `grainline_checkout_reservation_create_{cart,single}_consistent`
(`src/lib/checkoutStockReservationAuthority.ts:169,194` at that commit); `20260926012300:88-97` revoked
runtime EXECUTE on both at ~15:40 UTC. This is the intended drain. I could not determine which build
serves `thegrainline.com` (`dpl_FKdRWV3J8XxxrRUSWVdis6P6VWBe` appears nowhere in the repo; no Vercel CLI
locally). If it is the old build, every cart and buy-now checkout fails until promotion.

## #84 — LOW (process) — release-state docs are four days stale

`order-rls-completion-plan-20260907.md`, `order-zero-direct-release-scope.md` and the coverage matrix were
last changed 2026-09-23/09-07 and still describe the prefix as unapplied. Since then: prefix, banned-buyer
fix, six corrections and the cutover were applied. Current state lives only in the private
`RELEASE-ACTION-QUEUE`, so any reviewer reading the repo gets the wrong picture.

## #85 — LOW — seller settings accept any latitude/longitude (verified)

`src/app/dashboard/seller/page.tsx:72-73` uses lenient `toFloat` with no range check, and no DB CHECK exists
for `SellerProfile.lat/lng` (radius has one). A forged value (e.g. `lat=999`) is stored and fed to
`findOrCreateMetro` and public maps. `radiusMeters` also goes through `toFloat` into an Int column, so a
fractional forged value errors instead of returning a validation message.

## #86 — LOW-MEDIUM — staff Case refunds can now start during an in-flight label purchase (verified)

Before `20260926010000`, the Order constraint rejected `sellerRefundId` while a label claim was active, so
a staff Case refund racing a label purchase failed closed. The constraint now covers only `refundClaimId`.
`grainline_case_staff_resolution_prepare` (`20260901160000`, body lines ~332 and ~438) checks
`labelStatus = 'PURCHASED'` but not `labelClaimStatus` (`PROVIDER_PENDING/AMBIGUOUS/RECORDED`), then sets
`sellerRefundId = 'pending'` (~522). The blocked-checkout claim (`20260905170000`) does check
`labelClaimStatus`; the seller claim (`20260824010000:82`) does not but is still stopped by the constraint
via `refundClaimId` (as a 23514 error, not a clean conflict). Result of the race: the buyer is refunded and
Shippo still sells the label; the new `provider_record` branch (`20260926012100`) then correctly records
the label without marking the order shipped, skips the transfer clawback and flags staff to void it. So
nothing is lost silently, but it costs a manual void each time. Add the `labelClaimStatus` check to the
Case prepare (and the seller claim) for parity with the blocked-checkout claim.

## Yesterday's code (2026-09-26), otherwise verified clean

- Every function replaced by `20260926012000`–`012200` differs from its predecessor only in the intended
  lines: the deauthorization check (5 functions), `IS NULL` guards on `p_outcome` in
  `label_provider_record` and `label_clawback_finalize` (closes the label half of #4), and the new
  refund-race branch in `label_provider_record`.
- The refund-race branch keeps label evidence, leaves fulfillment untouched, sets clawback
  `MANUAL_REVIEW`, appends a staff note, writes `ORDER_LABEL_REFUND_RACE_RECORDED`, and suppresses the
  buyer notification; the app (`orderLabelFinalization.ts`) enqueues the shipped email only when the
  database returns `SHIPPED`.
- `provision-runtime-db-role.sql` refuses to re-grant the four legacy creators once the retirement
  migration is recorded; its checksum pin matches the applied file (`f66b5314…`) in all four places.
- #458/#460/#461 are end-to-end-test and CI changes. #461's removed cookie capture after the Clerk
  sign-in step is harmless (the jar is unused afterwards); recording the session ID before the token
  request ensures cleanup can revoke it.
- Cosmetic: `orderHasDeauthorizedSellerReviewHold` and `deauthorizedSellerReviewHoldWhere` are now unused.

---

# Broad round 2026-09-27 (outside Order RLS)

Reviewed from the origin/main snapshot at `5b30766c`. Everything below was hand-verified unless marked.

## #87 — MEDIUM — multi-item and multi-quantity orders are quoted and labelled as one box (verified)

`src/app/api/shipping/quote/route.ts:441-454` (cart mode) sums weight and takes the **max** of each
dimension across all lines; single mode multiplies weight by quantity and keeps one item's dimensions.
The label preflight `grainline_order_seller_label_preflight` builds the same single parcel. Example: 4 of a
60x40x40 cm boxed chair is quoted as one 60x40x40 box at 4x weight. Carriers price large parcels by
dimensional weight, so the buyer is undercharged, and the label bought through Grainline describes a
parcel that cannot hold the goods. Consequences:
- The seller must buy extra labels outside Grainline, or ship under-declared.
- Carrier dimension/weight adjustments are billed to the **platform's** Shippo account after the label
  clawback already reversed only the original label cost, so the gap lands on Grainline.
CLAUDE.md says "Packing logic is in `src/lib/packing.ts`", but that file does not exist on main; there
is no packing logic anywhere. Fix the doc as part of this.
Fix direction: quote one parcel per unit (or per packing result) with `shippoRatesMultiPiece`, and use the
same parcel list in the label preflight.

## #88 — MEDIUM (privacy) — buyer addresses on never-confirmed or refunded orders are kept forever (verified)

`grainline_order_buyer_pii_prune_batch` (`20260901160000`, lines 20-42) only prunes orders that are
`DELIVERED`/`PICKED_UP`, `reviewNeeded = false`, not dispute-blocked, with no active Case. Orders that
never reach that state keep the full address, phone, gift note and label data indefinitely:
- Shipped orders the buyer never confirms. Per #71 nothing moves `SHIPPED` to `DELIVERED` without the
  buyer, so in practice this will be most shipped orders.
- Orders refunded before shipment (still `PENDING`).
- Blocked-checkout auto-refunds, which stay `reviewNeeded = true` until staff clears them.
Privacy Policy (`src/app/privacy/page.tsx:600-609`) promises removal after 90 days "for fulfilled orders".
A shipped order is arguably fulfilled, so the promise is not met for the common case. Fix direction: also
prune `SHIPPED` orders N days after `shippedAt` (outside the Case window) and fully-refunded pre-shipment
orders, or fix #71 first and word the policy precisely.

## #89 — MEDIUM (scale) — Stripe Connect reconcile will time out once there are a few hundred sellers (verified)

`src/lib/stripeConnectReconcile.ts` scans **every** `SellerProfile` with a `stripeAccountId`, from the
first id each run, calling `stripe.accounts.retrieve` plus `mirrorStripeChargesEnabled` per seller at
concurrency 3. There is no time budget; the route has `maxDuration = 60`. At roughly 0.5 s per seller
that is about 350 sellers per run. Past that, every run is killed:
- the `CronRun` row is left `RUNNING`, so ops-health raises a stale-cron alert every time;
- sellers later in id order are never reconciled, so missed `account.updated` webhooks stay unfixed for them.
The scan also includes buyers who clicked "Connect Stripe" and never finished (they still have an
account id). The Founding Maker target alone is 250 sellers.
Fix direction: add a time budget and a persisted cursor (resume where the last run stopped), or only
reconcile accounts not refreshed in the last N hours.

## LOW items from this round

- **Connect account mirror race.** `mirrorStripeChargesEnabled` (`src/lib/stripeWebhookMirror.ts`) reads the
  seller with `findFirst` and then updates by id without re-checking `user.banned/deletedAt`. A ban that
  commits between the read and the write can have `chargesEnabled = true` written back. Put the
  account-state predicate in the update (`updateMany` with the user conditions).
- **`POST /api/stripe/connect/create` has no cross-origin guard.** Sibling money/account POSTs call
  `getExplicitCrossOriginPostRejection`; this one does not. Its idempotency key
  `connect-v2-account:${seller.id}` is permanent, so if a created account is later deleted/rejected on
  Stripe's side, re-creating inside Stripe's idempotency window returns the old response.
- **Misleading publish error.** `publishListingAction` (`src/app/seller/[id]/shop/actions.ts`) returns
  "Connect your bank account..." for vacation mode as well as missing Stripe.
- **Raw error text.** `deleteListingAction` in the same file returns `error.message` to the client.
- **Legacy v1 shipping tokens.** `src/lib/shipping-token.ts` still accepts the postal-only v1 shape. Tokens
  live 30 minutes, so this branch is dead weight; remove it with a test.
- **Dead helper.** `writeCartSessionJson`/`readCartSessionJson` in `src/lib/cartSessionStorage.ts` have no
  callers. The "no address/rate/client secret in browser storage" contract holds (only removals remain).
  Deleting the writer would make it impossible to reintroduce by accident.
- **Onboarding avatar draft is not user-scoped.** `ProfileAvatarUploader` stores the URL in
  `sessionStorage` key `grainline:onboarding:avatarImageUrl`, which `clearSignedOutLocalAccountState` does
  not clear. On a shared browser the next user starting onboarding sees the previous user's photo
  preview. The server (`saveStep1`) correctly rejects the foreign URL, so the only effects are the preview
  and a confusing "Use an uploaded Grainline image" error. Clear the key on sign-out or scope it by user id.
- **Commission expiry notifications are not retried.** `src/app/api/cron/commission-expire/route.ts`
  sets `EXPIRED` first, then notifies. If notification fails the failure is recorded (ops-health will
  alert), but the next run skips the request because it is no longer `OPEN`, so those notifications are
  never sent.

Verified clean this round: notification-prune (all jobs bounded, support-request 2-year retention is
disclosed in the Privacy Policy), quality-score (batched UPDATE ... FROM VALUES, bounded memory),
commission notification copy (derived in the DB from request status: expired/closed/fulfilled all correct),
unsubscribe token (HMAC with timingSafeEqual, 90-day TTL).

## #90 — MEDIUM (privacy/safety) — account export tells a blocked user who blocked them (verified)

`src/app/api/account/export/route.ts:322-326` exports every `Block` row where the user is the blocker
**or the blocked party**, including `blockerId`. The same export includes `recipientId` on sent messages
and `senderId` on received messages (lines 481-486), plus counterparties on orders. So a blocked user
can request an export and match each `blockerId` to a conversation partner, learning exactly who blocked
them. That undercuts the safety purpose of blocking (harassment). Reports filed against the user are
already exported correctly without `reporterId`; blocks should follow the same rule.
Fix: export only blocks the user created (`blockerId = user.id`). If incoming blocks must be disclosed,
export a count or dates without `blockerId` (GDPR Art. 15(4) allows withholding other people's data).

## More LOW items (same round)

- **Seller reply and buyer edit race.** `POST /api/reviews/[id]/reply` checks `sellerReply` is empty,
  then updates by id; two quick replies overwrite each other. `PATCH /api/reviews/[id]` checks
  `sellerReplyAt` is null, then updates by id; a buyer edit can land right after the seller replied,
  so the reply answers text that no longer exists. Use `updateMany` with `sellerReply: null` /
  `sellerReplyAt: null` in the write and return 409 on zero rows.
- **Review edit skips the length cap.** PATCH stores `sanitizeRichText(comment)` without the
  `truncateText(..., 2000)` the create path applies. NFKC normalization can lengthen text, so a
  2,000-character comment can exceed `VarChar(2000)` and fail with a 500 instead of a message.
- **Custom listing skips processing-time checks.** `createCustomListing`
  (`src/app/dashboard/listings/custom/page.tsx:161-170`) accepts min > max and values over 365; the new
  listing action rejects both (`new/page.tsx:228-235`). The DB CHECK `Listing_processing_days_valid_chk`
  then throws, so the seller gets a generic server error instead of a validation message.
- **Photo originals can shift by one.** New and custom listing actions verify `imageUrls` and
  `imageOriginalUrls` separately and then pair them by index (`originalUrl: imageOriginalUrls[i]`). If
  verification drops an entry from one list but not the other, every later photo gets the wrong original
  for re-cropping. The client keeps them aligned, so this only happens on a partial verification failure.
  Verify the pairs together.
- **Cart checkout retry locks the buyer out for 31 minutes.** `handleProceedToPayment`
  (`src/app/cart/page.tsx:733-811`) makes a new `checkoutGroupId` on every click, and the server's
  payload hash includes it (`checkout-seller/route.ts:463-503`). If a seller's session was created but the
  response was lost, timed out or wasn't JSON, the session isn't rolled back, and clicking again gets 409
  "already open... wait up to 31 minutes" instead of the existing session. Reloading the page recovers
  via `/api/cart/checkout/resume`; the retry button does not. Keep the group id stable until the cart,
  address or rates change.
- **Case auto-close hides notification failures.** `src/app/api/cron/case-auto-close/route.ts` sends
  notifications after the DB transitions, through the swallowing `createNotification`, and reports a
  hard-coded `failures: []`. A lost "case closed/escalated" notification never reaches ops-health. Use
  `createNotificationOrThrow` inside a try/catch that records failures.

Verified clean: review create (eligibility re-checked under an Order row lock, review text kept out of
the email), review delete (DB trigger `grainline_direct_upload_release_review_delete` releases photos),
block route (origin guard, rate limit, follow cleanup), account export (POST-only, origin guard, fresh
reverification, audit row required, reports-against-you omit the reporter).

## #91 — LOW-MEDIUM (SEO/UX) — commission metro pages whose slug starts with "new" require sign-in (verified)

`src/middleware.ts:65` makes `/commission/((?!new)[^/]+)` public. The lookahead rejects any segment that
**starts with** "new", not just the `/commission/new` form. The metro seed includes `new-braunfels-tx`
(`prisma/seeds/metros.ts`, child of San Antonio), and `findOrCreateMetro` will auto-create
`new-york-ny`, `newark-nj`, `new-orleans-la`, `new-haven-ct` and so on. The sitemap lists
`/commission/${metro.slug}` (`src/app/sitemap.ts:350`). For these metros, signed-out visitors and
Googlebot are redirected to sign-in, so the page can't be indexed.
Fix: `"/commission/((?!new$)[^/]+)"` (or list `/commission/new` as the only protected form) plus a test
with `new-braunfels-tx`.

## #92 — LOW (hardening, reviewer-traced) — middleware skips every page path that contains a dot

`src/middleware.ts` config matcher is `"/((?!_next|.*\\..*).*)"`, the old Clerk example, which skips any
page path containing a dot anywhere. API routes are still covered by the second matcher entry, but dynamic
page routes are not: `/admin/cases/x.y`, `/admin/orders/x.y`, `/dashboard/orders/x.y`,
`/messages/x.y`, etc. skip geo-blocking, the Terms gate, the banned-account gate and the admin role/PIN
checks. I checked whether this opens an admin PIN bypass: it does not today. The only admin pages with
dynamic segments (`/admin/cases/[id]`, `/admin/orders/[id]`) call `requireAdminPageAccess()`, which
re-checks role and PIN, and the Order server actions (`src/app/admin/actions.ts`,
`refundReconciliationActions.ts`) re-check the PIN themselves. The admin actions that rely on middleware
alone for the PIN (`/admin/blog`, `/admin/broadcasts`, `src/app/admin/support/actions.ts`) live on
static paths, which middleware always covers. Separately, Clerk's `auth()` should throw when it can't
detect `clerkMiddleware` (not confirmed from source: no `node_modules` locally). So this is fragile, not
exploitable: the first admin page with a dynamic segment and a middleware-only PIN check would be.
Also make the blog/broadcasts/support actions check the PIN locally, matching the Order actions.
Fix: use Clerk's current matcher, which only skips real static-file extensions:
`'/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)'`,
and add a test that `/admin/cases/x.y` is matched.

## #93 — MEDIUM (privacy) — the Commission Room "Near me" distance lets anyone locate a buyer's pin (verified)

`POST /api/commission` (`src/app/api/commission/route.ts:190-218`) copies the buyer's **raw**
`SellerProfile.lat/lng` into a local request. It ignores the privacy radius the maker may have set to hide
their location (seller pages and JSON-LD honour that radius). The board's Near me tab
(`src/app/commission/page.tsx:157-167, 500-502`) then shows `Math.round(distance / 1609)` miles from the
viewer's own profile location. The viewer can move their location freely: `/dashboard/seller` allows
30 updates per 10 minutes (`sellerProfileRatelimit`), and #85 means no range check. Reading the distance
from three points, then nudging until the rounded mile value flips, trilaterates the buyer's stored pin
to well under a mile. Makers usually work from home, so this is often a home address.
Fix: store a coarse point for local requests (metro centre, or the same jittered point the seller map
uses, or a ~5 km grid), and show distance buckets ("within 10 mi", "10-25 mi", "25-50 mi") rather than
whole miles.

## One more LOW

- **Newsletter confirmation can be used to mail-bomb an address.** `POST /api/newsletter` is limited per
  IP (5/min) and per address only by a 15-minute resend cooldown
  (`NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS`). From rotating IPs one victim can receive ~96
  confirmation emails a day, and those sends go direct, not through the outbox's per-recipient daily cap.
  That also hurts sender reputation. Add a per-address daily cap (e.g., 3/day).

Verified clean: admin support status action (status CAS, closure evidence required for data requests,
audit co-committed), processed image upload (Sharp re-encode strips EXIF, pixel limit), seller vacation
route, email outbox claim/lease (stale reclaim plus Resend idempotency key), the only raw-unsafe SQL
(commission near-me, all values bound).

## #94 — MEDIUM-HIGH (privacy, unauthenticated) — the public browse radius filter reveals every seller's exact stored location (verified)

`src/app/browse/page.tsx:264-310` accepts `lat`, `lng` (any decimal precision) and `radius` (1-500 mi)
from the URL, and filters sellers by haversine distance against **raw** `SellerProfile.lat/lng`. It
does not look at `radiusMeters` (the privacy radius) or `publicMapOptIn`. `/browse` is public. So an
anonymous visitor can binary-search: fix `radius=1`, slide the centre until a seller's listings
appear/disappear, find three boundary points, and solve for the circle's centre — the seller's stored
pin, to within metres. Makers usually set this pin by searching their street address.
This contradicts:
- the seller UI, which hides the pin "for privacy" when a radius is set (`LocationPicker.tsx:139`) and
  says only the "approximate area" is shown (`SellerLocationSection.tsx`);
- the Privacy Policy (`src/app/privacy/page.tsx:141-144`): "Your precise GPS coordinates are stored
  securely but only your approximate location (city/region level) is displayed publicly".
#93 is the same leak through the Commission Room, for buyers.
Fix: run location filters against a coarse point, never the raw pin. Options: the privacy-jittered
display point for sellers with a radius, the metro centre, or a grid cell (~5 km); and enforce a minimum
radius well above the grid size. Add a test that a seller with `radiusMeters > 0` can't be localised
below that resolution.

Doc mismatch (LOW): the same Privacy Policy sentence is also wrong in the other direction. Sellers who
set radius 0 and opt in to the makers map are shown as an exact public pin, not "city/region level".

## #95 — HIGH (privacy, no attack needed) — seller and listing pages ship the seller's exact coordinates in the page source (verified)

When a seller offers local pickup, `src/app/listing/[id]/page.tsx:361-363, 805-810` and
`src/app/seller/[id]/page.tsx:243-246, 898-915` pass the **raw** `SellerProfile.lat/lng` as props to
`DynamicMapCard`, a `"use client"` component (`MapCard.tsx`). React serializes client-component props
into the HTML payload, so the exact pin is readable in view-source by anyone, signed in or not. The
privacy jitter (`jitterAround`, `MapCard.tsx:84-90`) runs in the browser after the raw values have
already been delivered. The seller page even tells the visitor "Approximate area... Exact pickup details
shared after purchase" (`seller/[id]/page.tsx:903-905`).
This defeats the privacy radius for every seller who offers pickup and set a radius, and contradicts the
Privacy Policy sentence quoted in #94. JSON-LD was already fixed to omit `geo` for these sellers, so
this looks like the same rule missed on the map path.
Fix: compute the display point on the server. For sellers with `radiusMeters > 0`, pass only the
jittered centre (seeded by seller id so it doesn't drift between renders) and the radius; never send
the raw pin to the client. Add a test that the listing/seller page payload doesn't contain the raw
coordinates when a radius is set. The seller page currently passes no `seed`, so it re-jitters with
`Math.random` on every render. Once the jitter moves server-side it must be seeded, or averaging many
page loads recovers the true point.
Related: #93 (Commission Room distance) and #94 (browse radius filter) leak the same pin through
oracles; this one needs no effort at all.

## More LOW items (same round, continued)

- **Account-deletion cleanup is slow for large sellers.** At deletion, only 50 audit redactions and 50
  media deletions run inline (`src/lib/accountDeletion.ts:1568, 1585`, `take: 50`). The cron handles 20
  rows per run, one at a time, twice an hour (40/hour across all users, FIFO by `createdAt`). A seller
  with a few hundred photos (each `Photo` has `url` and `originalUrl`) keeps public CDN images for hours
  after deleting their account, and one very large deletion delays retries for everyone behind it.
  Consider a larger/parallel batch for `MEDIA_DELETE`, or per-user fairness.
- **`preferredCarriers` is not allow-listed.** `/dashboard/seller` stores any strings from the form
  (`formData.getAll("preferredCarriers")`) with no count or length cap. The quote route matches them with
  substring `includes`. Restrict to `UPS/USPS/FedEx/DHL`.

Verified clean: blog featured listings (write restricted to the author's ACTIVE listings, render filtered
by `publicListingWhere` and blocks), blog edit ownership, private reserved listing visibility
(`canViewListingDetail`), back-in-stock fanout (public-visibility recheck plus per-subscriber claim),
message thread client props (only name/avatar of the other user), map-card API (opted-in sellers only),
makers maps (opted-in, radius 0 only).
- **Commission APIs return the buyer's full name.** The Commission Room pages deliberately show only the
  first name (`name?.split(" ")[0]`, `commission/page.tsx:442`, `commission/[param]/page.tsx:276, 441`),
  but `GET /api/commission` (`route.ts:101`) and `GET /api/commission/[id]` (`route.ts:71, 100`) return
  `buyer.name` unchanged to any signed-in user. Trim to the first name server-side in both.

## #96 — MEDIUM (product fairness) — Guild Masters are warned and revoked for "0%" when there is simply no data (verified)

`src/lib/metrics.ts:190-202` sets `onTimeShippingRate = 0` when no orders shipped in the period, and
`responseRate = 0` when no buyer started a conversation. `meetsGuildMasterRequirements`
(`src/lib/metricsState.ts:48-55`) compares these to 95% and 90% with no "no data" case. The monthly cron
(`src/app/api/cron/guild-metrics/route.ts:206, 291`) uses that result to warn and then revoke. So a
Guild Master with a quiet rolling window (the default is 3 months) gets an email saying their response
rate or on-time rate is 0%, and is revoked 30+ days later if the quiet period continues. Cases that
trigger it:
- no buyer-initiated messages in the window (common for small makers);
- all sales in the window were local pickup (pickup orders never get `shippedAt`, so they are left out
  of the shipping denominator entirely);
- no sales at all in the window.
A pickup-only maker can never reach Guild Master in the first place.
Fix: treat an empty denominator as "not enough data": skip that criterion for revocation (and show "no
recent data" in the dashboard), or require a minimum count before the rate is judged.

LOW (metric definition, same code): the on-time denominator
(`20260905170000_correct_order_authority_composition`, lines 862-878) counts only orders **shipped** in
the period. An order that is past its ship-by date and still unshipped doesn't count as late until it
ships. Open cases usually catch the worst of this (Guild Master requires zero active cases), but the
rate itself overstates on-time performance.

Related LOW (same metric family): `grainline_seller_message_response_metrics`
(`20260726022500`) counts every new conversation the other person started as "buyer-initiated",
including users the seller has blocked and accounts that were later banned or deleted. The seller cannot
reply to any of those (sends are blocked), so blocking a harasser or receiving spam lowers the seller's
Guild response rate. Exclude conversations where either side has blocked the other or the counterparty
is banned/deleted. (Also note: conversations are one per user pair forever, so a returning buyer's new
question in an old thread never counts.)

## #97 — LOW-MEDIUM — out-of-order Clerk `user.updated` webhooks overwrite newer email/name with stale values (verified)

`src/app/api/clerk/webhook/route.ts:230-305` applies every `user.created`/`user.updated` event directly
(`ensureUserByClerkId(id, { email, name, imageUrl })`). Nothing compares the event's `updated_at` with
what is stored, and `ensureUserByClerkId` (`src/lib/ensureUser.ts:29`) has no ordering input. Svix
retries and parallel delivery can deliver an older event after a newer one (Clerk's docs say to expect
this). Effects:
- the local `User.email` goes back to the old address, so order, case and account emails go to an
  address the user just removed (and account export/deletion key off the wrong current email);
- `shouldRevokeSessionsForClerkEmailChange` sees an "email change" again and revokes the user's sessions
  a second time;
- name/avatar flip back.
It self-heals only on the next profile change. Fix: store the last applied Clerk `updated_at` on `User`
and ignore events that are not newer (or re-fetch the user from the Clerk API on each event and apply
current state rather than the payload).
- (Addendum to the cart-retry LOW above.) Buy Now already handles the same lost-response case:
  `BuyNowCheckoutModal` calls `/api/cart/checkout/single/resume` when it opens and reuses the open
  session. The cart page's retry button has no equivalent, so the fix can follow the Buy Now pattern.
  Verified clean in the modal: `onComplete` sets `completedRef` before navigating, so `pagehide` can't
  roll back a paid session, and the rollback route refuses to expire paid/complete sessions anyway.
- **Onboarding skips city/state sanitization.** `saveStep2` (`src/app/dashboard/onboarding/actions.ts:118-119`)
  stores `city`/`state` with `truncateText` only, while `/dashboard/seller` runs `sanitizeText` and caps
  state at 50. Bidi and zero-width characters therefore reach public location text (listing cards,
  seller pages, maps), and a state longer than 50 characters hits the `VarChar(50)` column as a generic
  error. `advanceStep(NaN)` from a forged action call also becomes a Prisma error rather than a clean
  rejection. Reuse the settings-page helpers.
- **Blog comments ignore blocks.** `POST /api/blog/[slug]/comments` doesn't check blocks between the
  commenter and the post author or parent-comment author. Comments need staff approval and readers who
  blocked the commenter don't see them, so the impact is a blocked user getting a reply approved into a
  thread started by the person who blocked them. Reject at write time, like the follow/favorite routes.

Verified clean: Stripe Connect v2 webhook (signature, stale-event rejection, fenced reservation,
closed-account path expires sessions), follow API (visible-seller predicate, self and block checks,
origin guard), blog comment parent validation (same post, approved, active author, depth flattening).

---

# Status check 2026-09-28 (main `dc0f3c3a`, PRs #465–#472)

Verified from origin/main, GitHub runs and Codex's checkpoint notes (read only for IDs/outcomes).

**Production state**
- Core Order ENABLE ran 2026-09-28 00:44Z (run `36363328661`, commit `c09c678f`), success. Order is
  now ENABLE (not FORCE); OrderItem and OrderShippingRateQuote unchanged. The post-enable smoke
  expectation was updated in #470.
- Case corrections (`20260901161000`, `20260928010000`) applied by run `36409822924` via
  `prisma migrate deploy`; the files on main match the workflow's pinned checksums.
- The live site still serves app source `4ee0911d` (deployment `dpl_DCxKF5x…`; the ENABLE gate
  checked `dpl_FKdRWV3J8…`, same source). Neither `4ee0911d` nor current main has any direct Order
  table access, Prisma relation filter through `order`, or raw `"Order"` SQL, so ENABLE doesn't break
  either app. Foreign-key checks aren't subject to RLS.
- The staged candidate from `83f948e2` failed its smoke at seller label purchase (Shippo:
  `address_from.phone must not be empty`); #472 adds the sender phone. The next candidate isn't promoted
  yet. Until then, **everything merged since `4ee0911d` is not live**, including the location-privacy
  fix below, and live label purchase can't succeed (the live app sends neither sender email nor phone).

**Findings closed**
- **#86 fixed.** `20260901161000` adds `labelClaimStatus IN (PROVIDER_PENDING, PROVIDER_AMBIGUOUS,
  PROVIDER_RECORDED)` to both checks in `grainline_case_staff_resolution_prepare` and to
  `..._reconcile`. The fourth claim state, FINALIZED, is already blocked by `labelStatus='PURCHASED'`
  unless voided. NULL correctly means "no claim".
- **#81 addressed.** `sellerDeauthorizedAt` is still never cleared, but it is per-order, set only on
  orders paid before a Stripe v2 `account.closed` (terminal) that weren't yet delivered, so keeping the
  hold is defensible. The buyer impact is fixed: `grainline_case_open` (`20260928010000`) lets the buyer
  open a Case before shipping and past the window while the order is still unshipped. The new
  `grainline_order_buyer_detail_v4` exposes matching flags and the buyer order page mirrors the DB rule.
- **#82/#83 resolved.** #465 pins and checks the serving deployment before ENABLE, and both the live
  source and main were confirmed free of direct Order access (above).
- **#93, #94, #95 fixed on main (#466), not live yet.** New `src/lib/locationPrivacy.ts`:
  - sellers with a radius get a grid-cell centre with cell side = radius (many-to-one, not reversible;
    the true point stays inside the drawn circle);
  - radius-0 sellers not opted into the map get a ~5.5 km (1/20°) grid;
  - opted-in radius-0 sellers stay exact, by consent.
  Listing and seller pages compute this on the server and send only `displayLat/displayLng` (no raw
  coordinates remain in client props; JSON-LD `geo` still only for opted-in radius 0). Browse filters
  on the same projected point in SQL; I checked the SQL cell arithmetic matches the JS helper. New
  commission requests store a ≥5 km cell centre, the near-me query re-snaps stored points to the grid
  (covering old rows), and the badge shows buckets (10/25/50 mi).

**Small follow-ups (LOW)**
- Old `CommissionRequest` rows still hold precise coordinates in the database. They're no longer shown
  or usable as an oracle, but a one-off backfill to the cell centre would remove them.
- Intersecting cells: if a seller changes their radius, an observer who saw both cell centres can
  intersect the two cells. Minor; consider snapping to the larger of old/new radius or rate-limiting
  changes.
- `SHIPPO_LABEL_SENDER_PHONE` is a new required production variable (`requiredProductionEnv`) and is in
  `docs/launch-checklist.md`, but not in CLAUDE.md's required-environment list.
- Process: `20260901161000` was created on 2026-09-28 with an early-September timestamp. I verified it
  is safe (no later migration redefines either function), but on a fresh database a back-dated
  migration runs before migrations that production applied earlier; if a later one ever redefined the
  same function, fresh databases and production would silently differ. Prefer current timestamps.

---

# Broad round continued (2026-09-28, main `dc0f3c3a`)

## #98 — MEDIUM (privacy/abuse/cost) — upload cleanup has never run in production; removed and abandoned media stays public (verified)

The Vercel cleanup cron was retired before DirectUpload activation, and cleanup moved to the protected
GitHub workflow `.github/workflows/direct-upload-cleanup.yml`, which is `workflow_dispatch` only (no
`schedule`). The runbook (`docs/runbook.md` ~1433-1442) and `STRATEGY.md:1565` say the hourly schedule
ships "in a separate release" after activation and cleanup-role postflight. Those finished on
**2026-08-04** (runs `30877508811`, `30924905247`), but the schedule release never happened, and
`gh run list --workflow direct-upload-cleanup.yml` shows **no runs at all**. `/api/cron/ops-health`
doesn't watch the DirectUpload backlog either. For about eight weeks, nothing has deleted:
- media whose references were released: deleted review photos, replaced or removed listing photos,
  removed avatars/banners, deleted blog covers. These were public, and their URLs keep serving;
- presigned uploads that were never verified or claimed. Files go into the **public** bucket at PUT
  time, before verification (`src/app/api/upload/presign/route.ts`). Any signed-in user can host a PDF
  (8 MB, `messageFile`) on Grainline's CDN domain indefinitely, e.g. a phishing PDF; sellers can do the
  same with 128 MB videos (#33). Volume is limited only by the upload rate limits. (Presign signs the
  Content-Type, so HTML can't be served.)
The runbook describes this gap as "bounded" and says objects "accumulate but are not lost or exposed";
that's not true for previously published media, and it hasn't been bounded.
Fix: ship the hourly schedule (and a first verified pass), add a DirectUpload backlog check to
ops-health (e.g. rows past `cleanupAfter`), and consider presigning into a private staging prefix that
only becomes public on verification.

## Other items (LOW)

- **Turning off "accepting new orders" doesn't expire open checkout sessions.** `updateSellerProfile`
  (`src/app/dashboard/profile/page.tsx`) writes `acceptingNewOrders` with no checkout-session expiry,
  unlike vacation mode (`/api/seller/vacation`), deauthorization and listing hide/sell. The paid-checkout
  function then rejects the order as invalid (`20260926011000:321`), so a buyer who was already paying
  gets charged and automatically refunded, and the platform loses the Stripe processing fee (not returned
  on refunds). Queue `expireOpenCheckoutSessionsForSeller` when the flag goes from true to false.
- **Profile numbers are unbounded.** `/dashboard/profile` stores `yearsInBusiness` and
  `customOrderTurnaroundDays` via plain `parseInt` with no range and no DB CHECK, so a seller can
  display "500 years crafting" (or a negative number) on their profile and the homepage spotlight.
  Onboarding clamps years to 0-100 (`onboarding/actions.ts:117`); a value above 2^31 makes the save
  throw.
- **Gallery alt texts can shift.** The same action pairs `formData.getAll("galleryAltTexts")[index]`
  with the *filtered* `galleryImageUrls`; if verification drops one image, later images get the wrong
  alt text. (Same pattern as the listing photo originals item.)
- **Broadcast fanout isn't durable and isn't paged.** `POST /api/seller/broadcast` loads up to 10,000
  followers (`take: 10000`, no order) and sends in-app notifications and outbox emails inside `after()`.
  The route sets no `maxDuration`. A large following can be cut off partway with no record of who was
  reached, and followers past 10,000 are skipped silently. Blog and listing fanouts already use paged
  helpers; move broadcasts to the same pattern.
- **Presign `fileIndex` is client-supplied**, so the per-endpoint count limit in presign is advisory
  only. The real caps are applied when media is saved; mentioned for completeness.

Verified clean: profile FAQ add/delete (owner-scoped, capped, serializable), avatar removal, featured
listing toggle (owned listings only; public rendering filters non-public ones), broadcast recipient
selection (reciprocal blocks, banned/deleted excluded, preferences respected, source rechecked in
`after()`), presign validation (seller-only endpoints, images forced through the processed route, type
and extension allow-lists, size cap, lifecycle row recorded).
- **Unban loses the seller's pre-ban vacation state.** `unbanUser` (`src/lib/ban.ts:350-356, 408-414`)
  sets `vacationMode = !chargesEnabled`. A seller who was on vacation before the ban comes back *off*
  vacation and immediately orderable. The 24-hour undo path (`src/lib/audit.ts:268-271`) restores the
  saved `previousSellerProfile` snapshot, so the two paths disagree; reuse the snapshot in `unbanUser`.
  (Unban also writes `chargesEnabled` directly with a stricter formula than
  `mirrorStripeChargesEnabled`, so the next Connect reconcile may flip it again.)
- **Any employee can waive the Guild Member sales requirement.** `approveGuildMember`
  (`src/app/admin/verification/page.tsx:178-182`) uses `requireStaff()` and honours the "admin override"
  checkbox for EMPLOYEE as well as ADMIN, while reinstatement and featuring are `requireAdminOnly()`.
  If the override is meant as an admin decision, check the role when `adminOverride` is set.

Verified clean: upload verify (key ownership, signed token, size/type, magic bytes, public
availability, lifecycle row; deletes the object on every failure), Guild Member approval (server-side
eligibility, status CAS, account-state guard, audit co-committed), Guild Master approval (requires fresh
cached metrics and re-checks every criterion).
- **Stale middleware exemption for case escalation.** `src/middleware.ts:75, 203` still makes
  `/api/cases/[id]/escalate` public and geo-exempt ("route verifies session or CRON_SECRET"). The route
  no longer has a cron/bulk path: it requires a signed-in user (`escalate/route.ts:73-77`). Remove it
  from `isPublic` and `isGeoAllowedApiPath` so the normal signed-in, US-only rules apply.

Verified clean: global search suggestions (public predicates, blocks, transaction-local trigram
threshold), notification read routes (origin guard, rate limit, owner-scoped fixed functions), listing
edit bumps `priceVersion` on price/variant change, checkout success (primary session checked with
Stripe, others read buyer-scoped, IDs de-duplicated), staff Order read connection (role, pooled
endpoint and same-database checks).
- **Origin guard coverage is partial (defence in depth).** CLAUDE.md applies
  `getExplicitCrossOriginPostRejection` to cart/checkout/money/interaction routes, but these signed-in
  mutating routes don't call it: `account/accept-terms`, `account/notifications/preferences`,
  `account/shipping-address` (PII write), `blog/[slug]/comments`, `commission` and `commission/[id]`,
  `listings/[id]/stock`, `reviews`, `reviews/[id]`, `reviews/[id]/reply`, `seller/broadcast`,
  `seller/vacation`, `stripe/connect/create|dashboard|login-link`, `upload/image|presign|verify`,
  `verification/apply`. Clerk's `__session` cookie is `SameSite=Lax`, so ordinary cross-site POSTs
  carry no session. The explicit check matters for same-site origins (any `*.thegrainline.com`
  subdomain). Admin routes are covered by the `SameSite=Strict` PIN cookie; the public
  report/newsletter/support/analytics routes are intentionally unguarded. Low priority, but a single
  shared wrapper would make this uniform.
- **Doc/ops: Cloudflare WAF isn't in front of the site.** CLAUDE.md's security table says "Cloudflare WAF
  free tier active (DDoS protection)". A request to `https://thegrainline.com/` returns
  `server: Vercel` and `x-vercel-id`, with no `cf-ray`, so the apex isn't proxied through Cloudflare
  (DNS only) and the WAF doesn't see this traffic; Vercel's own mitigation applies. Correct the doc (or
  proxy deliberately). Upside: `getIP()` trusting the first `x-forwarded-for` entry is sound, because
  Vercel sets that header.
- **Message attachments are public URLs.** Direct-message images/PDFs (`messageImage`, `messageFile`,
  `messageAny`) go into the public bucket with unguessable keys; only Case evidence uses the private
  bucket. The Privacy Policy doesn't promise otherwise. Combined with #98 (no cleanup), attachments in
  private conversations stay reachable by URL indefinitely. Now that a private storage class exists,
  consider it for message attachments.

Verified clean: Terms acceptance (version pinned to `CURRENT_TERMS_VERSION`, audit co-committed,
account-state cache invalidated).

## #99 — MEDIUM (availability/policy) — the public address-autocomplete proxy can exhaust Grainline's single Nominatim budget (verified; policy point needs confirming)

`GET /api/address/autocomplete` (`src/app/api/address/autocomplete/route.ts`) is public, needs no
sign-in, caches nothing, and is limited per IP by `searchRatelimit` (30 per 10 s, ~3/s). Every request
takes the site-wide Nominatim lock (`redis.set(..., { nx: true, px: 1100 })`), i.e. a global budget of
under one request per second shared with seller metro geocoding (`reverse-geocode.ts`). A single
client typing (or a script) can keep that lock busy, so:
- checkout and seller address autocomplete stop returning suggestions for everyone else (fails closed);
- reverse geocoding for new seller locations fails, so metros aren't assigned.
Separately, to my knowledge the OSMF Nominatim usage policy says autocomplete must not be built on the
public API. Grainline debounces at 350 ms from 2 characters, which is autocomplete. Heavy or
policy-violating use can get Grainline's server IP / User-Agent blocked, which would take reverse
geocoding down with it. Please confirm against the current policy text.
Fix: move autocomplete to a provider that allows it (or self-host), cache results by normalised query,
require a signed-in user or a much tighter per-IP limit, and keep the shared Nominatim budget for
server-side reverse geocoding only.

LOW (CSP tidy-up): `connect-src` still allows `https://nominatim.openstreetmap.org` and the Upstash host
`https://major-toad-67912.upstash.io`, but no client code talks to either (only
`api/address/autocomplete` and `lib/reverse-geocode.ts` call Nominatim, server-side). Remove both.

## #100 — MEDIUM (functional, live) — an open conversation stops updating after ~13 minutes and shows a rate-limit error (verified)

`src/app/api/messages/[id]/stream/route.ts` has `maxDuration = 60` and never ends on its own, so Vercel
cuts every stream at 60 s. The client (`src/components/ThreadMessages.tsx:302-308`) treats any stream
error as permanent: it closes the `EventSource` and falls back to polling `/api/messages/[id]/list`
every **3 s** for as long as the tab is open (no backoff, no pause when hidden). That route is limited
by `messageListRatelimit`, **240 per 60 minutes** per user (`src/lib/ratelimit.ts:90-93`, since
`c6406ceb` on 2026-05-14). 240 ÷ 20 polls/minute ≈ 12 minutes, so ~13 minutes after opening a thread
(1 min stream + 12 min polling; about half that with two tabs) `/list` returns 429. The client treats
429 as terminal (`isTerminalMessageStreamStatus`): polling stops and the thread shows "too many
requests". The same limiter covers "load older messages" and the refresh after sending
(`ThreadMessages.tsx:171, 208`), so those fail too, and the sliding window keeps them blocked for up to
~48 more minutes. Messages still send, but the thread silently goes stale.
Cost side: every thread view is at least one 60-second function invocation plus a request every 3 s
thereafter, per open tab.
Fix (pick one): have the stream end cleanly before 60 s with a "reconnect" event and let the client
reopen it instead of falling back for good; or make polling adaptive (back off when idle, pause on
`visibilitychange` like `NotificationBell`), and size `messageListRatelimit` for it; and don't share one
limiter between background polling and user actions.

## More LOW items (rate-limit budgets vs. client behaviour)

- **Carts with ~10 or more sellers can't check out.** `handleProceedToPayment`
  (`src/app/cart/page.tsx:748-795`) creates one Stripe session per seller in sequence, and the page also
  calls `/api/cart/checkout/resume` on load; all of these share `checkoutRatelimit` at **10 per 60 s**.
  Nothing caps the number of sellers in a cart (50 distinct items allowed). The 10th-11th seller gets 429
  and the catch block rolls back every session already opened. A retry within a minute after any failure
  fails sooner. The shipping step has the same shape (one quote per seller, 20 per 60 s). Either cap
  sellers per checkout with a clear message, or budget the limiter per seller.
- **Stock saves share the listing-mutation budget.** `/api/listings/[id]/stock/adjustments` re-exports
  the stock `PATCH`, which uses `listingMutationRatelimit` (**60 per hour**), the same budget as
  hide/publish/mark-sold and listing edit saves. A seller with more than ~60 in-stock listings can't
  update all their counts in an hour (e.g. after a craft fair). Give inventory saves their own budget.

Checked and fine: the notification bell (adaptive 60 s / 5 min / 15 min polling against 120 per 10 min),
the unread badge (10-minute polling).

## #101 — MEDIUM (privacy) — sellers see buyers' email addresses whenever the buyer has no name (verified)

`src/lib/sellerFacingUser.ts` falls back to the email in both helpers:
`sellerFacingUserLabel` returns `user.name ?? user.email ?? fallback` (line 13) and
`sellerFacingOrderBuyerLabel` returns `order.buyerName ?? order.buyerEmail ?? fallback` (line 33). They
render on:
- `src/app/dashboard/sales/page.tsx:228` and `dashboard/sales/[orderId]/page.tsx:217` (orders);
- `src/app/api/seller/analytics/recent-sales/route.ts:61` (analytics);
- `src/app/dashboard/listings/custom/page.tsx:337`: the email of **anyone who sent a custom-order
  request**, with no purchase involved.
A user who signs up with email only has no `name`, so this is the common case, not an edge case. The
Privacy Policy (`privacy/page.tsx` §4 and §4.6) says only the buyer's name and shipping address are
shared with the maker, and that makers may not contact buyers outside the platform; handing over the
email undercuts both. CLAUDE.md's cross-user display rule also says not to derive labels from email.
Fix: never fall back to email in seller-facing labels. Use the shipping name for orders
(`quotedToName`/`shipToName`) and a neutral "Buyer" otherwise, and add a test that a nameless buyer's
email never appears in these pages or the API response.
Addendum to #101: the email comes from the database, not just the UI helper. The seller order-detail
projection (`20260926012200_correct_order_seller_deauthorization_projection`, `buyer_email` column,
line ~150) and the seller recent-sales analytics authority (`20260905170000`, read in
`src/lib/orderSellerAnalyticsState.ts:215`) both return the buyer's email to the seller. The seller's
*account export* deliberately excludes buyer PII (`SELLER_KEYS` in `orderParticipantExportState.ts`),
which suggests the projection exposure is unintended. The fix needs an additive migration that drops
`buyer_email` from both seller projections (replacing it with the shipping name if needed), plus the UI
change above. The buyer-side export of their own email is fine.
- **Staff can read reported private threads without the admin PIN.** `src/app/messages/[id]/page.tsx:60-111`
  lets EMPLOYEE/ADMIN open any thread with an unresolved `MESSAGE_THREAD` report (read-only, correctly
  scoped to unresolved reports). Because the page is under `/messages`, not `/admin`, neither middleware
  nor the page checks the admin PIN, so a stolen staff session alone can read those private
  conversations. Call `requireAdminPageAccess()` (or the PIN check) before entering staff review mode.

Verified clean: stock PATCH (row lock, public-only auto-promotion, audit co-committed, idempotent
receipts), support/data-request forms (5/hour per IP, email only to Grainline inboxes), AI review
prompt (explicitly ignores instructions inside images), `/banned` (static), sitemap (same visibility
helpers as the pages), message inbox/thread name fallbacks (neutral "User"/"Maker"), seller order
confirmation email ("A buyer" fallback, no email).
  (Same gap, lower sensitivity: staff listing preview `/listing/[id]?preview=admin`
  (`src/app/listing/[id]/page.tsx:217-230`) shows drafts and private reserved listings on role alone,
  without the PIN. The Case API routes do enforce the PIN for staff; these two pages are the
  exceptions.)
- Status re-check: **#50 still open** on `dc0f3c3a`. `updateListing`
  (`src/app/dashboard/listings/[id]/edit/page.tsx:172-303`) has no banned/deleted check of its own;
  only middleware's 60-second account-state cache stands in front of it.
- **Some user-facing dates still render in UTC on the server.** CLAUDE.md moved order/notification
  timestamps to the client `LocalDate` component, but these server components still call
  `toLocaleDateString("en-US")` (UTC on Vercel): review and seller-reply dates
  (`ReviewsSection.tsx:263, 345, 397`), blog post and comment dates (`blog/[slug]/page.tsx:281, 486`),
  order dates and saved-search dates on `/account` (`account/page.tsx:206, 293`), saved searches on the
  dashboard (`dashboard/page.tsx:744`). An order placed at 8 pm Central shows the next day's date.
  Cosmetic; use `LocalDate`.

## #102 — LOW-MEDIUM (supply chain) — Dependabot branches get Vercel preview builds with Preview secrets (verified in part; Vercel env not visible to me)

`vercel.json` disables Git deployments for `main` and 36 named branches but has no wildcard default,
so any other branch still gets an automatic preview build. Dependabot PR #261
(`dependabot/npm_and_yarn/minor-and-patch-…`) shows a `Vercel` check, so Vercel does build Dependabot
branches (that one failed). Vercel runs `npm install` with package lifecycle scripts enabled and the
Preview environment variables available; CI uses `npm ci --ignore-scripts`, Vercel does not. A
compromised package in an automated dependency bump would therefore run with whatever Preview holds.
CLAUDE.md says the Upstash Redis credentials were set for production **and** preview, which means the
production rate limiter and checkout-lock store (the locks hold Stripe client secrets). I can't inspect
the Vercel environment, so please confirm what Preview contains.
Fix: add a default `"*": false` (or at least `"dependabot/**": false`) to `git.deploymentEnabled` and
build only reviewed candidates, and make sure Preview has no production credentials (separate Upstash
database, test-mode keys only).

LOW (CI hygiene): GitHub Actions pinning is mixed. Newer production workflows pin `actions/*` by commit
SHA; older credential-holding ones (e.g. `direct-upload-cleanup.yml`, `order-compatible-production.yml`,
the `order-payment-event-*-production.yml` family) use tags (`@v5`, `@v7`). Only GitHub-owned actions
are used, dependencies install with `--ignore-scripts`, and secrets are step-scoped, so the risk is low;
pin everything by SHA for consistency.

Also re-verified #98: `gh api .../actions/workflows/direct-upload-cleanup.yml/runs` returns
`total_count: 0`. The "Production DirectUpload Cleanup" environment deployments on 2026-09-21 and in
August came from other workflows that share that environment (e.g. R2 cleanup key identity, activation
postflight), not from the cleanup workflow.

Verified clean: workflows (no `pull_request_target`, no untrusted PR text in shell, dispatch inputs
passed via `env:`, no write permissions, `npm ci --ignore-scripts` before any secret is in scope), feed
pagination (compound timestamp+ID cursor), similar-listings SQL (parameterized, public and block
filters), Buy Now resume (lock key bound to the buyer), admin ban route (admin-only, no self-ban, no
banning admins).
Addendum to #102: the build-time guard (`scripts/guard-runtime-db-env.mjs`) runs as the build command,
i.e. after `npm install` and its scripts. For `VERCEL_ENV=preview` it only requires a pooled, non-owner
`DATABASE_URL` (lines 97-116); it does not reject the reviewed **production** endpoint in a preview
build. If Preview's `DATABASE_URL` is the production runtime credential, every preview (including
Dependabot branches) connects to production. Consider refusing the production endpoint ID when
`VERCEL_ENV !== "production"`.

---

# PR #473 review (main `95ea15bd`, 2026-09-28)

"Use seller contact for shipping labels": the Shippo sender phone now comes from a new seller field
instead of the `SHIPPO_LABEL_SENDER_PHONE` platform env var.
- `20260928020000_correct_order_label_sender_contact` adds nullable `SellerProfile.shipFromPhone
  VARCHAR(30)` with CHECK `^[+][1-9][0-9]{7,14}$`, and replaces only
  `grainline_order_seller_label_preflight`. The diff against `20260926012100` is exactly two added
  guard lines (NULL-safe: blank/NULL phone rejected before the regex) and the `phone` key in the
  returned ship-from object. Grants are re-applied to the runtime role only.
- `/dashboard/seller` validates E.164 before saving, the app parses the phone again
  (`orderLabelAuthority.ts` `senderAddress`), account deletion clears it and adds it to the redaction
  values, and account export includes it.
- Adding a nullable column is backward compatible with the live app (`4ee0911d`), whose label purchase
  can't succeed anyway (no sender email/phone). The migration must be applied before the new app build
  is promoted, since the new Prisma client selects the column. Its production workflow run
  `36475533471` was waiting for environment approval at 19:55Z.
Verdict: sound.

Follow-ups (LOW):
- **The Privacy Policy never mentions phone numbers.** It now needs to cover the seller's shipping
  phone (sent to Shippo and possibly printed on labels the buyer receives), and it already should have
  covered the buyer's optional checkout phone (`User.shippingPhone`, `Order.quotedToPhone`). The Shippo
  sub-processor line (`privacy/page.tsx:322-324`) says only "name and address".
- **Phone format UX.** The field requires strict E.164 ("+15125550123"); a US seller typing
  "(512) 555-0123" gets an error. Normalize common US formats to `+1…` before validating.

## #103 — LOW-MEDIUM (privacy/retention) — buyer address, phone and gift note are copied into Stripe metadata, beyond the 90-day prune (verified)

The Stripe Checkout Session metadata written by `src/app/api/cart/checkout-seller/route.ts` (~lines
600-612; the Buy Now route has the same shape) includes `quotedToName`, `quotedToLine1/Line2`,
`quotedToCity/State/PostalCode`, `quotedToPhone` and `giftNote`. Stripe keeps session metadata
indefinitely, shows it in the Dashboard to anyone with access, and repeats it in event payloads and
webhook logs. The local 90-day buyer-PII prune can't reach any of that, and the Privacy Policy's
retention section (`privacy/page.tsx:600-609`) covers carriers but doesn't say Stripe holds the full
address, phone and gift note. The webhook and the resume endpoints read the address back from this
metadata. Grainline already stores a durable per-checkout record (`CheckoutStockReservation` with its
source snapshot, keyed by `checkoutReservationId` in metadata).
Fix: keep the address/phone/gift note server-side (on the reservation or a short-lived checkout row)
and put only the reservation ID in Stripe metadata; or at minimum disclose that Stripe retains these
fields.

## #104 — LOW-MEDIUM — dashboard hide / mark-sold / archive don't expire open checkout sessions; the shop-page versions do (verified)

CLAUDE.md: open Stripe Checkout Sessions are proactively expired when an active listing leaves buyer
availability through hide, mark-sold or archive. The seller shop page does this
(`src/app/seller/[id]/shop/actions.ts:141, 175, 196`, sources `listing_hide`, `listing_mark_sold`,
`listing_archive`). The dashboard's own actions for the same three transitions do not:
`setStatus` (`src/app/dashboard/page.tsx:38-101`, HIDDEN and SOLD) and `deleteListing`
(`:103-147`, via `softDeleteListingWithCleanup`, which doesn't expire sessions either). A buyer who is
already paying gets charged, the webhook rejects the order because the listing is no longer ACTIVE,
and the automatic refund costs Grainline the Stripe fee; any reserved stock stays held until the
session expires. Same class as #58 (a fix applied to one of two sibling paths) and the "accepting new
orders" item. Fix: queue `expireOpenCheckoutSessionsForListing` in the dashboard paths, or move it into
a shared helper both surfaces call.

Also noted: admin listing removal (`api/admin/listings/[id]/route.ts:43-45`) hard-deletes other users'
favorites, stock notifications and cart items for the listing; the 24-hour undo can restore the status
but not those rows. Minor, but worth stating in the admin UI.

Verified clean: admin review delete (ADMIN only, rating summary refreshed and audit co-committed in
one transaction), report resolve (staff, reason required, CAS), listing removal (ADMIN, audit
co-committed, sessions expired), dashboard `setStatus` ownership/account checks and status CAS.
- Status re-checks on `95ea15bd`: **#57 still open** (`/api/verification/apply` still writes with a
  plain `makerVerification.upsert` and no current-state predicate, `route.ts:139-152`). The #104 sweep
  found no other listing-status writers that move an ACTIVE listing out of availability without
  expiring sessions: admin review starts from PENDING_REVIEW, new/custom listing create, and account
  deletion handles sessions through its reservation cleanup.
- The #473 production migration (`20260928020000`) completed successfully (run `36475533471`).

## #105 — HIGH (security, needs confirmation) — per the repo's own records, several production secrets exposed on 2026-09-02 have still not been rotated

`docs/comprehensive-credential-exposure-recovery-20260902.md` (status "active recovery"; last changed
2026-09-03/04) lists every secret exposed when local `.env` values were printed into agent output. Its
own completion sections and the per-family docs record these as done: database owner/runtime,
Resend, `CRON_SECRET`, `SHIPPING_RATE_SECRET`, Shippo test, and the Clerk **server** key
(`docs/clerk-server-key-credential-recovery.md`, 2026-09-03). I found no recorded completion for:
- **Clerk webhook signing secret**: `docs/clerk-webhook-secret-credential-recovery.md` says "Provider
  signing-secret rotation remains pending". Holding it lets anyone forge Clerk webhooks, e.g.
  `user.deleted` (anonymizes that account locally when it has no open obligations) or `user.updated`
  (changes a user's stored email).
- **Cloudflare R2 application key pair**: the same `S3Client` serves the public bucket and the private
  Case evidence bucket (`src/lib/r2.ts`). The key can read private evidence, delete any media, or write
  arbitrary objects (including HTML) to `cdn.thegrainline.com`, which is same-site with the app (see
  the origin-guard LOW).
- **Upstash Redis token**: Redis holds the middleware account-state cache
  (`src/lib/accountStateCache.ts`, ban/terms state), checkout locks containing Stripe client secrets,
  the shared Nominatim lock, and every rate limiter.
- **`ADMIN_PIN` and `ADMIN_PIN_COOKIE_SECRET`**: the cookie secret lets anyone mint valid admin-PIN
  cookies, so the PIN layer protects nothing until it's rotated (a staff Clerk session is still needed).
- **OpenAI, Sentry, Stripe test API and primary webhook secrets.** (The Stripe test incident gate doc
  of 2026-09-22 still describes the test cutover as the next action.)
I can only see the repository, not Vercel/Clerk/R2/Upstash, so these may have been rotated without
being recorded. If so, the docs need updating; if not, this is the most urgent open item.

Process point: `STRATEGY.md:60-65` says "Do not run database migrations or broaden RLS while the
remaining Clerk, Cloudflare R2, Stripe test/webhook, Upstash, OpenAI, Sentry, and application-secret
families remain under incident recovery." Since then, Order ENABLE (09-28 00:44Z), the Case
corrections (09-28 10:27Z) and the label sender-contact migration (09-28 19:55Z) all ran. Either that
gate was consciously waived (record it) or the rotations happened (record them).
- **Admin PIN page shows "Incorrect PIN" for non-PIN failures.** `src/components/AdminPinGate.tsx:97-110`
  maps every status except 429 and 503 to "Incorrect PIN". The server returns 403 when the account is
  not ADMIN/EMPLOYEE (or is banned/deleted) and 401 when not signed in
  (`src/app/api/admin/verify-pin/route.ts:72-80`), so a lost staff role looks exactly like a wrong PIN.
  Distinguish 401/403 ("This account doesn't have admin access") from 401-on-mismatch. (Raised when
  Drew's PIN stopped working on 2026-09-28; cause not yet known — possibly the #105 PIN rotation.)

Correction to #105 (same day, from Codex's private checkpoint notes, IDs/outcomes only): the public
docs are stale and more has been rotated than they show.
- **Clerk webhook secret: done**, cutover completed 2026-09-15 (`ACCEPTANCE.md` ~1178).
- **R2 application key: done** ("R2 retirement remains accepted").
- **Admin PIN / cookie secret: rotated 2026-09-21.** The replacement passed old-PIN rejection and
  new-PIN acceptance on production (`CURRENT.md` ~134-141), though the notes list "admin closeout"
  follow-ups (canonical postflight, local parity, GitHub runner proof) as unfinished. This is why
  Drew's old admin PIN now returns "Incorrect PIN".
- **Still open per the notes: Upstash, OpenAI, Sentry, Stripe test API and primary webhook.**
  Upstash is the one that matters for production (account-state cache, checkout locks, rate limits).
Revised severity: MEDIUM. The remaining asks are to rotate Upstash (then OpenAI/Sentry/Stripe test),
update `docs/comprehensive-credential-exposure-recovery-20260902.md` and
`docs/clerk-webhook-secret-credential-recovery.md` so the repo matches reality, and record whether the
STRATEGY.md "no migrations/RLS until recovery completes" gate was waived for Order ENABLE.

---

# PR #474 review and broad RLS sweep (main `3b80fba0`, 2026-09-29)

**Live state.** `3b80fba0` was promoted as `dpl_FpD59NTBtkRj4v1KP5yEjMRdvNdj` at 2026-09-29 01:23Z;
the buyer-email projection migration `20260928213000` was applied at 01:02Z. Everything merged since
`4ee0911d` is now live (location privacy, Case v4, Shippo sender contact, #474).

**PR #474 fixes (verified):**
- **#100 fixed.** The stream sends `event: reconnect` at 50 s and closes; the client reopens from the
  latest cursor, backs off on errors (1 s doubling to 30 s), and disconnects in hidden tabs. The 3-second
  `/list` polling fallback is gone.
- **#101 fixed.** `sellerFacingUserLabel`/`sellerFacingOrderBuyerLabel` never fall back to email; new
  `grainline_order_seller_detail_v5` and `grainline_order_seller_recent_sales_v2` wrap v4/v1 without
  `buyer_email`. Follow-up: v4 and v1 remain runtime-executable "through compatible overlaps" and
  still return the email; revoke them once the predecessor build has drained.
- **#104 fixed.** Dashboard hide/mark-sold/archive now queue `expireOpenCheckoutSessionsForListing`.
- **#102 fixed.** `vercel.json` now has `"deploymentEnabled": false` globally.
- **#103 and the phone gap disclosed.** The Privacy Policy now mentions the optional shipping phone and
  gift note, Stripe metadata retention, and Shippo receiving the contact phone.

**Broad RLS sweep (all migrations on main, 268 live functions):**
- All 233 `SECURITY DEFINER` functions set `search_path`, every one revokes PUBLIC execute, and nothing is
  granted to PUBLIC (no default-privileges rule exists, so the explicit revokes matter).
- No function uses dynamic `EXECUTE`. No views exist (so no view can bypass RLS).
- All 36 triggers checked: every trigger function that writes into an RLS table (e.g. Message →
  Conversation, CaseMessage → Case, OrderPaymentEvent → Order, OrderItem → Order) is `SECURITY DEFINER`.
- Policies: SavedSearch (select/insert/delete), Notification (select/update), Conversation and Message
  (select only) are all bound to `app.user_id`. The staff-report visibility helper checks both an
  active EMPLOYEE/ADMIN actor and an unresolved `MESSAGE_THREAD` report.
- `provision-runtime-db-role.sql` bulk-grants then re-revokes each policyless table when its RLS is
  active, and refuses to run on half-applied posture; ENABLE with zero policies denies non-owners even
  during the brief grant window.
- Application code (main): zero direct Prisma calls, zero relation filters, and zero raw SQL touching
  any RLS table; also zero direct `OrderItem`/`OrderShippingRateQuote` access, so their later release
  is mostly a database posture change.
- Staff Order functions require `SESSION_USER = grainline_staff_read_runtime` and an active staff actor.
- Only two non-Order functions were redefined after 2026-09-10 (`grainline_stripe_checkout_order_create`,
  `grainline_case_open`); both reviewed.
Verdict: the deployed RLS areas are structurally sound.

**Docs still stale:** `docs/rls-coverage-matrix.md` still lists `Order` as `PLANNED_RLS`, and the
credential incident docs still show families as open that Codex's notes record as rotated (#105).

---

# Broad round (bugs / scale / security), main `3b80fba0`, 2026-09-29

## #106 — MEDIUM (scale) — the email outbox has no priority lane: order emails queue behind marketing fanout and share its daily cap (verified)

`processEmailOutboxBatch` (`src/lib/emailOutbox.ts:374-397`) takes 50 rows every 5 minutes
(`/api/cron/email-outbox`, concurrency 2), strictly `orderBy: { createdAt: "asc" }`, about 600 emails an
hour. Everything goes through one global daily quota (`DEFAULT_EMAIL_OUTBOX_DAILY_SEND_LIMIT = 3000`;
only the outbox reserves it, direct sends don't). Marketing fanout enqueues into the same queue: seller
broadcasts (up to 10,000 follower emails each), followed-maker new-listing/blog emails and back-in-stock.
Transactional mail lands in the same queue whenever the direct-send fast path fails: order confirmed
(buyer and seller), shipped, refunded, case emails. So one broadcast to a few thousand email opt-ins:
- delays every order/shipping email that falls back to the outbox by hours (FIFO), and
- can use up the 3,000/day cap, pushing transactional retries to the next UTC day.
Fix: a priority column (transactional before marketing) in the batch ordering, a separate or reserved
daily budget for transactional templates, and a larger or adaptive batch when the backlog grows.

## #107 — MEDIUM (security/resilience) — "fail-closed" rate limits actually fail open when Upstash is slow (verified against the library)

`safeRateLimit` is documented as fail-closed: if Redis is unavailable the request is rejected
(`src/lib/ratelimitPolicy.ts` returns `success: failOpen` only when `limiter.limit()` **throws**). But
every limiter is built with `new Ratelimit({ redis, limiter, analytics, prefix })` and no `timeout`
(`src/lib/ratelimit.ts`). In `@upstash/ratelimit` 2.0.8 (the version in `package-lock.json`) `timeout`
defaults to **5000 ms**, and the published type docs say: "If set, the ratelimiter will allow requests
to pass after this many milliseconds." A timed-out call resolves with `success: true` (reason
`"timeout"`) instead of throwing, and `limitWithFailurePolicy` never reads `reason`. So whenever Upstash is
slow rather than down, every "fail-closed" limit (checkout, reviews, uploads, account deletion, admin
email, and the admin-PIN brute-force limiters `pinUserRatelimit`/`pinIpRatelimit`) lets everything
through, and each request also waits ~5 s first.
It compounds #105: whoever holds the unrotated Upstash token can also simply delete rate-limit keys.
Fix: set an explicit `timeout` on every limiter and treat `result.reason === "timeout"` as a failure
(reject when fail-closed, allow when fail-open); add a test with a hanging Redis stub.

## #108 — MEDIUM-HIGH (financial exposure) — lost chargebacks are paid by Grainline, not the seller, with no recovery path (verified in code)

Connect accounts are created with `losses_collector: "application"` and checkout uses destination charges
that transfer the seller's share at payment time (`transfer_data.amount`). When a buyer disputes, Stripe
debits Grainline's platform balance for the disputed amount plus the dispute fee. The dispute webhook
records the ledger and flags the order, but nothing reverses or holds the seller's transfer: the only
`transfers.createReversal` call in the codebase is for shipping-label costs
(`src/lib/labelClawbackProvider.ts:85`). So on a lost dispute the seller keeps the full payout and
Grainline absorbs the whole order amount plus ~$15. This is also the classic marketplace fraud pattern
(a seller "buys" from themselves with a stolen card, keeps the transfer, and the chargeback lands on the
platform).
Terms §8.4 (`src/app/terms/page.tsx:807-820`) says the chargeback fee "may be deducted from the Maker's
future payouts", but there's no mechanism for that: sellers are paid immediately by transfer, and
nothing tracks a balance owed.
Fix: on `charge.dispute.created`, reverse the seller transfer for the disputed amount (or at least on
`lost`), recorded like the label clawback with retry/manual-review states; re-transfer if the dispute is
won. Separately decide who bears the dispute fee and record amounts owed. Consider payout holds for new
sellers (Terms §6.9 already reserves the right).

INFO (economics, not a bug): Grainline keeps 5% of the item subtotal and pays Stripe's ~2.9% + 30¢ on
the whole charge (items + shipping + gift wrap + tax), and Stripe keeps its fee on refunds. Roughly,
orders under ~$16 (pickup, no shipping) or under ~$40 with $15 shipping lose money on every sale, and
every refund loses the processing fee. Worth modelling before launch pricing is final.
Addendum to #108: the same gap covers non-delivery. The seller's transfer lands at payment, so a seller
can be paid out and never ship; the refund reverses the transfer into a negative connected balance,
which Stripe recovers from the platform when the seller can't cover it.

## More LOW items (this round)

- **`CronRun` is never pruned.** Only failed runs are reclaimed (`src/lib/cronRun.ts:50`). The 5-minute
  email-outbox job alone adds ~105k rows a year (~200k across all crons), each with a bounded result
  JSON. Add a retention job (e.g. keep 90 days), mirroring the webhook-event retention.
- **Audit logs have no retention policy.** `AdminAuditLog`, `SystemAuditLog` and user audit rows
  (`TERMS_ACCEPTED`, `ACCOUNT_EXPORT`, admin PIN attempts with hashed IPs, `MANUAL_LISTING_STOCK_LOW` on
  every stock save) grow forever. Decide retention per action type and state it in the Privacy Policy.

## #109 — LOW-MEDIUM (product bug) — long made-to-order pieces can never be reviewed; all reviews need the buyer to click "received" (verified)

`grainline_order_review_eligibility_lock` (`20260905170000`) requires `fulfillmentStatus IN
(DELIVERED, PICKED_UP)` and `Order.createdAt >= since`, where the route passes `since = now - 90 days`
(`src/app/api/reviews/route.ts`, `REVIEW_WINDOW_DAYS = 90`). The window runs from **order creation**, but
made-to-order processing can be set up to 365 days (`Listing_processing_days_valid_chk`). A commissioned
table with a 120-day build is delivered after the window has closed, so the buyer can never review it,
and custom work is exactly where reviews matter most. Combined with #71 (nothing marks shipped orders
delivered unless the buyer confirms), every review also depends on the buyer clicking "received" first,
which starves review counts (Guild Master needs 25).
Fix: measure the window from `deliveredAt`/`pickedUpAt` (or `shippedAt` + transit), and let delivery
become confirmable from carrier tracking or an automatic N-days-after-shipment rule.

LOW (product): stock is per listing, not per variant. `ListingVariantOption` has only an `inStock`
boolean, so an in-stock listing with quantity 5 and sizes S/M/L lets buyers purchase 5 of "L" even if
the maker has one. Worth stating in the seller UI until per-variant inventory exists.

---

## Notification bug hunt (2026-09-29, against origin/main 3b80fba0)

### #110 (MEDIUM, user-visible, regression since Notification RLS 2026-07-22) Attachment-only message notifications show raw JSON and the file URL
- The app sends `body: "Sent an attachment"` to `createNotification`, but since `20260722051500_prepare_notification_rls`
  the DB ignores app text and derives the body in `grainline_notification_create_core`
  (latest def `20260901120000_prepare_order_receipt_notification_authority`, `p_source_type = 'message'` branch):
  `COALESCE(NULLIF(source_message.body, ''), 'Sent an attachment')`.
- For attachment-only sends, `src/app/messages/[id]/page.tsx` stores each file as a `kind: "file"` Message whose body is
  `JSON.stringify({kind:"file",url,name,type})`, and passes that message id as the notification source. The
  `NEW_MESSAGE` branch accepts `kind = 'file'` (it only excludes custom_order_request/link), so the body is non-empty JSON
  and the fallback never fires.
- Result: the bell (`NotificationBell.tsx:491`, truncated to 60 chars) shows `{"kind":"file","url":"https://…`, and
  `/dashboard/notifications` (`page.tsx:151`, up to 1000 chars) shows the full JSON including the R2 URL and
  original filename.
- Fix direction: in the DB message branch, derive `'Sent an attachment'` (or "Sent a photo"/"Sent a PDF") when
  `source_message.kind = 'file'`; and consider a one-time cleanup `UPDATE` of existing NEW_MESSAGE rows whose body
  starts with `{"kind":"file"`. Add a regression test for an attachment-only send.

### #111 (MEDIUM, user-visible, long-standing) "Off by default" in-app notification toggles are not enforced
- Settings UI treats `SELLER_BROADCAST`, `NEW_FAVORITE`, `NEW_BLOG_COMMENT`, `BLOG_COMMENT_REPLY` as default-OFF:
  `src/app/account/settings/page.tsx:16-41` (`prefs[type] === true`) and `src/app/dashboard/seller/page.tsx:249-251`,
  with copy "(off by default)".
- Delivery treats every in-app type as default-ON: the DB core only suppresses on an explicit
  `recipient_preferences -> type = 'false'`, and `src/lib/notificationDeliveryPreferences.ts`
  `isInAppNotificationEnabled` returns `!== false` (used to filter broadcast recipients).
- Result: any user who never touched these toggles sees them OFF in settings but still receives favorites, blog
  comments/replies and seller broadcasts in the bell. Present since 2026-04-01 (`abd6f5c8`), not an RLS regression.
- Fix direction: pick one source of truth. Either enforce default-off in the DB core (`IS DISTINCT FROM 'true'` for
  those four types) plus `isInAppNotificationEnabled`, or drop the default-off labeling in the UI. Share one
  default-off list between UI, TS helper and SQL, and add a test that pins them together.

### LOW notes
- `NotificationBell.markRead` restores state and `return`s without navigating if the read POST fails. Since
  `markReadRatelimit` is 60 per hour per user (shared with read-all and the dashboard mark-all action), a heavy
  user who clicks >60 notifications in an hour gets clicks that do nothing. Navigate regardless of the read result.
- `followed_maker_new_blog` compares `publishedAt` (timestamp without time zone) to `clock_timestamp()` (timestamptz),
  so the check depends on the session TimeZone being UTC. Correct today on Neon's default; brittle given the
  project's own "never use a session-zone cast" rule. Prefer `clock_timestamp() AT TIME ZONE 'UTC'`.
- NEW_MESSAGE notifications are only marked read by `MarkReadClient` on thread mount, so messages that arrive while
  the thread is open leave the bell badge unread until reload. UX only.
- Verified clean: dedup key is per source id (per message, not per conversation); tx-passing callers
  (stripe webhook dispute, case staff resolution, fulfillment, refund finalization) use default READ COMMITTED,
  so the core's isolation guard does not reject them; bell/page/mark-read functions scope correctly by `app.user_id`.

### Investigated 2026-09-29: "notifications disappear after logout/login" (Drew report) — no code path found
- App-side Notification deletes exist only in: account deletion (`accountDeletion.ts:1205` -> `grainline_notification_delete_for_account`),
  staff blog-comment delete, staff broadcast delete, and the 90-day-read / 365-day-unread prune. Only FK cascade is User deletion; no code deletes User rows.
- Sign-out (`clearSignedOutLocalAccountState`) is browser-storage only. Clerk webhook touches notifications only on `user.deleted`.
  Identity resolves by `clerkId` (`ensureUserByClerkId`), so the same Clerk login always maps to the same local user.
- Bell/page RPCs (`grainline_notification_bell`/`_page`) return all rows for the user, newest first, with no read/age filter.
  A failed bell fetch shows "Loading…", not "No notifications yet".
- Codex smoke scripts (`order-authenticated-route-smoke.mjs`, `notification-authenticated-route-smoke.mjs`) act only on the dedicated
  canary Clerk user (admin Gmail `+tag` alias, externalId-pinned, refuses to run with pre-existing sessions) and delete only their own synthetic
  fixtures and synthetic-order notifications; they do revoke the canary's sessions at cleanup.
- Open hypotheses needing Drew's data: (a) different Clerk identity/account on re-login, (b) moving between thegrainline.com and a Preview URL
  (separate Clerk session + staging DB), (c) the notifications were on the canary or a test account. Suggested read-only check: row count/createdAt
  for Drew's user id before and after a logout cycle, or compare two account exports.

### Follow-up 2026-09-29: Drew reports the disappearance is admin-account-only
Scripts ruled out: every production smoke/proof signs in only as the externalId-pinned canary or creates synthetic users; each deletes
only its own fixture rows. No notifications are addressed to staff/admins, so the admin inbox is ordinary.

#### #112 (MEDIUM, plausible, admin-specific) Clerk email-change sign-out can loop for an account whose local email cannot update
- `src/app/api/clerk/webhook/route.ts:280-299`: on `user.updated`, if the local `User.email` differs from Clerk's primary email
  (and isn't a placeholder), `revokeClerkUserSessions` signs the user out of all sessions, then `ensureUserByClerkId` tries to update email.
- `ensureUserByClerkId` (`ensureUser.ts:89-100`) drops the email on P2002 when another row owns that address and only logs
  `ensure_user_email_conflict`. CLAUDE.md documents that admin accounts historically share an email with another DB row.
- If so, local email never converges, and every later `user.updated` for the admin (profile/metadata/any Clerk-side change,
  including operator metadata writes) revokes all admin sessions again. Other accounts are unaffected.
- Verify (read-only): Sentry counts for `clerk_email_change_session_revoke` and `ensure_user_email_conflict` on the admin clerkId;
  compare admin local email vs Clerk primary. Fix: do not revoke when the email update cannot be applied (or revoke only after a
  successful local change), and resolve the duplicate-email row.

#### #113 (MEDIUM, design) Deleting any account deletes the notifications it caused in other users' inboxes
- `grainline_notification_delete_for_account` (20260722051500 ~L2634) deletes `WHERE "userId" = p_user_id OR "relatedUserId" = p_user_id`.
- So when a buyer/test account is deleted, sellers (e.g. the admin's shop) lose NEW_ORDER, CASE_*, NEW_MESSAGE, NEW_REVIEW, follow and
  favorite notifications from that user, read or unread. Leading explanation for "admin notifications vanished" if a second test account
  that interacted with the admin shop was deleted.
- Privacy scrubbing is reasonable for social/messages, but transactional order/case/payment notices are part of the counterparty's record.
  Suggest scoping the related-user delete to social/content families, or anonymizing title/body instead of deleting.

#### Note: Notification RLS activation purged all rows once
- `20260722052000_enable_notification_rls` runs an unconditional `DELETE FROM public."Notification"` before ENABLE. Every notification
  that existed before 2026-07-22 was deleted once in production. Intentional per the migration, but worth confirming users weren't told
  history is retained.

#### #114 (LOW-MEDIUM, scalability) Seller broadcast fanout is in-request, capped, and floods the shared email quota
- `src/app/api/seller/broadcast/route.ts:~190-204` loads followers with `take: 10000` and no `orderBy`: followers past 10k are silently
  and arbitrarily skipped (unlike the paginated listing/blog fanout helpers).
- Fanout runs in `after()` with no route `maxDuration` and no durable job: ~10k SECURITY DEFINER create calls (concurrency 10) plus
  up to 10k email renders/enqueues. A timeout or instance teardown drops the remainder with no retry, and `recipientCount` can be wrong.
- Emails enqueue into the shared FIFO outbox with the global 3000/day cap (#106), so one large broadcast can delay order/refund/case
  emails by days. Suggest a durable, cursor-paginated fanout job and a separate lower-priority lane or per-source quota for broadcasts.

#### Checked clean this round
- `commission/page.tsx` `$queryRawUnsafe`: fully positional parameters, category allowlisted; the only unsafe-raw use in src.
- Quality-score cron: 200-row cursor batches matching the 200-id cap of `grainline_order_public_listing_counts`; `maxDuration` 300.
  LOW: rewrites every active listing daily even when unchanged, and the zeroing pass omits unsupported `stripeAccountVersion` sellers.
- Back-in-stock fanout: per-subscriber claim with concurrency 5, chunked user lookups, stops when nothing is claimed.

## Broad round 2026-09-29 (origin/main b4d3617e)

### PR #475 (seller email projection predecessor retirement): sound
- Migration revokes runtime EXECUTE on seller_detail v2/v3/v4 and recent_sales v1. Live v5 and recent_sales_v2 are SECURITY DEFINER
  (owner executes the predecessor chain), so the revoke does not break them.
- Provisioning re-grants predecessors only while the retirement ledger row is absent, refuses a partial or checksum-drifted row, and
  the whole script runs in one BEGIN…COMMIT (L161–3139), so the REVOKE-then-GRANT has no live gap.

### RLS app-boundary re-sweep after #475: clean
- No direct Prisma access, relation filter/include/_count, or hand-written SQL in src touches any RLS table (only the approved
  SavedSearch context-client helper). No invoker-rights function reads OrderItem or OrderShippingRateQuote.

#### #115 (MEDIUM, security quick win) Runtime still holds full CRUD on OrderItem and OrderShippingRateQuote with zero app use
- `scripts/provision-runtime-db-role.sql` bulk-grants SELECT/INSERT/UPDATE/DELETE on both tables (L339/L341) with no later revoke.
- App code never touches them directly (only granted tables with no direct use; ListingVariantOption is used through nested writes),
  and all 38 functions that read them are SECURITY DEFINER.
- A leaked runtime credential could read every order item snapshot and rewrite quantities/prices/listing ids. Those are the inputs
  owner functions trust for refunds, stock restoration, seller metrics and public stats. It could also rewrite persisted label quotes,
  which the label-purchase check treats as authoritative.
- Revoking runtime privileges (and PUBLIC) on both tables does not need the pending RLS design and should be functionally inert.
  Verify with the existing Order route smokes, then add a provisioning re-revoke like the other locked tables.

#### #114 addendum: listing/blog follower fanout
- `followerListingNotifications.ts` pages correctly (1000/page) but also runs inside `after()` with no durable retry, and enqueues one
  email per follower per published listing into the shared 3000/day outbox. A maker with 500 followers publishing 6 listings consumes a
  full day's global quota. Same fix direction as #114.

#### LOW
- Review reply (`api/reviews/[id]/reply/route.ts:86-94`): "one reply" check-then-update is not atomic; use
  `updateMany({ where: { id, sellerReply: null } })`. Also lacks the explicit cross-origin POST guard used by sibling routes.
- Account export (`api/account/export/route.ts`): ~20 `findMany` with no `take` and no `maxDuration`; very large accounts can time out.
  Order sections page correctly through the export functions.

#### Checked clean
- Case evidence download: participant/staff-visible case check, staff admin-PIN, lifecycle binding, 60s private signed URL, no-referrer.
- Middleware: signed-in ban and Terms gates run on public routes too; every mutating handler under public API prefixes authenticates in-route
  (newsletter/support/legal intake are intentionally public).

### Independent Codex verification and release ordering — 2026-09-29

Codex rechecked the broad-round claims against exact public main
`b4d3617e6c10e0379acfd764193bf74fa4ced78c` rather than accepting the Claude
report as release evidence:

- **#110 confirmed.** The latest installed Notification core derives a file
  message body from the stored JSON body, while the UI stores attachment-only
  messages as non-empty `kind: "file"` JSON and both Notification surfaces
  render the derived body. The raw-JSON/R2-URL result follows directly.
- **#111 confirmed.** The settings surfaces declare four types default-off,
  while both TypeScript delivery and the database suppress only explicit
  `false`. Existing tests currently pin the contradictory default-on delivery
  behavior for a missing `SELLER_BROADCAST` preference.
- The Notification bell navigation failure is also confirmed: a failed
  mark-read request restores local state and returns before navigation.
- **#112 remains plausible but unproved.** The webhook revokes sessions before
  `ensureUserByClerkId`, and the P2002 recovery path can omit the email update.
  A real duplicate-email conflict for the admin account still needs live
  Clerk/database or Sentry readback before calling the loop confirmed.
- **#113 and #114 confirmed as behavior.** Account deletion removes rows for
  both the recipient and `relatedUserId`; seller broadcast fanout is capped at
  10,000, unordered, request-lifetime work with no durable retry and shares the
  global email outbox.
- **#115 confirmed at the source/grant boundary.** Runtime retains ordinary
  CRUD on `OrderItem` and `OrderShippingRateQuote`; no application source call
  was found that needs direct access, and relevant reads use fixed
  owner-executed functions. This is a separate high-value Order grant
  hardening release after the current seller-email predecessor retirement.
- **#116 confirmed.** The product promises a local radius, but the default
  board, public detail/indexing, and interest-creation authority do not enforce
  locality.
- **#117's Cloudflare-specific premise is ruled out for current Production.**
  Live DNS and response headers resolve the canonical site through Vercel, not
  an orange-cloud Cloudflare proxy. General trusted-proxy hardening can remain
  a later defense-in-depth item.
- **#118 confirmed.** Upload processing re-encodes without resizing, the client
  resizes only files above the size threshold, and listing cards use ordinary
  image elements without generated responsive derivatives.
- **#119 confirmed with narrower scope than the headline.** `/browse` is a
  dynamic public page with no route-level rate limit. Relevance searches can
  fetch and score 200 listings, ordinary requests count and fetch listings,
  and location-filtered requests add a trigonometric seller scan. Some helper
  data is cached and the Haversine work runs only when location parameters are
  supplied, but arbitrary query/location combinations still expose the
  uncached database work to crawlers.
- **#120 confirmed.** `/messages/[id]` grants EMPLOYEE/ADMIN accounts the
  unresolved-report review exception before loading the private thread, while
  the admin-PIN middleware covers `/admin` and `/api/admin`, not this messages
  page or its list/stream APIs. Participants should remain unchanged; the
  staff-review exception needs an explicit verified-PIN gate across its page
  and live-read surfaces.

The seller-email predecessor retirement subsequently completed in exact
Production run `36612241276`. #115 was prepared from exact main
`19e0cece5a72d86df2b22c739f70bb6fb36d1656`. It adds the two-table revoke,
ledger-gated provisioning and audit convergence, disposable PostgreSQL CI, and
a main/CI/live-deployment-bound protected Production workflow whose postflight
requires unchanged Order authority-function and RLS posture. The initial
candidate was published under explicit authorization as deployment-disabled
draft PR #477 at exact head `8a7f40fd`; all three specialized exact-head proofs
passed. Full CI `36614249763` then failed only three source-contract assertions
after its preceding 425 steps passed: two historical suites had prohibited
`prisma migrate resolve` across the complete workflow, and one grant inventory
asserted 19 provisioning guards before the new exact-ledger guard made 20.
The failed head was not rerun or merged.

Corrective local head `7d5b1238dd97cc5bc7d64bb4aa291d20c4326ace`
changes only those four test files: the historical no-resolve rule now remains
enforced through every predecessor stage, the new runtime-lock suite requires
exactly one resolve after its exact reviewed SQL, and the guard inventory
requires 20. The migration, application, CI execution steps, provisioner,
audit, and Production workflow are byte-unchanged from `8a7f40fd`. The exact
failed assertions, targeted ESLint, and diff checks pass locally, and the
corrected head is backed up privately. After explicit authorization, PR #477
was updated to exact corrected head `7d5b1238` against unchanged main
`19e0cece`; corrected full CI is `36618645310` and the three corrected-head
specialized Order proofs are `36618645361`, `36618645303`, and `36618645294`.
The three corrected-head specialized proofs passed. Full CI `36618645310`
passed the full test suite and reached its final runtime-lock stages, but
failed closed at step 453 while reconverging grants. The SQL application and
`prisma migrate resolve --applied` step had reported success, but the resolved
ledger row did not satisfy the provisioner's exact normal-deployment contract
requiring `applied_steps_count = 1`. PR #477 was not merged and the failed run
was not replayed.

Local corrective head `e2387f453079e48f9222c98434c18e6dc010242c`
removes `migrate resolve` and instead stages a temporary Prisma migration tree
containing exactly the reviewed runtime-lock migration, then uses
`prisma migrate deploy` so disposable CI exercises the same ledger semantics
as the protected Production workflow without admitting the other restored CI
migrations. The prior historical no-resolve contracts are restored. The
migration, application, provisioner, grant audit, and Production workflow are
byte-unchanged from public head `7d5b1238`. Focused tests, the provisioning
guard check, targeted ESLint, YAML parsing, and diff validation pass locally;
the exact head is backed up on private recovery branch
`recovery/order-item-quote-runtime-lock-e2387f45-20260929`. Public PR #477
remains at `7d5b1238` and main remains `19e0cece` pending new exact-head
publication authorization. No Production action is part of this correction.

These findings do not widen the completed predecessor migration. The release
order is: publish/review/apply #115 as its own runtime-grant revocation, then
advance the already-separated Core Order FORCE release. Notification #110 and
#111 require their own Notification migration/application release and do not
belong in the Order retirement packet. Findings #119 and #120 likewise require
separate browse-abuse and messaging-privacy changes; #120 should be prioritized
after the in-flight Order boundary because it protects private conversation
content from a stolen staff session.

#### #116 (MEDIUM, product logic) "Local makers only" commission requests are not limited to local makers
- `/commission/new` promises "Local shows your request to makers within ~50 miles". `isNational=false` is used only to sort and badge
  results on the Near Me tab (`commission/page.tsx` raw SQL).
- The default board uses `openCommissionWhere()` with no scope filter, so local-only requests show to every visitor (signed out too), and
  `sitemap.ts`/`sitemapSourceCounts.ts` index them publicly.
- Interest creation (`api/commission/[id]/interest` → `grainline_message_create_commission_interest`) never checks `isNational` or distance, so any
  eligible seller nationwide can respond and open a conversation with the buyer.
- Fix: either filter local requests to sellers within radius (board, detail, sitemap) and enforce radius in the DB interest function, or relabel
  the option as "prefer local makers".

#### #117 (MEDIUM if Cloudflare proxies traffic; verify infra) IP rate limits key on the first X-Forwarded-For entry
- `src/lib/ratelimit.ts:601-605` `getIP()` returns `x-forwarded-for.split(",")[0]`, else `127.0.0.1`. It is used for all public IP limits:
  search, address autocomplete, newsletter/support/legal intake, analytics dedup, health, similar listings, admin-PIN attempt telemetry.
- If Cloudflare proxies (orange cloud) in front of Vercel, the value is either a Cloudflare edge address (many users share one bucket, false
  429s) or a client-supplied value (limits bypassable), depending on header handling. Docs do not state the DNS mode.
- Fix: verify DNS mode. If proxied, derive the IP from `cf-connecting-ip` (validated as coming from Cloudflare), or use
  `@vercel/functions` `ipAddress()` / `x-real-ip` when DNS-only. Pin with a test.

#### #118 (MEDIUM, performance/scalability) Listing photos are served at upload resolution everywhere
- The server image route re-encodes without resizing (`api/upload/image/route.ts:58-61`, cap 50MP). The client shrinks only files over 4MB
  (`useR2Upload.ts:76-110`), so a typical 3–4MB 12MP phone photo is stored and served at full size.
- `ListingCard` → `MediaImage` renders a plain `<img>` of that original (plus the hover second photo) with no `srcset`/sizes, and
  `next/image` optimization is not used for R2 media. A 24–40 card browse or home page can pull tens of MB on mobile.
- Fix: generate fixed card/detail derivatives at upload (e.g. 600px and 1600px WebP) and store them alongside the original, or serve via
  a resizing loader. Heavy PNG `compressionLevel: 9` on 50MP inputs is also CPU-expensive per request.

### Uncovered-areas round 2026-09-29 (b4d3617e)
LOW:
- Pickup detection in paid-checkout order creation (`20260926011000_correct_order_paid_checkout_bound_reservation` ~L561) is still
  `lower(shippingTitle) LIKE '%pickup%'` or a null address, not the signed rate objectId `pickup`. A carrier service whose display name
  contains "pickup" would either be stored as a PICKUP order (seller allows pickup) or fail as `method_mismatch` after payment.
  Prefer an explicit signed metadata flag from the checkout route.
- Case auto-close cron runs once daily (`10 8 * * *`), so OPEN cases escalate up to ~24h after the 48h seller deadline, and stale
  PENDING_CLOSE closes up to a day late. Consider hourly now that batches are bounded and resumable.
- Messages inbox Unread / Awaiting Reply tabs filter only the current 50-conversation page (`messages/page.tsx:151-159`), so older unread
  threads appear only after paging, and some pages can look empty while more exist.
Checked clean:
- Cart seller checkout: signed rate bound to buyer/destination/subject/currency, live price-version check, server-side gift wrap,
  pickup allowed only if seller still allows it, minimum-transfer guard. Made-to-order qty=1 enforced consistently in add/update/cart/Buy Now.
- Case auto-close: bounded, resumable batches for PENDING_CLOSE, OPEN, and stale discussion.
- Commission expiry: guarded `updateMany(status OPEN)`; DB notification branch handles EXPIRED for buyer and interested sellers.
- Ban flow Order work goes through `orderBanReviewAuthority` functions (no direct Order access).
- Favorite notifications dedupe per (listing, favoriter), so toggling can't spam. Follow uses the same pattern.
- Support/data-request intake emails only internal recipients (no relay). Newsletter confirmation has a per-address resend cooldown.

### Round 2026-09-29 (cont., b4d3617e)

#### #119 (LOW-MEDIUM, scalability/abuse) Public browse/search pages run uncached, unrate-limited DB work
- `/browse` (and tag/metro/blog/commission list pages) run count + up to 200-candidate relevance fetch + partial-tag unnest SQL + rating map
  + an unindexed seller Haversine scan (`browse/page.tsx:~332`) per request, with no IP limit. The equivalent search API routes are
  deliberately fail-closed IP-limited "so bots cannot hit the DB unbounded", but the page path bypasses that.
- A crawler varying `q`/location params costs one heavy query set per hit; only Cloudflare (free tier) stands in front.
- Suggest a lightweight IP limiter (or short `unstable_cache` keyed on normalized filters for signed-out viewers) on the expensive branches,
  and a bounding-box prefilter on seller lat/lng before the trig expression.

#### #120 (LOW-MEDIUM, security consistency) Staff review of reported message threads does not require the admin PIN
- `src/app/messages/[id]/page.tsx:55-112`: an EMPLOYEE/ADMIN session can open any thread with an unresolved MESSAGE_THREAD report and read
  its private messages (`grainline_conversation_staff_report_visible`). This path is outside `/admin`, so middleware's PIN check does not
  apply, and the page never calls a PIN check.
- Case evidence, case messages, escalation and resolution all call `requireStaffAdminPinForApi`. A stolen staff Clerk session without the
  PIN can read reported private conversations. Require the verified PIN cookie for staff-review mode (participants unaffected).

#### LOW
- Sitemap chunks use OFFSET paging ordered by mutable `updatedAt`/`publishedAt` (`sitemap.ts:56-145`), so a row updated between two crawler
  chunk fetches can be skipped or duplicated. Order by `id` (as listings already do) or use keyset ranges.
- `dashboard/profile` `normalizeHttpsUrl` redirects on the first invalid link before saving, discarding every other edit in the submit;
  subdomains such as `m.facebook.com` and `m.tiktok.com` are rejected by the exact host allowlist.
- `messages/[id]/page.tsx:58` loads the full `User` row (no select) for the viewer; server-only, but inconsistent with the narrow-select rule.

#### Checked clean
- Social/website links: https-only, host allowlists for social networks, rendered as links only (never fetched server-side).
- Unsubscribe tokens: invalidated by later opt-in, newsletter confirmation or current-email reclaim (`unsubscribeTokenSuperseded`).
- Homepage stats and featured makers cached (`getCachedHomepageStats`, 300s `unstable_cache`).
- All staff-capable `/api/cases/*` routes enforce the admin PIN for staff.

### Round 2026-09-29 (origin/main 19e0cece)
- PR #476 (release tooling): the email-free deployment check now requires the two team-only Vercel aliases to return a Vercel SSO 302 instead of
  the page marker. Sound: those aliases are not publicly reachable, and the public aliases must still serve the exact deployment marker.

#### #121 (MEDIUM, operations) No alerting on stuck money/order states
- `api/cron/ops-health/route.ts` alerts on email outbox, support SLA, Resend/Clerk/Stripe webhook failures, account-deletion side effects,
  and cron failures. It checks no Order-domain state:
  - refund claims left ambiguous (missing refund identity is "never released by time alone" and needs staff reconciliation),
  - label clawbacks in MANUAL_REVIEW or RETRY_PENDING past their retry window,
  - aging `reviewNeeded` orders (blocked-checkout auto-refund failures, deauthorization holds, oversell),
  - CheckoutStockReservation rows stuck in RESERVED/SESSION_CREATED after the repair cron's backoff,
  - SellerPayoutEvent payout failures.
- These surface only as admin sidebar counts, so a money problem can sit unnoticed. With Order RLS, the check needs a bounded
  service/staff aggregate function (counts only, no row data). Add an ops-health section that returns 503 on any aged item.

#### LOW
- Stripe Connect account creation (`api/stripe/connect/create/route.ts:71-90`) uses a fixed idempotency key `connect-v2-account:${seller.id}`.
  Within Stripe's 24h key window, a seller whose account was deauthorized (stripeAccountId cleared) gets the same deauthorized account back on
  reconnect. If the email or country changed, Stripe rejects the reused key and the seller cannot connect until it expires. Include a
  reconnect generation or the prior-account id in the key.
- #121 addendum: the admin sidebar has no count badge for "Orders Needing Review" (`admin/layout.tsx:64-68`). Cases, verification, comments,
  listing review and support all have counts, so flagged/stuck orders are visible only if staff open `/admin/flagged` manually.
- #120 addendum: `listing/[id]/page.tsx:217-230` `?preview=admin` lets any EMPLOYEE/ADMIN session view drafts, rejected, pending-review and
  private reserved custom listings (`canViewListingDetail` staffPreview), also without the admin PIN. Lower sensitivity than private messages,
  but the same gap: staff read paths outside `/admin` should require the verified PIN cookie.

#### Checked clean (2026-09-29, 19e0cece)
- Review creation (`api/reviews/route.ts`): eligibility re-checked under an Order-row lock in the write transaction, P2002 duplicate handled,
  seller rating summary refreshed in the same transaction.
- Case window: shipped/ready orders the buyer never confirms close 30 days after `estimatedDeliveryDate`, which paid-checkout creation always
  sets (`20260926011000` L586-589), so the window cannot stay open indefinitely. Legacy rows with a null estimate would never close.
- Private reserved listings: visible only to owner, the reserved buyer (with seller still orderable), or staff preview.

#### #122 (MEDIUM-LOW, logic/buyer protection) `shipsWithinDays` is unbounded and drives the buyer's case clock
- New/custom/edit listing actions (`dashboard/listings/new/page.tsx:181-183`, `custom/page.tsx:156-159`, `[id]/edit/page.tsx:223-225`) accept any
  positive integer. There is no maximum and no DB CHECK (processing days are capped at 1..365 by `Listing_processing_days_valid_chk`, ship-within is not).
- Paid-checkout order creation uses it directly: `processingDeadline = paidAt + max(shipsWithinDays)`, `estimatedDeliveryDate = deadline + estDays + 3`
  (`20260926011000` L492-L589). A NOT_RECEIVED case can only open after the estimated delivery, and the case window closes 30 days after it.
- A seller who sets e.g. 3650 pushes a buyer's ability to report non-delivery out ten years and keeps the order in deletion-blocking case-window
  state. The value is shown on listing detail ("Ships within N days"), but not in cart/checkout. Values above int4 max make the save fail (500).
- Fix: cap at 365 (or lower) in all three actions, `ListingTypeFields`, and a validated DB CHECK matching the processing-days one.

#### LOW (listing create/edit input validation)
- Product dimensions use `Number(...) || null` (`new/page.tsx:138-140`): negatives, `Infinity`, and huge values are stored and rendered on listing detail;
  no bound or DB CHECK.
- `processingTimeMinDays` > 365 with an empty max passes app validation (only max is capped) and then fails the DB CHECK, surfacing as a thrown
  server error instead of an inline form error (the form is not preserved).

#### LOW (Guild)
- `api/verification/apply/route.ts:139-158`: the eligibility/state checks are reads, then `makerVerification.upsert` unconditionally sets
  `status: PENDING` and clears `reviewedById/reviewNotes/reviewedAt`. A re-application racing a staff approve/reject overwrites the decision
  (SellerProfile.guildLevel may already be GUILD_MEMBER). CLAUDE.md requires expected-status guarded Guild transitions; use
  `updateMany` with the allowed prior statuses (or a create-only path). The route also returns the full MakerVerification row.
- `admin/verification/page.tsx:178-264`: the "Admin override: $250 sales requirement waived" checkbox is honored for any EMPLOYEE via
  `requireStaff()`. Reinstatement and feature/unfeature were made `requireAdminOnly()` because they restore trust status; waiving an
  eligibility rule is the same class of escalation. Gate `adminOverride` on ADMIN (audit metadata already records it).
Checked clean: blog video URLs (strict host allowlist, 11-char YouTube / numeric Vimeo IDs, iframe built only from the ID).

### Codebase-wide sweeps 2026-09-29 (19e0cece)

#### #123 (MEDIUM-LOW, scalability) Account export/deletion scans every Gmail user
- `src/lib/userEmailAddresses.ts:36-60` `accountEmailFallbackEmailsForUser`: when the account has any Gmail address, it loads
  `user.findMany({ deletedAt: null, OR: [..., email endsWith "@gmail.com", endsWith "@googlemail.com"] })` with no limit, to find alias collisions in JS.
- At scale that returns most of the user table. It runs in `/api/account/export` and inside account deletion's 30s context transaction
  (`accountDeletion.ts:1133`), so deletions for Gmail users could time out and fall into the retry path as the user base grows.
- Fix: compute the Gmail canonical key in SQL (lowercase, strip dots and `+tag` in the local part) against an indexed expression or stored
  column, and query only the exact candidate keys.

#### LOW
- Explicit cross-origin POST guard coverage is inconsistent: ~30 mutating routes lack `getExplicitCrossOriginPostRejection` (e.g. accept-terms,
  notification preferences, shipping address, seller vacation, listing stock, reviews, uploads, verification apply, admin ban/undo/review/delete).
  Clerk's session cookie is SameSite=Lax, so cross-site POSTs don't carry it, and admin routes also need the Strict PIN cookie. Defense-in-depth
  gap only; worth a shared wrapper so coverage stops depending on per-route memory.
- Listing metro assignment is copied from the seller location at listing creation only (`dashboard/listings/new/page.tsx:311`). When a seller
  changes location (`dashboard/seller/page.tsx:178-190`) only `SellerProfile.metroId` is updated, so existing listings stay on the old city's
  browse/SEO pages. Clearing the location leaves the old metro set. Listings created before a location was set keep a null metro.
Checked clean:
- Every "use server" file applies a rate limit. Remaining unbounded `findMany` calls are id-list lookups, per-user small sets, or bounded
  featured-id lists. Exceptions: #123 and the export queries (already LOW). `findNearestMetro` loads all metros, but metros are per US city (low thousands).

### Deep reads 2026-09-29 (19e0cece) — full line-by-line, not grep

#### Stock route (`api/listings/[id]/stock/route.ts`, all 394 lines): sound
- Ownership re-bound in the locked UPDATE (`sellerId` predicate), mutation receipts replay saved results, delta mode used by the
  inventory UI so concurrent checkout reservations are preserved, status flips only ACTIVE↔SOLD_OUT, restock only for public listings,
  back-in-stock claims are bounded and cannot loop.
- LOW: private reserved custom listings that hit 0 go SOLD_OUT and are never reactivated by restocking (isPrivate excluded). `markAvailableAction`
  can recover them via publish/AI review, but the owner action matrix documents SOLD_OUT as Delete-only, so the seller may have no visible path.
- LOW: back-in-stock email enqueue failures after a successful claim are dropped silently (mapWithConcurrency results ignored), and the claim
  deletes the subscription first, so an affected subscriber gets the in-app notice only, with no Sentry trace. Every subscriber is notified even
  when restocked quantity is 1 (design choice).

#### Stripe webhook (`api/stripe/webhook/route.ts`, all 1269 lines)

##### #124 (MEDIUM, money) Pre-provider failures in the blocked-checkout auto-refund are swallowed and the event is marked processed
- `refundBlockedCheckout` (L777-917): errors from `releaseBlockedCheckoutLegacyRefundLock` or `claimBlockedCheckoutOrderRefund` (before any Stripe
  call) reach the outer catch with `refundId == null && !retryBlockedCheckoutRefund`, which records review action `provider_failure` and returns
  normally. `processIdempotentEvent` then marks the StripeWebhookEvent processed.
- The DB note for `provider_failure` is "Automatic refund failed; staff must reconcile this payment manually." A transient DB error (40001,
  connection reset) therefore leaves a paid checkout for an unavailable seller/listing unrefunded with no Stripe retry. The immutable-reconciliation
  admin retry path described in CLAUDE.md requires a failed inactive event, and this one is processed. Nothing pages anyone (#121).
- CLAUDE.md contract: "Blocked-checkout refund failures before Stripe returns a refund id must release the local sentinel, record bounded review
  evidence, and throw so Stripe retries." Provider failures follow it (mark ambiguous + rethrow); pre-provider local failures do not.
- Fix: rethrow after recording the review (or skip the review record for transient SQLSTATEs) so Stripe redelivers; keep manual review only for
  terminal outcomes.

##### LOW
- `charge.refunded` (L1086-1118) derives refund id/amount/status from `charge.refunds.data`. Since Stripe API 2022-11-15 the Charge object omits
  `refunds` unless expanded, and webhook payloads cannot be expanded (app pins 2025-10-29.clover). Those fields are therefore always null. The DB
  function tolerates null (falls back to the order's local `sellerRefundId` evidence), so Dashboard/external refunds are ledgered without a
  refund id and with status defaulting to "refunded". A refund that later fails would still read as refunded (no `charge.refund.updated`
  subscription). Retrieve the charge with `expand: ["refunds"]`, or list refunds for the charge, before applying.
- Checkout completion with `payment_status !== "paid"` returns ok and marks the event processed (L639-646). Correct for card-only today; if a
  delayed method is ever enabled, the later `async_payment_succeeded` event handles it, which is fine.
- Order post-payment side effects use `createNotificationOrThrow`: a persistent notification-source validation failure would keep failing the
  signed event for Stripe's full retry window. Acceptable, since it surfaces in ops-health webhook failures.
Checked clean in this read: signature/size/staleness gates before reservation, thin-event envelope match, idempotent lease with processed/in_progress,
routing-metadata fail-closed, payment refs required before order creation, paid line items source-bound to listing/cart item, replay handling,
email direct-send + outbox fallback with Resend idempotency key, dispute notification co-committed with the ledger transaction.

## Frontend / UI consistency pass 2026-09-29 (19e0cece) — static code review, no screenshots
Method: design-system sweeps across all 289 .tsx files, plus full reads of checkout success, the listing purchase panel, and cart styling.
Items marked (visual check) need someone to look on a phone.

### #125 (MEDIUM, visible) Borders with no color render dark/near-black (Tailwind 4 default = currentColor)
- `globals.css` imports Tailwind 4 and sets no default border color, so a bare `border`/`border-b`/`divide-y` draws in the text color.
  Most of the site uses `border-neutral-200` / `border-stone-200/60`, so these stand out as harsh dark outlines.
- User-facing static cases (full list in scratch scan, ~50 excluding variable-colored ones):
  - checkout success: item thumbnails and both "View my orders"/"Keep shopping" buttons, in all 3 states (`checkout/success/page.tsx:45,47,206-207,239,245,280-281`)
  - blog tag cloud pills (`blog/page.tsx:393`); browse no-results "browse all" button (`browse/page.tsx:607`)
  - account header avatar (`account/page.tsx:157`); seller sales thumbnails (`dashboard/sales/page.tsx:243,245`)
  - message attachment chips (`ThreadMessages.tsx:79,562`)
  - case forms: `CaseReplyBox.tsx:138` textarea, `OpenCaseForm.tsx:87,111,136`, `StarInput.tsx:69`
  - seller label rate list `LabelSection.tsx:142` (`divide-y rounded border`), `ImageUploadField.tsx:28`, `VideoUploader.tsx:30`, `ReviewPhotosPicker.tsx:105,134`
  - maps `MaplibreMap.tsx:12`, `SellersMap.tsx:119`; error pages `browse/error.tsx:31,35`, `listing/[id]/error.tsx:31,35`
  - Header drawer separators `Header.tsx:596,745`, `AddToCartButton` default class `rounded border` (used when no className is passed)
- Fix: add `@layer base { *, ::before, ::after { border-color: var(--color-stone-200); } }` (Tailwind's documented v3-compat snippet),
  or add explicit colors. The global default fixes all of them at once.

### #126 (MEDIUM, "doesn't match") Two different buyer "My Orders" pages
- `/account/orders` (`max-w-7xl`, "My Orders" `text-3xl font-bold`, 48px thumbs, paginated 20/page) and `/dashboard/orders` ("My orders"
  `text-2xl font-semibold`, `max-w-4xl`, 64px thumbs, different card layout) both list the buyer's orders.
- Links split between them (4 to `/account/orders`, 6 to `/dashboard/orders`, and order detail lives under `/dashboard/orders/[id]`), including
  the checkout success page. Buyers see a different page depending on where they clicked. Pick one; redirect the other.

### #127 (LOW-MEDIUM) Notifications page and bell disagree
- `dashboard/notifications/page.tsx` `typeIcon` lacks 6 types the bell handles: LISTING_APPROVED, LISTING_REJECTED, COMMISSION_INTEREST,
  FOLLOWED_MAKER_NEW_LISTING, FOLLOWED_MAKER_NEW_BLOG, SELLER_BROADCAST. Those show a plain gray bell on the page but colored icons in the dropdown.
  Share one icon map.
- Page "Mark all as read" is `text-blue-600` (off-palette), while the bell's is gray underlined. Unread marker is an amber dot on the page and
  a cream row highlight in the bell.

### #128 (LOW-MEDIUM, mobile) Inconsistent page gutters; most of Workshop uses 32px sides on phones
- CLAUDE.md layout rule: 16px side gutter at phone width. `<main>` uses fixed `p-8` (32px at all sizes) on: dashboard, inventory, sales
  (list+detail), buyer order detail and list, notifications, listing edit/custom, blog dashboard, messages inbox, sellers map, checkout success.
  Account pages use `p-6 md:p-8` (24px); public pages use 16px. Margins visibly change between sections, and a 375px phone gets ~311px of content.
- (visual check) `sign-in`/`sign-up` wrap Clerk's fixed-width card in `p-8`, which may squeeze or overflow on small phones.
- Fix: `px-4 py-6 sm:p-8` on these mains.

### LOW (typography/consistency)
- Page title styles vary within one section: account pages mix `text-3xl font-bold` (Account, Orders, Commissions), `text-2xl font-bold`
  (Saved, Following, Feed) and `text-2xl font-semibold` (Reviews, Blocked). `FeedClient.tsx` uses two different h1 styles. Buyer/seller order detail
  h1s (`dashboard/orders/[id]`, `dashboard/sales/[orderId]`) and listing detail h1 omit `font-display`, contrary to the h1 rule.
- Corner radius: 160 uses of plain `rounded` (4px) in 73 files (cart 19, photo managers, case forms, label section) against the `rounded-md`
  button/input and `rounded-lg` card standard. Thumbnails vary between `rounded`, `rounded-lg` and `rounded-md`.
- Off-palette blue: `text-blue-*` in 21 files (mostly admin; user-facing in dashboard notifications and buyer order detail).
- Listing purchase panel: spec says "Add to Cart: full-width bordered button"; implemented as borderless cream fill turning white on hover.
  "This piece was made just for you" / "reserved for another buyer" banners are square-cornered inside the rounded panel (`listing/[id]/page.tsx:550-559`).
- Listing panel signed-out CTA says "Sign up to buy" and routes to sign-up, so returning customers are sent to the wrong form first.
- Checkout success "processing" state says the order "will appear momentarily" but never refreshes, and the receipt shows "Buyer: Guest"
  when no label resolves, although every buyer is signed in.

### #129 (MEDIUM, visible — Drew-reported) Search dropdown flashes a placeholder list, then swaps to real recommendations
- `src/components/SearchBar.tsx`: `onFocus` (L384-391) opens the dropdown immediately and only then starts `loadPopularTags()` (L107-118).
  Until `/api/search/popular-tags` returns, `visiblePopularTags` falls back to `FALLBACK_POPULAR_SEARCHES = ["furniture","kitchen","decor","gifts",
  "woodworking"]` (L16, L211-213), which reads like categories. When the fetch resolves, the rows swap mid-open-animation, usually changing count and height.
- Repeats on the first focus after every page load: tags are fetched lazily per SearchBar instance (`popularLoaded` is component state), there are
  two instances in `Header.tsx` (L389 desktop, L545 mobile), and the route is `force-dynamic`, so each fetch is a fresh serverless round trip.
- Mobile: the `autoFocus` effect (L120-124) opens the dropdown without calling `loadPopularTags()`. Where iOS doesn't dispatch focus (the case the
  comment describes), the dropdown shows the fallback list indefinitely; where it does, the swap happens.
- Fix: load the tags before the dropdown can open, e.g. pass server-fetched `getPopularListingTags(8)` from the layout into `Header`/`SearchBar` as an
  initial prop (already cached), or prefetch on mount/idle into module-level state shared across instances. Call `loadPopularTags()` in the autoFocus
  effect too. Don't render the fallback list while a fetch is in flight: use the fallback only if the fetch failed or returned empty.

## Codex reconciliation of two Claude packets — 2026-09-29

This reconciliation covers the two complete user-supplied packets below. Each
packet was read from beginning to end twice before disposition. Source claims
were then checked against exact public main
`19e0cece5a72d86df2b22c739f70bb6fb36d1656`; the active Order runtime-lock
worktree is local `e2387f453079e48f9222c98434c18e6dc010242c`, whose only
differences from that main are the separately prepared #115 release files.
Remote readback still showed main `19e0cece` and PR #477's public branch
`7d5b1238` during this review.

- `96f98e0f-3115-46b3-a735-a45d3e9f340f/Pasted text.txt`: 356 lines,
  SHA-256 `669cf1b3c42191df8d8ac287ea3c81621d6fac528189b0e9f31fe5da7512a8ac`.
- `475545bb-7d45-4ade-9dfa-b6d134209fb5/Pasted text.txt`: 56 newline-terminated
  lines, SHA-256
  `941db618fc7f54e5d5413877da19f9fb7b8b200a7156f6ac1f720580382a9f4f`.

### Complete disposition of the submitted claims

- **Notification disappearance investigation:** source confirms sign-out only
  clears local browser state; ordinary Notification reads are scoped to the
  Clerk-ID-bound local user and do not age-filter the result; failed bell loads
  do not render the empty state. Source also confirms the listed deletion
  surfaces: account deletion, staff deletion of the two source objects, and
  90-day-read/365-day-unread pruning. The 2026-07-22 activation migration did
  perform one unconditional table purge. None of this proves the cause of
  Drew's reported live disappearance.
- **Smoke/operator cleanup:** confirmed source-bounded to marked canary or
  synthetic fixtures, with exact notification/source cleanup and canary
  session revocation. No source evidence supports deletion of a real admin
  inbox. A live account/row comparison would be needed to diagnose the report.
- **#112:** keep **plausible, unproved**. The webhook revokes sessions before
  calling `ensureUserByClerkId`, and its email-unique-conflict recovery drops
  the email update. The source therefore permits a repeat-revocation loop, but
  the claimed duplicate row for the real admin account and the actual live
  trigger were not proved by these packets.
- **#113:** confirmed behavior. Account deletion deletes both notifications
  addressed to the user and notifications whose `relatedUserId` is that user.
  Whether this caused the reported admin history loss remains unproved.
- **#114:** confirmed. Seller broadcast selects an unordered maximum of 10,000
  followers, fans out from request-lifetime `after()` work without a durable
  retry, and shares the 3,000/day email outbox. Listing/blog follower fanout is
  paginated but retains the latter two failure/priority properties.
- **Notification-adjacent clean claims:** the parameterized commission Near Me
  SQL, 200-row quality-score batching, and bounded back-in-stock claiming were
  source-confirmed. These are static/source conclusions, not fresh Production
  executions.
- **Seller-email predecessor retirement and RLS boundary:** the retirement
  transaction/owner-call-chain reasoning and the source-level no-direct-access
  sweep remain accepted. #115 is the separately prepared runtime lock; do not
  fold unrelated findings into its migration or Production workflow.
- **Review reply/account export/case evidence/middleware:** confirmed the
  non-atomic seller-reply update and missing explicit origin helper; roughly 20
  unbounded export queries; participant-or-staff case binding, staff PIN and
  60-second private signed evidence URL; and global signed-in ban/Terms gates.
  The export concern is a scalability risk rather than evidence of data loss.
- **#116:** confirmed. Local-only commission requests are visible on the
  default public board and detail/indexing paths, and interest creation does
  not enforce radius.
- **#117:** preserve the already recorded narrowing. The generic first-XFF
  trust weakness exists, but the Cloudflare-proxy premise was ruled out for the
  then-current Production topology. Do not describe it as an active
  Cloudflare-specific defect without a fresh infrastructure change/readback.
- **#118:** confirmed at source. Upload handling re-encodes but does not resize,
  the client only resizes above its size threshold, and listing cards render
  original media without responsive derivatives. The stated tens-of-megabytes
  page cost is a plausible estimate, not a measured Production trace.
- **Pickup/case cron/inbox low notes:** confirmed the shipping-title substring
  pickup inference, daily case cron, and per-page filtering of the 50-row
  message page. The exact user impact remains conditional on carrier naming,
  deadline timing and pagination depth respectively.
- **Cart/case/commission/favorite/follow/support clean claims:** source supports
  the signed shipping-rate and live-price checks, server gift-wrap/pickup
  checks, made-to-order quantity limit, batched case/commission jobs, approved
  ban authority, social notification deduplication, internal-only support/data
  email recipients and newsletter cooldown. This review did not rerun the full
  hosted Order fixture.
- **#119:** confirmed with the existing narrower scope. Expensive public page
  paths can perform uncached/unrate-limited query work, while some helpers are
  cached and the location scan is conditional. Sitemap mutable-offset paging
  and profile first-invalid-URL submission loss are also source-confirmed.
- **#120 messages:** confirmed. Staff reported-thread reads are outside the
  admin middleware boundary and have no explicit verified-PIN check.
- **#120 listing addendum:** confirmed. `listing/[id]/page.tsx` loads the row
  without a public-status predicate, treats `?preview=admin` plus EMPLOYEE or
  ADMIN role as staff preview, and `canViewListingDetail` then accepts every
  listing status and privacy/reservation state. Neither the page nor its route
  boundary verifies the admin-PIN cookie. This exposes drafts, rejected and
  pending-review listings plus private reserved custom listings to a stolen
  staff session. Seller and reserved-buyer access should remain unchanged when
  this is fixed.
- **#121:** narrow the wording. The scheduled ops-health route lacks bounded
  aggregate checks for the listed stuck refund, label-clawback, review-needed,
  reservation and payout states, and the sidebar has no flagged-order count.
  This does not prove that every individual failure path lacks Sentry or audit
  telemetry. The fixed 24-hour Stripe Connect account-create key is confirmed
  as a conditional reconnect edge case.
- **Review/case/private-listing clean claims:** confirmed review eligibility is
  rechecked under the Order lock, duplicate review submission maps to 409, and
  rating refresh is co-transactional. Current paid-checkout creation always
  produces an estimate and the case helper closes 30 days after its reference;
  legacy null estimates remain the stated exception. Ordinary private listing
  visibility is owner/reserved buyer only; #120's staff-preview exception is
  the separate gap.
- **#122:** confirmed. New, custom and edit actions accept any positive
  `shipsWithinDays`; `ListingTypeFields` has no maximum; the database has no
  matching CHECK; paid checkout uses the snapshot value in the processing
  deadline and estimated-delivery calculation; and the not-received gate/case
  window follows that estimate. A value such as 3,650 is therefore accepted
  and defers the buyer's case clock. Values outside PostgreSQL `integer` range
  fail the save; that is not the central risk. Cart/checkout do not repeat the
  listing's ships-within promise.
- **Listing numeric validation:** confirmed server-side missing bounds for
  product dimensions and the minimum-processing-days-only path. Browser
  `min=0` is not server enforcement. The database's 1..365 processing CHECK
  turns an excessive minimum with an empty maximum into a generic failed save.
- **Guild apply race:** Claude's broad statement is narrowed. Eligibility
  allows only no row or cooldown-expired REJECTED state, while staff
  approve/reject requires PENDING, so one ordinary reapplication cannot race a
  staff approve/reject from the same initial state. The unconditional upsert
  still permits a narrow stale-write race through duplicate concurrent
  applications followed by a staff decision, or a concurrent eligible
  reinstatement, and it clears review fields. Guard the write with the expected
  prior state. Returning the whole caller-owned row is unnecessary exposure,
  but after the update its reviewer fields are null.
- **Guild sales override:** confirmed behavior: `approveGuildMember` verifies
  the PIN but uses `requireStaff`, so EMPLOYEE and ADMIN can both submit
  `adminOverride`. Treat ADMIN-only as a role-policy hardening decision rather
  than evidence that current authorization contradicts an explicit source
  contract.
- **Guild eligibility/blog video clean claims:** eligibility uses the reviewed
  Order and Case authority helpers; blog video normalization enforces HTTPS,
  exact supported hosts, strict IDs and ID-derived embed URLs.
- The packets' interim "still unreviewed" lists were progress notes, not final
  findings. Later recorded deep reads cover the manual stock route, while
  earlier audit sections cover Guild jobs and blog mutation surfaces. They do
  not create a new Order release gate in this reconciliation.

### Release effect

No item in these packets invalidates the prepared #115 grant revocation. The
closest release sequence remains: publish and merge corrected #115 head only
after exact-head checks, apply its separately guarded Production migration,
then proceed to the already separate Core Order FORCE decision. #122 should be
fixed before relying on seller-entered delivery promises for long-lived new
orders. #120 is a separate staff-session confidentiality fix and should be
prepared without widening #115. Notification, browse, image and Guild items
remain separate change families.

## Drew-reported UI issues + custom listing audit 2026-09-29 (19e0cece)

### #130 (MEDIUM, visible — Drew-reported) Map maker cards only work when signed in
- `MakerMapCard.tsx:63` fetches `/api/seller/[id]/map-card`. `src/middleware.ts` `isPublic` includes `/api/seller/([^/]+)/view` but not
  `/map-card`, so signed-out requests get the middleware's JSON 401 before the route runs. The card falls into its error state and shows only the
  pin's name/location (no photo, rating, listings).
- CLAUDE.md and `tests/public-api-auth-inventory.test.mjs` treat the route as public, but the inventory test checks only route code, not middleware.
  Cross-check found this is the only inventory-public route missing from `isPublic`.
- Fix: add `"/api/seller/([^/]+)/map-card"` to `isPublic`; extend the inventory test to assert middleware reachability.

### #131 (LOW-MEDIUM, visible — Drew-reported) Homepage search dropdown briefly shows the hero headline sharply through it
- `SearchBar.tsx:434-437` overlay variant is `bg-[#F7F5F0]/64` (64% opaque) and relies on `backdrop-blur-xl` to obscure the large hero text,
  while animating in with `animate-search-pop-in` (opacity 0→1 + transform). Browsers commonly skip or delay `backdrop-filter` while an element's
  opacity is animating, so for ~180ms the headline shows through unblurred, then the blur snaps on. #129's content swap lands in the same window.
- Fix: animate transform only on the blurred surface (or put the blur on a non-animated inner layer), and/or raise the overlay background opacity
  to ~90–95%.

### #132 (MEDIUM, sitewide visual) A global unlayered CSS rule forces every input/select/textarea to ≥16px
- `globals.css:131-135` `input, textarea, select { font-size: max(16px, 1em) }` sits outside `@layer base` (which closes at L110). Unlayered
  CSS beats Tailwind utilities, so `text-xs`/`text-sm` on any form control is ignored on every screen size, desktop included.
- Result: compact controls (sort pills, filter selects, small inputs) render oversized and cramped. The iOS zoom guard only needs to apply on touch
  devices at mobile widths.
- Drew-reported shop sort: `seller/[id]/shop/SortSelect.tsx` is `h-8 … text-xs rounded-full shrink-0` but renders at 16px. Long options ("Price:
  Low to High") make it wide, and beside the `flex-1` category tabs (`shop/page.tsx:339-376`, `items-start`) it squeezes the tabs to 1–2 visible
  chips on a phone with mismatched heights. Browse uses a dedicated mobile Sort button and bottom sheet; the shop uses a native select.
- Fix: scope the rule (`@media (max-width: 767px) and (pointer: coarse)`) or move it into `@layer base`, size mobile controls for 16px; give the shop
  the same mobile sort sheet as browse, or put sort on its own row on mobile.

### #133 (LOW, visible — Drew-reported) Founding Maker and Guild badge popups are styled differently
- `GuildBadge.tsx:120-155` (inline styles): 260px, 14px padding, custom border/shadow, 48px icon inline with a 14px medium colored title,
  description #555 below, "Learn more" link, fades in, absolute (scrolls with page), zIndex 9999, no role/aria on the popup.
- `FoundingMakerBadge.tsx:138-190` (Tailwind): 280px, 16px padding, `ring-1 ring-stone-200 shadow-xl`, 40px icon in its own column, ~16px semibold
  near-black title, `text-neutral-600` body, no link, no fade, fixed positioning, z-1000, `role="dialog"`.
- Fix: extract one badge popover component (frame, width, icon layout, title/body type, link slot, positioning, focus/ARIA) and use it for both.

### Custom listings (full read: `dashboard/listings/custom/page.tsx`, `customOrderReadyLink.ts`, request route, ready-link DB function,
### paid-checkout listing updates, publish action)

#### #134 (MEDIUM, logic) A purchased made-to-order custom listing stays ACTIVE and can be bought again
- Paid-checkout order creation only flips `IN_STOCK` listings with stock ≤ 0 to SOLD_OUT (`20260926011000` ~L762-767). Nothing sets SOLD
  automatically (only the seller's manual "Mark sold").
- Custom listings default to MADE_TO_ORDER, so after the reserved buyer pays, the listing stays ACTIVE and reserved for them. The chat's "Purchase
  This Piece" card and listing page still offer Buy Now/Add to Cart. The buyer can accidentally pay twice (second tab, revisiting the link), and
  the seller sees it as an active listing.
- Fix: on paid checkout, mark private reserved listings SOLD (or SOLD_OUT) regardless of type; have the chat card reflect sold state.

#### #135 (MEDIUM, logic) Custom listings that go through review and are republished never send the buyer their link
- `sendCustomOrderReadyLink` is called only from the create page (immediate AI approval) and the staff approve route.
- If the listing is held and then rejected, or saved as draft/hidden, the seller's route back to ACTIVE is `publishListingAction`/
  `markAvailableAction` (`seller/[id]/shop/actions.ts`), which never calls it. The listing becomes buyable but the buyer gets no chat card,
  notification or email.
  (Follower fanout on that path is correctly suppressed for private listings by `publicListingWhere` and the DB notification predicate.)
- Fix: after any transition of a private reserved listing to ACTIVE, call `sendCustomOrderReadyLink` (it's source-deduplicated).

#### #136 (LOW-MEDIUM) Custom listing is created even when the link can't be delivered, and the seller isn't told
- The create action checks conversation participation and reserved user only. It doesn't check that the buyer is still active or that neither
  side has blocked the other.
- `sendCustomOrderReadyLink` returns `{ messageCreated: false }` on the DB function's 22023/42501 refusals (blocked, inactive buyer,
  conversation mismatch). The page ignores the result and redirects to the thread. The seller sees no link card and no explanation, and a private
  listing reserved for an unreachable buyer now exists. Retrying creates duplicates, which trip the duplicate-title AI rule.
- Fix: pre-check buyer state and blocks before creating; surface `messageCreated === false` as an error with next steps.

#### #137 (LOW-MEDIUM, UX) Custom listing form loses work and diverges from the regular listing form
- `<ActionForm action={createCustomListing}>` lacks `preventEnterSubmit` and `preserveOnError` (required on listing forms per CLAUDE.md), so Enter
  in Title submits, and any returned error wipes all fields and uploaded photos.
- Labels are not tied to inputs (`<label className="block text-sm mb-1">` without `htmlFor`/`id`). No character counters or `maxLength`.
- Limits differ from regular listings: title capped at 150 (regular 100) and description at 5000 (regular 2000), silently truncated.
- `processingTimeMaxDays`/`MinDays` are not validated to 1..365 or min ≤ max before insert, so bad input hits `Listing_processing_days_valid_chk`
  and surfaces as a thrown server error instead of an inline message. `shipsWithinDays` is unbounded (#122).

#### #138 (LOW-MEDIUM) Photos that fail upload verification are dropped silently, and original/crop pairing can shift
- `filterVerifiedFirstPartyMediaUrlsForUser` (`uploadPersistenceVerification.ts:155-192`) drops any URL that fails verification with no error.
  New and custom listing actions filter `imageUrls` and `imageOriginalUrls` independently, then pair them by index (`originalUrl:
  imageOriginalUrls[i] ?? url`).
- One failed photo silently disappears from the listing. One failed original shifts every later photo to the wrong original, so "Re-crop" opens a
  different photo. Verification runs sequentially (up to 20 R2 checks per submit, twice for uncropped photos where original == url).
- Fix: verify as pairs, keep index alignment (or skip the pair), and return a user-visible error when any submitted photo fails.

#### LOW
- Custom request budget is stored as `cents/100` numeric (`grainline_message_send_custom_request`) and rendered as `$${budget}` in
  `ThreadMessages.tsx:458` and `dashboard/listings/custom/page.tsx`, giving "$50.5" and "$1200". Use `formatCurrencyCents`.
- Custom listing page uses `p-8` on mobile (#128).
Checked clean: seller must be a participant and `reservedForUserId` must equal the other participant; photos are first-party verified; ready link
is source-deduplicated and locked on listing/conversation state; private listings are excluded from follower fanout and public surfaces; the paid
checkout rejects private listings for anyone but the reserved buyer.
- #131 correction (Drew, 2026-09-29): the see-through overlap happens only during the first split second while the placeholder ("category-like")
  list is showing; once real suggestions render it looks right. Consistent with the cause: the placeholder list is what's on screen during the
  ~180ms `animate-search-pop-in` opacity animation, when browsers skip `backdrop-filter`. By the time the swap happens the animation has ended and the blur
  applies. Fixing #129 (no placeholder list; tags preloaded) plus removing the opacity animation (or raising opacity) on the blurred surface
  removes it completely.

### #139 (LOW-MEDIUM, visible — Drew-reported) Horizontal scroll rows missing the site's scroll fade
- The site convention is `ScrollFadeRow` (right-edge fade, left fade after scrolling, end detection). 11 rows use it. 17 `overflow-x-auto` rows
  don't. User-facing ones:
  - Listing detail photo thumbnail strip (`ListingGallery.tsx:210`)
  - Recently Viewed rows (`RecentlyViewed.tsx:71,83`, both loading and loaded states)
  - City browse category chips (`browse/[metroSlug]/page.tsx:282`, `browse/[metroSlug]/[category]/page.tsx:231`)
  - Seller profile "Stories from the Workshop" mobile row (`seller/[id]/page.tsx:975`); the other rows on that page use `ScrollFadeRow mobileOnly`
  - Workshop dashboard "My Listings" mobile row (`dashboard/page.tsx:556`)
  - Seller analytics range pills and table (`dashboard/analytics/page.tsx:655,1099`)
  - Fee comparison table on `/why-sell-on-grainline` (`:72`), which scrolls sideways on phones with no cue
  - Commission board category chips (`commission/page.tsx:396`) use `flex-wrap` plus `overflow-x-auto`, so they wrap here while every other
    chip row scrolls with a fade
- Admin tables and `AdminMobileNav` also lack it (lower priority).
- Fix: wrap each in `ScrollFadeRow` (with `hideAtBreakpoint` where the row becomes a grid); for tables, add a fade/shadow on the scroll edge.

### #140 (LOW-MEDIUM, visible) Error pages are three different designs, and "Try again" often can't recover
- `src/app/error.tsx` ("Something splintered."): centered, icon, `font-display text-3xl`, neutral buttons. `browse/error.tsx`: red alert card,
  `rounded-lg`, serif h2, dark bare-border buttons. `listing/[id]/error.tsx`: different red card, `rounded-xl`, sans h2, 4px-radius buttons,
  "Back to Browse".
- Only `/browse` and `/listing/[id]` have their own boundaries. Everything else (dashboard, account, messages, cart, checkout, seller pages) falls
  back to the global page.
- All three call `reset()` only. For errors thrown while rendering on the server, Next's `reset()` re-renders without re-fetching server data,
  so "Try again" typically shows the same error. The documented pattern is `startTransition(() => { router.refresh(); reset(); })`.
- No `error.digest` is shown, so a user can't give support a reference to find the Sentry event.
- Server-side throw sites found (for triage if Drew identifies the page): `dashboard/verification` (Order/Case verification authority returning
  null), buyer/seller order detail (case message preflight null for a visible case), `messages/[id]` send transaction, `admin/cases/[id]`, and the
  RLS read wrappers' `TypeError` shape guards. The DB functions reviewed (`grainline_order_seller_verification_sales`,
  `grainline_case_seller_verification_eligibility`, `grainline_case_message_preflight`) return rows for normal owners, so none is a routine trigger.

### LOW
- Listing detail loading skeleton `max-w-7xl p-4 sm:p-8` vs page `max-w-[1600px] px-4 sm:px-6` (`listing/[id]/loading.tsx`), so the layout widens and
  shifts when the listing loads on wide screens. All other route skeletons match their pages' widths.

### #141 (LOW-MEDIUM, visible) Message thread polish issues (`src/components/ThreadMessages.tsx`, full read)
- Timestamps: 4 sites render `new Date(m.createdAt).toLocaleString("en-US")` inside a client component (L435, L478, L509, L632). SSR renders in the server
  timezone (UTC on Vercel), then the browser re-renders in local time, causing a hydration mismatch and visibly changing times on load. The format
  includes seconds ("9/29/2026, 3:04:12 PM") and repeats under every message. Use `LocalDate`/a relative formatter; group by day or show on the
  last message of a run.
- Bubble text uses `break-all` (L627), which splits ordinary words at any character when wrapping. `[overflow-wrap:anywhere]`/`break-words`
  handles long URLs without breaking normal words.
- Other participant avatar with no image renders an empty gray circle (L602-607) with no initials fallback (`avatarInitials()` is the site
  convention), and uses `ring-1 ring-neutral-200`, the hairline Drew rejected for content avatars.
- Structured cards use three different CTA styles in the same thread: Commission Interest teal outline (L429), Custom Order Request espresso
  (L471), Custom Piece Ready black (L502). Their surfaces are teal-50 / amber-50 / white respectively.
- The "Custom Piece Ready" card keeps its "Purchase This Piece" CTA regardless of listing state (see #134).
- Server re-renders replace the whole list with `initial` (L155-160 effect on `initial` identity), dropping any "Load earlier" history and jumping
  to the bottom after each send. No "new messages" indicator when a message arrives while scrolled up (`apply` only scrolls if already at bottom).
- PDF attachments without file metadata show a hard-coded "Document.pdf" name (L585). Image attachments use `alt="attachment"`.

### #142 (MEDIUM, visible correctness) Dates render in UTC on the server, and client components format dates during SSR
- ~60 server-component sites call `toLocaleDateString/toLocaleString("en-US")` with no `timeZone`. On Vercel that is UTC, so for US users every date
  created in the evening shows the next day. User-facing sites include: `account/page.tsx:206,293`, `account/reviews:81`, `account/saved:221`,
  `account/saved-searches:109`, `account/following:135,147`, `account/commissions:129`, `ReviewsSection.tsx:263,345,397` (listing reviews and seller
  replies), `blog/[slug]:281,486`, `blog/page.tsx:460,515`, `blog/author:187`, `commission/page.tsx:34`, `commission/[param]:350`,
  `dashboard/page.tsx:511,762`, `dashboard/blog:198`, `dashboard/seller:276` (payout failure date), `dashboard/verification:358,645,663,676,708`,
  homepage blog cards (`page.tsx:1127`) and the "Maker of the Week" date range (`page.tsx:504-505`). Admin pages show full UTC times with no "UTC" label.
- Client components that format dates in their first render (so SSR uses UTC and hydration swaps to local time, with a React mismatch):
  `OrderTimeline.tsx:50,60` (buyer/seller order pages, includes times), `LabelSection.tsx:86`, `BlogReplyToggle.tsx:74,116`,
  `BroadcastComposer.tsx:136`, `ThreadMessages.tsx` (#141).
- Existing good pattern: `LocalDate` / `MessageTime` render on the client only. CLAUDE.md records a 2026-04-21 pass that converted 5 sites; most
  remain.
- Fix: route display dates through `LocalDate` (client, `dateOnly` where appropriate), or pass an explicit display `timeZone` (e.g. the viewer's
  saved zone, or America/Chicago as a site default) for server-rendered dates. Label admin times with their zone.

### #143 (MEDIUM, custom listings) Hiding a custom listing permanently traps it as "Archived"
- The Workshop list (`dashboard/page.tsx:260`, all listings for the seller including private custom ones) offers "Hide" on any ACTIVE listing
  (`hideListingBlockReason` allows ACTIVE/SOLD_OUT; shop actions do the same).
- The app uses `status === HIDDEN && isPrivate` as the definition of "Archived" (a soft-deleted listing): `dashboard/page.tsx:559`,
  `unhideListingBlockReason` ("Archived listings cannot be unhidden"), `publishListingBlockReason` ("Archived listings cannot be republished").
  Custom listings are always `isPrivate`, so a hidden custom listing is indistinguishable from an archived one: the card turns unlinkable with an
  "Archived" pill, and Unhide, Publish and Edit are unavailable. The seller must recreate the piece (new AI review, duplicate-title risk, a second
  buyer link).
- Also: nothing on the card says a listing is a private custom piece or who it's reserved for.
- Fix: represent archival explicitly (a dedicated flag or status) rather than overloading `isPrivate`; until then block Hide for reserved
  custom listings or allow unhide when `reservedForUserId` is set. Show a "Custom · reserved for {buyer}" label.

### LOW (Workshop dashboard, full read of `dashboard/page.tsx`)
- Status line prints raw enum values for ordinary statuses ("ACTIVE", "DRAFT", "SOLD", "SOLD_OUT" with underscore, uppercase) (`:610-624`); only
  Archived/Under Review/Rejected get styled pills. The shop page uses friendly labels and colored pills.
- Four banners on one page with three corner styles: setup banner `rounded-lg`, listing warnings `rounded-md`, Stripe banner and vacation banner
  square (`:492`, `:505`), and the vacation "Turn off vacation mode →" button is square too (`:518`, a raw `<a>` causing a full page reload). The
  Stripe banner's text and link sit side by side with no wrap on phones.
- SOLD listings have no "Mark available" action here (the shop page has it).
- Workshop h1 is `text-4xl font-bold` (another title size; see LOW typography note).
- "Saved Searches" (a buyer feature, also at `/account/saved-searches`) is rendered on the seller Workshop page (`:716`).

### #144 (LOW-MEDIUM, "doesn't match") Order status pills and account-page styling are inconsistent
- Status colors differ by page: `account/page.tsx:134-146` and `account/orders/page.tsx:92-102` use PENDING gray / READY_FOR_PICKUP amber / SHIPPED
  blue, while `dashboard/sales/page.tsx:42-46` uses PENDING amber / READY_FOR_PICKUP blue. `/dashboard/orders` shows no status pill. Account pages
  use a local `formatStatus` instead of `fulfillmentStatusLabel()`, which CLAUDE.md says all order/case status labels should use. Put label and
  color in one shared helper.
- `/account` Saved Items cards crop photos `aspect-[4/3]` (`:247`); the site-wide product photo standard is `aspect-[4/5]`, so the same listing
  is framed differently here.
- `/account` mixes three CTA treatments across sibling sections: underlined text links (Orders "View all", Reviews, Commissions, Settings), bordered
  buttons (Following "Manage", Saved Searches "Open", blog links), and black primary buttons (Workshop, Sell). Order rows link to
  `/dashboard/orders/[id]` while "View all" goes to `/account/orders` (#126). The header avatar has a dark bare border (#125).

### #145 (LOW-MEDIUM, "doesn't match") Tag chips use five different styles
- CLAUDE.md pill standard: borderless cream `bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]` (used correctly by blog share pills,
  `blog/[slug]/page.tsx:378,386`). Tag chips instead use:
  - listing detail `listing/[id]/page.tsx:737`: bordered `bg-[#F7F5F0]`, 11px, hover white
  - tag landing related tags `tag/[slug]/page.tsx:264`: bordered white, hover `amber-50`
  - seller profile "What I make" `seller/[id]/page.tsx:837`: borderless `bg-stone-100`, hover stone-200
  - blog tag cloud `blog/page.tsx:393`: white with dark bare border (#125)
  - browse filter tags `FilterSidebar.tsx:273`: bordered `bg-[#F7F5F0]`, hover white
- Fix: one `TagChip` component with the standard pill style (size variants only).
Seller profile page (1038 lines, sampled headings/pills/buttons): section h2s are consistent (`text-xl sm:text-2xl font-display font-semibold`);
"From the Workshop" (gallery) and "Stories from the Workshop" (blog) are easily confused section names on the same page.

### LOW (Buy Now / cart purchase flow, read in full: `BuyNowCheckoutModal.tsx`, cart gift/payment steps)
- On the payment step, a backdrop tap (`BuyNowCheckoutModal.tsx:300`) or Escape (`useDialogFocus`) closes the modal with no confirmation and rolls back
  the Stripe session; reopening restarts at shipping selection (the signed rate is cleared). A stray tap while typing card details discards
  checkout. Consider disabling backdrop-close on the payment step, or confirming first.
Checked clean: body scroll locked while open; gift note/wrap only editable before a session exists (Buy Now shipping step; cart review step), so
no uncharged gift wrap; session resume and stale-response guards via request counters. The CLAUDE.md note that cart gift options render on the
payment step is stale.

## Launch triage key (for Drew's post-RLS pass)
- LAUNCH BLOCKERS (money/data/trust): #108, #121, #124, #134, #135, #143, #130, #116, #122, #112/#113 (admin notification loss), #115, #105 (rotations)
- SHOULD FIX BEFORE LAUNCH (visible quality): #125, #126, #129/#131, #132, #142, #140, #136, #137, #138, #110, #111, #120
- POLISH AFTER LAUNCH: #127, #128, #133, #139, #141, #144, #145, remaining LOW items

### Deep read: `grainline_stripe_checkout_order_create` (20260926011000, all 826 lines)

#### #146 (LOW-MEDIUM, money/trust) Paid sales are auto-refunded based on seller/listing state at webhook time, not payment time
- Invalid reasons are evaluated against current rows when the webhook is processed (`L293-313` seller, `L467-497` listing), and the text says
  "... before payment completion". The event is often processed seconds later, but Stripe retries a failing webhook for up to 3 days.
- Soft, seller-controlled states count as invalid: `vacationMode`, `NOT acceptingNewOrders`, and listing status not ACTIVE (only exception:
  IN_STOCK SOLD_OUT with stock 0). So a real sale is automatically refunded if, between payment and webhook processing, the seller turns on
  vacation, pauses orders, hides the listing, marks it sold, or saves an edit (ACTIVE listings flip to PENDING_REVIEW during AI re-review, for
  seconds or for hours if flagged). The refund review note then misstates the cause.
- Hard states (ban, deletion, Stripe account change/deauthorization, reservation reassignment) are reasonable refund triggers. For soft states,
  compare against `p_paid_at` (e.g. record when vacation/acceptingNewOrders/listing status last changed), or hold the order for seller
  confirmation instead of auto-refunding.

#### Notes
- The amount identity check (`chargedTotal = items + shipping + tax + giftWrap`, L183-194) is correct for today (no discounts, exclusive tax). If
  promotion codes/coupons or tax-inclusive pricing are ever enabled, every paid checkout will fail this check and strand without an Order. Record as
  a constraint to update alongside any discount feature.
- The address-mismatch review (`L533-545`) compares `quotedTo*` with `shipTo*`, but the webhook derives both from the same session metadata, so it
  can never trigger. Harmless today (address is collected in the cart UI); remove it or compare against Stripe's collected address if that ever changes.
Checked clean: signed-event lease + exact reservation binding, session advisory lock ordering matching reservation repair, actor/seller/listing
locks in id order, strict provider JSON allowlist with bounds, per-item price recomputed from the retained snapshot (base + variant adjustments) and
matched to Stripe's unit amount, subtotal and gift-wrap cross-checks, replay drift detection, buyer PII withheld when the buyer is invalid.

### Deep read: seller refund route (`api/orders/[id]/refund/route.ts`, all 263 lines) + provider resolution

#### #147 (MEDIUM, money/ops) Any Stripe refund error locks the order for manual staff reconciliation, and the seller sees "Server error"
- `resolveOrderRefundProviderOutcome` → `createMarketplaceRefund` throws on any Stripe error. Without a refund id, the route marks the claim
  AMBIGUOUS (`markOrderRefundClaimAmbiguous`, route L229-241) and returns a generic 500 "Server error".
- That covers transient failures (timeouts, 5xx, connection reset) and definitive rejections (e.g. charge too old to refund, insufficient
  platform balance for a platform-funded refund) alike. Per CLAUDE.md, ambiguous claims are never released by time alone. The seller's next
  attempt gets a conflict, and the buyer isn't refunded until staff use the immutable reconciliation tool. Nothing alerts staff (#121).
- The claim already carries a fixed idempotency scope, and the replay path supports safe re-creation within the 23h window, so transient errors
  could be retried by the same seller request (or a short automatic retry) instead of escalating. Definitive `StripeInvalidRequestError` codes
  are knowable no-effect outcomes and could release the claim with a specific, actionable message.
- Same pattern in blocked-checkout auto-refunds (#124, plus pre-provider failures swallowed). Consider one refund-failure policy:
  retry transient → release on definitive no-effect with a user-facing reason → escalate only true ambiguity, with an ops-health alert.
Checked clean: cross-origin guard, rate limit, account-state check, bounded body, seller partial refunds rejected (UI updated to match), full
refunds reject caller-supplied stock restores, DB preflight + generation-fenced claim with a 23514 label-race corroboration, finalize retried once
when a refund id exists, stock restoration and caches handled from the finalize result.
- #147 addendum: staff Case resolution (`api/cases/[id]/resolve/route.ts`, full read, 324 lines) follows the same policy: any
  `createMarketplaceRefund` error → `recordAmbiguousCaseStaffResolutionProvider` → 500 "Server error". Its "refund succeeded but record failed" path is
  sound: the claim stays PROVIDER_PENDING, and a staff retry reuses the idempotency scope so Stripe returns the same refund. Admin PIN, rate limit,
  partial-refund input validation and restoreStock limited to REFUND_PARTIAL all verified.

### LOW (seller onboarding, `OnboardingWizard.tsx` 760 lines, sampled all steps + full read of "Get Paid")
- The "Connect Stripe" action has three colors across the app: Stripe purple `bg-[#635bff]` in onboarding (`:526,536`), espresso in Shop Settings
  (`StripeConnectButton`, per CLAUDE.md), dark amber `bg-amber-900` in the Workshop setup banner (`dashboard/page.tsx:321`). Pick one.
- No-account state repeats the same requirement twice in two styles: grey helper text under the button (`:541-544`) and an amber box directly below
  (`:554-557`). The incomplete-account state stacks an amber status card plus the same amber box.
- Copy "Setup takes 2 minutes" understates Stripe identity verification, which can take days for some sellers. Consider "usually a few minutes".
Otherwise consistent: black primary CTAs, serif step headings, progress bar, back/skip controls.

### #148 (MEDIUM-LOW, logic/UX) Notification toggles are split by role, but the preference keys are shared, so toggles cross-affect
- Preferences are keyed by `NotificationType`; `/account/settings` (buyer) and `/dashboard/seller` (seller) each render a subset (full read of both lists).
- `NEW_ORDER` is used for the buyer's "Order confirmed!" and the seller's "New sale! Congrats!" (webhook `enqueueOrderPostPaymentSideEffects`). Only the
  buyer page exposes it ("Order confirmed"), so a seller who turns that off silently loses in-app new-sale alerts, and has no seller-side toggle.
- `REFUND_ISSUED` appears on both pages ("Refunds" / "Refunds issued") and `EMAIL_CUSTOM_ORDER` on both ("Custom order updates"). Flipping one
  flips the other.
- `NEW_MESSAGE` (in-app) is only on the seller page, so buyer-only accounts cannot turn off in-app message notifications. `CASE_MESSAGE` is only on the
  buyer page but also governs sellers' case messages.
- Subtitle "These appear in your notification bell and are sent to your email" (`account/settings/page.tsx:~90`) is inaccurate; sections are
  in-app-only or email-only.
- Fix: one settings page with all keys relevant to the account (seller rows shown when `hasSeller`), or split preference keys by audience.
  Interacts with #111 (default-off not enforced).

## Coverage tracker (started 2026-09-29, origin/main 19e0cece). Totals: src ≈119.7k lines (lib 38.6k, components 20.8k,
## dashboard 11.0k, admin 5.4k, API routes ≈24k), migrations ≈59.7k SQL lines.
Legend: FULL = read line by line this campaign; PART = specific functions/sections; SWEEP = pattern sweeps only.
- FULL: api/stripe/webhook/route.ts; api/orders/[id]/refund; api/cases/[id]/resolve; api/listings/[id]/stock; dashboard/listings/custom/page.tsx;
  components/ThreadMessages.tsx; account/settings/page.tsx; lib/customOrderReadyLink.ts; grainline_stripe_checkout_order_create (SQL);
  grainline_notification_create_core (SQL, core + message/commission/followed branches); SearchBar.tsx focus/dropdown path.
- PART: dashboard/page.tsx; account/page.tsx; seller/[id]/page.tsx; cart/page.tsx; BuyNowCheckoutModal.tsx; checkout/success; api/cart/checkout-seller;
  api/commission/[id]/interest; api/verification/apply; api/stripe/connect/create; middleware.ts (matchers + gate order); OnboardingWizard;
  NotificationBell; notificationOwnerAccess; quality-score; broadcast route; listing new page action; upload image; Header.tsx.
- SWEEP (all files): borders/colors/radii/typography/h1, dates/timezones, scroll rows, error boundaries, loading skeletons, raw SQL, dangerouslySetInnerHTML,
  Math.random, unbounded findMany, server-action rate limits, API origin/rate-limit coverage, RLS direct/relation/raw access, grants.
- NOT YET: most of lib/ (≈35k), most components (≈17k), admin pages, blog create/edit, cron routes (except case-auto-close, commission-expire,
  quality-score, ops-health), remaining api/cart, api/shipping, api/upload presign/verify, api/account delete/export, accountDeletion.ts.
Order of work (risk): api/cart checkout routes → api/shipping quote → accountDeletion + api/account → upload presign/verify → cron routes →
lib money/state helpers → admin pages → remaining components/pages.

### #149 (MEDIUM-LOW, trust/safety) Blocked users can still buy from each other
- No cart or checkout path checks the `Block` table: `api/cart/add`, `api/cart/update`, `api/cart/checkout-seller`, `api/cart/checkout/single`, their resume
  routes, the checkout reservation DB functions, and `grainline_stripe_checkout_order_create` (0 references to "Block"). The only "block" matches are
  `sellerOrderBlockReason` (seller availability).
- Listing detail 404s for blocked pairs, but an item already in the cart before the block, a saved listing URL used after unblock/reblock, or a direct
  POST to the Buy Now/cart checkout routes still completes. The seller then has to fulfill for (and sees the name/address of) someone they blocked,
  and messaging between them is refused, so the order can't be discussed.
- Fix: reject at cart add/update and both checkout routes (reciprocal block), re-check in the reservation function, and include "blocked" as a
  blocked-checkout invalid reason at order creation.
