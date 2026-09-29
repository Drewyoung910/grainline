# Security Review: grainline-clerk-legal-provenance-20260903

## Scope

Read-only broad current-source audit prioritizing financial integrity, security/RLS, runtime behavior and scalability. Candidate worktree, not live production attestation.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_sha256_3bc7385fc517b1b2d10077501a79effb63726a433c52b3801daf9da64c14556b
- Revision: bc1ff4d151572086f8d8ca6740256728e6da91e8
- Snapshot digest: codex-security-snapshot/v1:sha256:a332ddab0c8128cb8f0d1620c9d44b471d21b1ec89949008717f8c00346f28c3
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: No application/provider execution or production access.
- Artifacts reviewed: next.config.ts, src/middleware.ts, src/lib/security.ts, src/lib/db.ts, src/lib/ensureUser.ts, src/lib/ensureSeller.ts, src/lib/urlValidation.ts, src/lib/uploadedFileUrl.ts, src/lib/sanitize.ts, src/lib/blogMarkdown.ts, src/lib/json-ld.ts, src/lib/publicMediaAvailability.ts, src/lib/requestBody.ts, src/lib/adminPin.ts, src/lib/adminPinApi.ts, src/lib/cronAuth.ts, src/lib/apiAccountAccess.ts, src/lib/internalReturnUrl.ts, src/lib/orderSellerRefundPreflightAuthority.ts, src/lib/checkoutAmounts.ts, src/lib/shipping-token.ts, src/lib/adminPageAccess.ts, src/lib/orderStaffReadDb.ts, src/lib/orderStaffReadAuthority.ts, src/lib/requestOriginGuard.ts, src/lib/accountExportReverification.ts, src/lib/ai-review.ts, src/app/api/upload/presign/route.ts, src/app/api/upload/verify/route.ts, src/app/api/upload/image/route.ts, src/app/api/admin/verify-pin/route.ts, src/app/api/account/accept-terms/route.ts, src/app/api/account/delete/route.ts, src/app/api/account/export/route.ts, src/app/api/cart/checkout/rollback/route.ts, src/app/api/cart/checkout/single/resume/route.ts, src/app/api/cart/checkout-seller/route.ts, src/app/api/stripe/connect/create/route.ts, src/app/api/stripe/connect/dashboard/route.ts, src/app/api/stripe/connect/login-link/route.ts, src/app/api/orders/\[id\]/refund/route.ts, src/app/api/cases/\[id\]/attachments/\[attachmentId\]/route.ts, src/app/api/listings/\[id\]/stock/route.ts, src/app/api/blog/route.ts, src/app/api/reviews/route.ts, src/app/api/clerk/webhook/route.ts, src/app/api/messages/\[id\]/list/route.ts, src/app/api/messages/\[id\]/stream/route.ts, src/app/admin/actions.ts, src/app/admin/layout.tsx, src/app/admin/orders/page.tsx, src/app/admin/orders/\[id\]/page.tsx, src/app/admin/orders/\[id\]/refundReconciliationActions.ts, tests/admin-pin.test.mjs, src/lib/marketplaceRefunds.ts, src/lib/orderRefundClaimAuthority.ts, src/lib/orderRefundProviderReconciliation.ts, src/lib/orderRefundFinalization.ts, src/lib/orderRefundRecordAuthority.ts, src/app/api/orders/\[id\]/label/route.ts, src/lib/labelClawbackRetry.ts, src/lib/labelClawbackState.ts, src/app/api/cron/label-clawback-retry/route.ts, src/app/api/cart/checkout/single/route.ts, src/app/api/cart/checkout/resume/route.ts, src/lib/checkoutStockReservationAuthority.ts, src/lib/checkoutReservationSourceState.ts, src/lib/checkoutStockRestore.ts, src/lib/checkoutSessionExpiry.ts, src/lib/checkoutSessionLock.ts, src/lib/checkoutLockState.ts, prisma/migrations/20260905050000_prepare_order_seller_refund_preflight_authority/migration.sql, tests/label-clawback-state.test.mjs, src/app/api/cron/guild-metrics/route.ts, src/lib/cronBatchState.ts, src/lib/cronRun.ts, src/lib/cronRunState.ts, src/lib/metrics.ts, src/components/ThreadMessages.tsx, src/lib/messageStreamState.ts, src/lib/messagePolling.ts, src/lib/stripe.ts, src/lib/notifications.ts, src/lib/systemAudit.ts, src/lib/emailRetry.ts, src/app/map/page.tsx, src/components/AllSellersMap.tsx, src/app/api/search/suggestions/route.ts, src/lib/searchSuggestionState.ts, prisma/migrations/20260426191000_search_scale_indexes/migration.sql, prisma/migrations/20260622121000_seller_display_name_trgm_indexes/migration.sql, src/components/NotificationBell.tsx, src/app/api/notifications/route.ts, src/app/api/notifications/\[id\]/read/route.ts, src/app/api/notifications/read-all/route.ts, src/app/dashboard/notifications/page.tsx, src/lib/notificationOwnerAccess.ts, src/components/MessageComposer.tsx, src/components/ActionForm.tsx, src/components/R2UploadButton.tsx, src/hooks/useR2Upload.ts, src/lib/messageAttachments.ts, src/app/messages/\[id\]/page.tsx, src/components/MarkReadClient.tsx, src/components/MessageIconLink.tsx, src/components/UnreadBadge.tsx, src/app/api/messages/\[id\]/read/route.ts, src/app/api/messages/unread-count/route.ts, tests/message-attachments.test.mjs, src/components/CustomOrderRequestForm.tsx, src/app/api/messages/custom-order-request/route.ts, src/lib/customOrderRequestAccess.ts, src/app/dashboard/listings/custom/page.tsx, src/lib/customOrderReadyLink.ts, src/components/ThreadCustomOrderButton.tsx, src/components/ReviewComposer.tsx, src/app/api/reviews/\[id\]/route.ts, src/app/api/reviews/\[id\]/reply/route.ts, src/components/ReviewsSection.tsx, src/components/ReviewItemClient.tsx, src/components/ReviewListingButtons.tsx, src/components/VariantSelector.tsx, src/components/ListingTypeVariantSection.tsx, src/components/ListingTypeFields.tsx, src/components/ListingPurchasePanel.tsx, src/components/BuyNowButton.tsx, src/components/AddToCartButton.tsx, src/lib/listingVariants.ts, src/lib/anonymousCart.ts, src/lib/anonymousCartMerge.ts, src/components/ReviewPhotosPicker.tsx, src/lib/reviewPhotoState.ts, src/lib/listingVisibility.ts, src/lib/stockMutationState.ts, src/lib/orderPaidCheckoutAuthority.ts, src/app/api/cart/add/route.ts, src/app/api/cart/route.ts, src/app/account/reviews/page.tsx, tests/review-photo-state.test.mjs, tests/anonymous-cart.test.mjs, tests/listing-variants.test.mjs, src/components/CaseReplyBox.tsx, src/components/CaseMarkResolvedButton.tsx, src/components/CaseEscalateButton.tsx, src/components/CaseResolutionPanel.tsx, src/components/OpenCaseForm.tsx, src/lib/caseActionState.ts, src/lib/caseCreateState.ts, src/lib/caseMessagingState.ts, src/lib/caseResolutionCopy.ts, src/lib/caseMessageAuthor.ts, src/lib/caseReadAuthority.ts, src/app/api/cases/route.ts, src/app/api/cases/\[id\]/messages/route.ts, src/app/api/cases/\[id\]/mark-resolved/route.ts, src/app/admin/cases/\[id\]/page.tsx, src/app/api/cron/case-auto-close/route.ts, src/app/api/orders/\[id\]/confirm-delivery/route.ts, src/lib/orderFulfillmentFinalization.ts, prisma/migrations/20260729050000_prepare_case_participant_resolution_authority/migration.sql, tests/order-fulfillment-product-audit.test.mjs, tests/case-action-state.test.mjs, src/app/cart/page.tsx, src/app/api/cart/update/route.ts, src/components/FavoriteButton.tsx, src/app/api/favorites/route.ts, src/app/api/favorites/\[listingId\]/route.ts, src/app/account/saved/page.tsx, src/components/SaveSearchButton.tsx, src/app/api/search/saved/route.ts, src/app/account/saved-searches/page.tsx, src/lib/savedSearchOwnerAccess.ts, src/components/NotificationToggle.tsx, src/app/api/account/notifications/preferences/route.ts, src/app/account/settings/page.tsx, src/lib/notificationPreferenceKeys.ts, src/lib/notificationPreferenceState.ts, src/lib/notificationEmailPreferences.ts, src/lib/notificationDeliveryPreferences.ts, tests/header-favorite-cart-review-regressions.test.mjs, tests/notification-delivery-preferences.test.mjs, src/lib/databaseUrl.ts, src/lib/dbUserContext.ts, src/lib/dbUserContextState.ts, src/lib/ratelimit.ts, src/lib/ratelimitPolicy.ts, src/lib/shippingQuoteProvider.ts, src/lib/shippingRateBounds.ts, src/app/api/shipping/quote/route.ts, src/lib/r2.ts, src/lib/fetchWithTimeout.ts, src/lib/responseText.ts, src/lib/accountStateCache.ts
- Scan context: Current user requested multi-agent audit, pause implementation, preserve findings beyond compaction and expand after priorities into ordinary product bugs. Runtime/product handoff saved at /Users/drewyoung/grainline/docs/audits/2026-09-07-runtime-review.md outside immutable scan target.

Limitations and exclusions:
- Source snapshot review only; no production/provider execution or live posture verification.
- One additional security worker pass was blocked by platform screening; no bypass attempted.
- Coverage partial, not all 2409 repository files fully reviewed.
- Excluded production/provider-state: No production database catalog, rows, credentials, provider configuration, signed event delivery or deployment inspected.
- Excluded runtime/browser/load-execution: No browser/application execution, provider-failure injection, query plan or load testing performed.
- Excluded unreviewed-current-source: Not all 2409 scoped files or all 14 documented RLS-live table families independently re-audited. 193 distinct complete file reads, plus targeted sections; mapping/grep does not count as complete review.
- Excluded blocked-additional-rls-worker: Additional RLS-focused worker blocked by platform screening; no bypass or equivalent restricted rerun attempted.
- Excluded older-unopened-attachments: Historical attachments beyond the three latest consolidated Claude review files were not all individually reopened; dated claims reconciled through current audit/runbook records.

### Scan Summary

| Field | Value |
| --- | --- |
| Scan outcome | completed |
| Reportable findings | 1 |
| Severity mix | medium: 1 |
| Confidence mix | high: 1 |
| Coverage | partial |
| Validation mode | static_source_review |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Grainline is a Next.js marketplace using Clerk-backed local users, PostgreSQL authority functions/RLS, Stripe money flows, Shippo labels, R2 uploads, Redis limits/locks and scheduled jobs. Review covers the current candidate worktree, not deployed state. Public discovery, participant operations, staff operations, provider webhooks and cron/maintenance have distinct entry points. Mapping is not equivalent to complete source audit.

### Assets

- Local User identity, roles, bans/deletion posture; private order addresses, cases, messages and attachment content.
- Order amounts, stock/reservation state, refunds, transfer reversals, payout projections and idempotent provider-event processing.
- Ordinary DATABASE_URL runtime pool (max10 per process), separate ORDER_STAFF_READ_DATABASE_URL pool (max2 per process, also supports reviewed mutations); both credentials inhabit the same application process.
- Public R2 bearer URLs versus separately authenticated private Case evidence downloads; provider/Clerk/Redis/cron secrets and protected migration/cleanup credentials.

### Trust Boundaries

- Untrusted HTTP -\> Clerk authentication -\> current local account posture. Middleware protects roles, but Admin GET page PIN protection currently relies on layout; APIs/actions check PIN separately (middleware.ts309-338, adminPageAccess.ts7-18, admin/layout.ts23-32).
- Trusted application actor -\> transaction-local PostgreSQL user/role settings via dbUserContext.ts25-64 -\> fixed authority functions. GUC setters are trusted-server controls, not a cryptographic identity boundary against arbitrary server code.
- Ordinary versus staff database client uses separately validated role/URL identity (orderStaffReadDb.ts33-94); staff credentials are not an independent process boundary. Owner/migration and DirectUpload cleanup workflows have separate intended credentials; actual production grants were not queried.
- Stripe platform, classic Connect and v2 webhook routes verify distinct signing secrets before event processing; identities/amounts/replays additionally checked by authority consumers. Actual current Stripe mode and endpoint configuration were not inspected.
- Upload presign/image/verify routes bind user-generated keys, allowed endpoint, bytes/type/size and expiry. Public objects remain bearer-accessible. Case evidence has feature flag, case participation/staff PIN and lifecycle checks before signed private GET; separate bucket names alone do not attest provider privacy.
- Cron requests require primary or previous Bearer secret with timing-safe comparison; missing primary fails closed. Manual production migration workflow has exact commit/confirmation, serialized protected environment and step-scoped owner credentials; external reviewer settings remain unknown.
- Redis supplies per-user/IP rate windows and locks, with path-specific fail-closed/open choices. Local database pool maxima, route batch sizes and page limits do not establish fleet-wide throughput or resumable work.

### Attacker Capabilities

- Anonymous visitors can supply public request inputs but cannot assume valid Clerk sessions, webhook signatures, protected workflow credentials or provider secrets.
- Ordinary buyers/sellers can control their own allowed listing/cart/message fields and request timing; they cannot legitimately substitute another authenticated actor.
- A staff Clerk session has more access than a normal user, while sensitive admin access is intended to additionally require a session-bound Admin PIN.
- Arbitrary server code would have access to same-process runtime/staff/provider credentials. This review does not claim RLS prevents every consequence of application RCE.

### Security Objectives

- Preserve participant/privacy boundaries and intended staff step-up checks at data-access boundaries, not only UI rendering.
- Maintain exact financial/provider identity, idempotency, generation fencing and atomic stock/payment/notification effects across retries, ambiguity and crashes.
- Keep public assets and private evidence clearly separated, with correct owner/participant access and bounded upload processing.
- Preserve ordinary/staff/owner/cleanup privilege separation and fail-closed SQL inputs without relying on incidental downstream constraints.
- Bound shared-resource consumption and preserve progress under serverless deadlines; distinguish registered users from concurrent workload.

### Assumptions

- Snapshot is bc1ff4d151572086f8d8ca6740256728e6da91e8 plus preserved uncommitted Order proof work. Production catalog, deployment, traffic, provider state, quotas, query plans and secrets were not accessed.
- Dated coverage documentation describes 14 FORCE-RLS tables and an unactivated Order frontier; these are documentation-derived, not refreshed production assertions.
- Vercel build guard restricts production runtime database shape/identity and intentionally leaves ordinary Preview without production DATABASE_URL; local/non-Vercel commands do not prove that gate ran.
- Staff read client naming is historical; its reviewed surface also includes mutations. Do not infer read-only scope from its name.
- Response CORS comments in security.ts are not a universal CSRF guarantee; real origin/auth controls must be traced per route. Missing Origin handling and Vercel country-header trust remain documented assumptions, not standalone validated vulnerabilities.
- Shippo uses a fixed API origin and a nominal fetch timeout; successful response body decoding happens after fetchWithTimeout clears its timer, so this does not guarantee an end-to-end body deadline.
- No claim that all private R2 objects are provider-private or all live grants match intended configuration follows from source names alone.
- One additional security worker pass was blocked by platform screening; no restricted retry or alternative bypass was attempted. Standard scan coverage remains partial.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Staff sessions can read admin order data without completing the Admin PIN gate](#finding-1) | medium | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Staff sessions can read admin order data without completing the Admin PIN gate

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source traces connect middleware GET exception, role-only page helper and installed Next partial-tree rendering to sensitive child output. No application/runtime reproduction. |
| Category | authorization |
| CWE | CWE-862 |
| Affected lines | src/lib/adminPageAccess.ts:7-18, src/middleware.ts:324-338, src/app/admin/orders/page.tsx:23-33 |

#### Summary

Admin order pages enforce staff role but leave the additional PIN check in a shared layout. Partial RSC navigation can render a child page without executing that layout, so a valid staff session lacking a PIN cookie can obtain order data. This is a step-up authentication failure, not anonymous or ordinary-user access.

#### Root Cause

The application assumes that withholding children in the shared admin layout protects every admin GET. Client-controlled RSC navigation state changes where framework rendering begins. A child order page independently checks only staff role before using the privileged order client, so no PIN check remains on that data path. Middleware protects APIs/actions but deliberately excludes GET pages.

**Request router state controls the partial rendering boundary** — `node_modules/next/dist/server/app-render/app-render.js:161-164`

Installed Next accepts structurally validated client router state. Matching shared segments can be omitted from the newly rendered subtree; client navigation state is not proof a security layout previously ran.

```javascript
    const isHmrRefresh = headers[_approuterheaders.NEXT_HMR_REFRESH_HEADER] !== undefined;
    const isRSCRequest = (0, _isrscrequest.isRSCRequestHeader)(headers[_approuterheaders.RSC_HEADER]);
    const shouldProvideFlightRouterState = isRSCRequest && (!isPrefetchRequest || !options.isRoutePPREnabled);
    const flightRouterState = shouldProvideFlightRouterState ? (0, _parseandvalidateflightrouterstate.parseAndValidateFlightRouterState)(headers[_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER]) : undefined;
```

**GET page requests bypass middleware PIN verification** — `src/middleware.ts:327-329`

The requester must pass the preceding staff-role check, but a GET for an admin page does not enter PIN verification.

```typescript
    const isAdminServerActionPost =
      isAdminPage(req) && req.method !== "GET" && req.method !== "HEAD";
    if ((isAdminApi(req) && !isAdminPinVerification(req)) || isAdminServerActionPost) {
```

**Framework starts component rendering at the changed subtree** — `node_modules/next/dist/server/app-render/walk-tree-with-flight-router-state.js:114-127`

When traversal reaches the child segment, only that subtree is rendered. Matching ancestor traversal at lines148-180 tracks assets and recurses rather than invoking the ancestor layout.

```javascript
    if (renderComponentsOnThisLevel) {
        const overriddenSegment = flightRouterState && // TODO: Why does canSegmentBeOverridden exist? Why don't we always just
        // use `actualSegment`? Is it to avoid overwriting some state that's
        // tracked by the client? Dig deeper to see if we can simplify this.
        canSegmentBeOverridden(actualSegment, flightRouterState[0]) ? flightRouterState[0] : actualSegment;
        const routerState = await (0, _createflightrouterstatefromloadertree.createFlightRouterStateFromLoaderTree)(// Create router state using the slice of the loaderTree
        loaderTreeToFilter, hintTree, getDynamicParamFromSegment, query);
        // Create component tree using the slice of the loaderTree
        const seedData = await (0, _createcomponenttree.createComponentTree)(// This ensures flightRouterPath is valid and filters down the tree
        {
            ctx,
            loaderTree: loaderTreeToFilter,
            parentParams: currentParams,
```

**Page data-access guard returns staff without checking PIN** — `src/lib/adminPageAccess.ts:7-18`

Current account posture and staff role are validated correctly. The separate session-bound PIN is never checked before the actor is returned to privileged page consumers.

```typescript
export async function requireAdminPageAccess(requiredRole: AdminPageRole = "STAFF") {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt) redirect("/");
  if (requiredRole === "ADMIN" && user.role !== "ADMIN") redirect("/");
  if (requiredRole === "STAFF" && user.role !== "EMPLOYEE" && user.role !== "ADMIN") redirect("/");
  return user;
```

**Child page fetches sensitive orders after role-only guard** — `src/app/admin/orders/page.tsx:23-33`

A valid staff actor reaches the staff database authority without a PIN attestation. The list renders buyer email; the sibling detail page uses the same guard and renders shipping address/email at lines141-162.

```typescript
  const staff = await requireAdminPageAccess();
  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);

  const result = await readStaffOrderPage(
    staff.id,
    "ALL",
    requestedPage,
    PAGE_SIZE,
    getOrderStaffReadClient(),
  );
```

**PIN check exists only at the shared page layout boundary** — `src/app/admin/layout.tsx:23-32`

The intended additional check protects a full layout render. It cannot authorize child data reads when the framework reuses/skips that layout.

```tsx
  const cookieStore = await cookies();
  const pinVerified = await verifyAdminPinCookieValue(
    cookieStore.get(ADMIN_PIN_COOKIE_NAME)?.value,
    userId,
    sessionId,
  );

  if (!pinVerified) {
    return <AdminPinGate />;
  }
```

#### Validation

Parent and baseline worker traced the current middleware, helper, layout, order consumers and installed Next renderer. The role-only consumer is reachable through partial child rendering without an ancestor PIN check. Source contains real PIN checks for full layout render and API/action calls; those do not cover this GET path.

Validation method: independent static source trace

**GET page requests bypass middleware PIN verification** — `src/middleware.ts:327-329`

The requester must pass the preceding staff-role check, but a GET for an admin page does not enter PIN verification.

```typescript
    const isAdminServerActionPost =
      isAdminPage(req) && req.method !== "GET" && req.method !== "HEAD";
    if ((isAdminApi(req) && !isAdminPinVerification(req)) || isAdminServerActionPost) {
```

**Framework starts component rendering at the changed subtree** — `node_modules/next/dist/server/app-render/walk-tree-with-flight-router-state.js:114-127`

When traversal reaches the child segment, only that subtree is rendered. Matching ancestor traversal at lines148-180 tracks assets and recurses rather than invoking the ancestor layout.

```javascript
    if (renderComponentsOnThisLevel) {
        const overriddenSegment = flightRouterState && // TODO: Why does canSegmentBeOverridden exist? Why don't we always just
        // use `actualSegment`? Is it to avoid overwriting some state that's
        // tracked by the client? Dig deeper to see if we can simplify this.
        canSegmentBeOverridden(actualSegment, flightRouterState[0]) ? flightRouterState[0] : actualSegment;
        const routerState = await (0, _createflightrouterstatefromloadertree.createFlightRouterStateFromLoaderTree)(// Create router state using the slice of the loaderTree
        loaderTreeToFilter, hintTree, getDynamicParamFromSegment, query);
        // Create component tree using the slice of the loaderTree
        const seedData = await (0, _createcomponenttree.createComponentTree)(// This ensures flightRouterPath is valid and filters down the tree
        {
            ctx,
            loaderTree: loaderTreeToFilter,
            parentParams: currentParams,
```

**Page data-access guard returns staff without checking PIN** — `src/lib/adminPageAccess.ts:7-18`

Current account posture and staff role are validated correctly. The separate session-bound PIN is never checked before the actor is returned to privileged page consumers.

```typescript
export async function requireAdminPageAccess(requiredRole: AdminPageRole = "STAFF") {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt) redirect("/");
  if (requiredRole === "ADMIN" && user.role !== "ADMIN") redirect("/");
  if (requiredRole === "STAFF" && user.role !== "EMPLOYEE" && user.role !== "ADMIN") redirect("/");
  return user;
```

**Child page fetches sensitive orders after role-only guard** — `src/app/admin/orders/page.tsx:23-33`

A valid staff actor reaches the staff database authority without a PIN attestation. The list renders buyer email; the sibling detail page uses the same guard and renders shipping address/email at lines141-162.

```typescript
  const staff = await requireAdminPageAccess();
  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);

  const result = await readStaffOrderPage(
    staff.id,
    "ALL",
    requestedPage,
    PAGE_SIZE,
    getOrderStaffReadClient(),
  );
```

**PIN check exists only at the shared page layout boundary** — `src/app/admin/layout.tsx:23-32`

The intended additional check protects a full layout render. It cannot authorize child data reads when the framework reuses/skips that layout.

```tsx
  const cookieStore = await cookies();
  const pinVerified = await verifyAdminPinCookieValue(
    cookieStore.get(ADMIN_PIN_COOKIE_NAME)?.value,
    userId,
    sessionId,
  );

  if (!pinVerified) {
    return <AdminPinGate />;
  }
```

Assertions:
- Active staff identity remains required.
- Shared layouts are not guaranteed to execute for every partial RSC response.
- Order page data read has no independent PIN check.

Limitations:
- No browser or HTTP reproduction was executed.
- Installed framework source supports the trace; exact deployed source/configuration was not attested.
- No ordinary-user privilege escalation or PIN-free mutation is claimed.

#### Dataflow

Client RSC state -\> partial child render -\> role-only requireAdminPageAccess -\> staff order RPC -\> sensitive order output

- **Source:** Client request navigation state and existing staff session

- **Sink:** Staff order page data read

- **Outcome:** PIN-gated order information returned without successful PIN verification

**Request router state controls the partial rendering boundary** — `node_modules/next/dist/server/app-render/app-render.js:161-164`

Installed Next accepts structurally validated client router state. Matching shared segments can be omitted from the newly rendered subtree; client navigation state is not proof a security layout previously ran.

```javascript
    const isHmrRefresh = headers[_approuterheaders.NEXT_HMR_REFRESH_HEADER] !== undefined;
    const isRSCRequest = (0, _isrscrequest.isRSCRequestHeader)(headers[_approuterheaders.RSC_HEADER]);
    const shouldProvideFlightRouterState = isRSCRequest && (!isPrefetchRequest || !options.isRoutePPREnabled);
    const flightRouterState = shouldProvideFlightRouterState ? (0, _parseandvalidateflightrouterstate.parseAndValidateFlightRouterState)(headers[_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER]) : undefined;
```

**Framework starts component rendering at the changed subtree** — `node_modules/next/dist/server/app-render/walk-tree-with-flight-router-state.js:114-127`

When traversal reaches the child segment, only that subtree is rendered. Matching ancestor traversal at lines148-180 tracks assets and recurses rather than invoking the ancestor layout.

```javascript
    if (renderComponentsOnThisLevel) {
        const overriddenSegment = flightRouterState && // TODO: Why does canSegmentBeOverridden exist? Why don't we always just
        // use `actualSegment`? Is it to avoid overwriting some state that's
        // tracked by the client? Dig deeper to see if we can simplify this.
        canSegmentBeOverridden(actualSegment, flightRouterState[0]) ? flightRouterState[0] : actualSegment;
        const routerState = await (0, _createflightrouterstatefromloadertree.createFlightRouterStateFromLoaderTree)(// Create router state using the slice of the loaderTree
        loaderTreeToFilter, hintTree, getDynamicParamFromSegment, query);
        // Create component tree using the slice of the loaderTree
        const seedData = await (0, _createcomponenttree.createComponentTree)(// This ensures flightRouterPath is valid and filters down the tree
        {
            ctx,
            loaderTree: loaderTreeToFilter,
            parentParams: currentParams,
```

**Page data-access guard returns staff without checking PIN** — `src/lib/adminPageAccess.ts:7-18`

Current account posture and staff role are validated correctly. The separate session-bound PIN is never checked before the actor is returned to privileged page consumers.

```typescript
export async function requireAdminPageAccess(requiredRole: AdminPageRole = "STAFF") {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt) redirect("/");
  if (requiredRole === "ADMIN" && user.role !== "ADMIN") redirect("/");
  if (requiredRole === "STAFF" && user.role !== "EMPLOYEE" && user.role !== "ADMIN") redirect("/");
  return user;
```

**Child page fetches sensitive orders after role-only guard** — `src/app/admin/orders/page.tsx:23-33`

A valid staff actor reaches the staff database authority without a PIN attestation. The list renders buyer email; the sibling detail page uses the same guard and renders shipping address/email at lines141-162.

```typescript
  const staff = await requireAdminPageAccess();
  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);

  const result = await readStaffOrderPage(
    staff.id,
    "ALL",
    requestedPage,
    PAGE_SIZE,
    getOrderStaffReadClient(),
  );
```

#### Reachability

Requires an active EMPLOYEE/ADMIN Clerk session; anonymous and ordinary users fail earlier role checks.

- **Attacker:** Holder of a valid staff session who has not completed the additional PIN challenge

- **Entry point:** Admin order page GET/RSC navigation

- **Outcome:** Read access across the intended step-up boundary

Limitations:
- No unauthorized write or general RLS bypass established.

#### Severity

**Medium** — Sensitive order data is exposed across the intended PIN boundary, but a valid active EMPLOYEE/ADMIN session is required. No anonymous access or PIN-free write path established.

Additional runtime or deployment evidence could raise or lower this severity.

Impact assessment:
- **Level:** high
- **Why:** Order pages expose private buyer details and internal operational data intended to be gated by a second factor.

Likelihood assessment:
- **Level:** medium
- **Why:** A valid staff session is required and the missing gate is source-established; no production reproduction.

#### Remediation

Require the session-bound Admin PIN at every privileged page data-access boundary, including partial RSC paths; retain layout presentation and independent API/action checks.

Tests:
- Request sensitive page data without, with expired, and with wrong-session PIN through both full-document and partial RSC navigation; all must deny before staff database reads.
- Verify a valid staff session with valid PIN succeeds, while ordinary users remain denied.
- Cover admin pages with inline guards as well as requireAdminPageAccess consumers.

Preventive controls:
- Centralize staff role, current account and PIN verification in a shared data-access guard; do not rely on a shared layout as the sole authorization boundary.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Messaging fallback polling and transport capacity | not recorded | Needs follow-up | Runtime defect: ThreadMessages.tsx:262-291 polls /list every 3000ms; ratelimit.ts:90-94 permits 240/60m; messageStreamState.ts:1-2 treats 429 as terminal; ThreadMessages.tsx:274-277 clears timer permanently. A normal fallback thread consumes its quota in ~12 minutes; reload/remount required to resume. No attacker/security escalation claimed. SSE route polls per connection at 3-10s without cross-tab multiplexing; known deferred CM-A13 in docs/conversation-message-pre-rls-audit.md:137. User count alone is not concurrency proof. |
| Buyer quote integrity and economic precision | not recorded | Needs follow-up | shipping/quote route performs auth, fail-closed user rate limit, bounded body, ownership/private listing/stock/seller checks. shipping-token.ts:66-86 signs buyer, context, destination city/state/postal/country, exact item/variant/price subject and TTL; local v2 generation confirmed. Economic limitation: quote/route.ts:441-453 sums weight but takes max dimensions for multiple physical items; :570-573 likewise does not grow dimensions with single-listing quantity. shippingQuoteProvider.ts:48-65 sends one parcel and a street placeholder. Accurate address/packing/quantity-specific label cost not established. Global outage fallback :729-752 is intentionally documented economic risk, not a new auth bypass. |
| Label reversal retry consistency | not recorded | Needs follow-up | Initial route metadata reason label_cost_deduction differs from worker label_cost_deduction_retry under same key. Parent source-confirmed; provider replay consequences conditional, no provider execution. Documented FIN-01. |
| Guild cron continuation | not recorded | Needs follow-up | Worker read entire route/helper. 300-second run pages all sellers without durable cursor, hard-killed RUNNING lease not reclaimed. Parent validation pending. |
| Clawback queue deadlines | not recorded | Needs follow-up | Worker found 60s route versus installed SDK 80s timeout, ten upfront claimed rows, 20 attempts/hour schedule; parent validation pending. |
| Guild warning durability | not recorded | Needs follow-up | Worker observed committed warning clock then best-effort notification/email; no transactional obligation. Parent validation pending. |
| Public map fixed subset | not recorded | Needs follow-up | Worker observed first 500 eligible IDs, no viewport retrieval. Parent validation pending. |
| Admin page step-up authentication | not recorded | Reported | admin-rsc-pin source validated independently. Medium severity: active staff session required, partial GET data path lacks PIN. APIs/actions retain PIN checks. No live probe. |
| Closed Case hides valid receipt confirmation | not recorded | Needs follow-up | Worker: all-status getVisibleCaseByOrderId assigned activeCase; buyer page506-529 uses !activeCase; receipt SQL permits resolved cases. API not deadlocked. |
| Pending-close guidance | not recorded | Needs follow-up | Worker: both-parties-must-confirm UI contradicts seven-day inactivity expiry; 48h route comment stale. Reply reopening and co-committed notifications present. |
| Resolution origin copy | not recorded | Needs follow-up | Worker: mutual and automatic RESOLVED/DISMISSED displayed as reviewed dismissal; underlying audit distinguishes origin. |
| Cart load failures look empty | not recorded | Needs follow-up | Worker: cart391-435 sets error, initial empty return528-538 precedes banner859-863. Backend preserved. |
| Default notification preference mismatch | not recorded | Needs follow-up | Worker: default-off switches vs latest wired SQL only suppressing explicit false. Saved false honored; missing defaults diverge. |
| Saved state after tag navigation | not recorded | Needs follow-up | Worker: criteria-independent Saved state survives tag Link navigation; new criteria not saved. Native reload remounts. |
| Cart request ordering | not recorded | Needs follow-up | Worker: independent quantity POSTs and reloads can reorder intent or UI snapshot. Ownership/aggregate locks retained. |
| Saved collection stale after unfavorite | not recorded | Needs follow-up | Worker: heart updates locally without collection count/pagination invalidation. DBdelete succeeds. |
| Composer, uploads and review UI | not recorded | Needs follow-up | Partial batch failure stuck spinner; Enter bypasses uploading-disabled button; pending completion clears newer draft; \>6 accumulated attachments silently truncated; review completion only consumes res\[0\]. Parent checked composer/reset/reducer and review callback. |
| Custom listing, cart and variants | not recorded | Needs follow-up | Reserved private SOLD_OUT loses buyer detail/review UI. Guest raw stock renders up to1million options despite99 quantitycap. Parent sourceconfirmed both. Partial variants, custom category discard and author reply rendering recorded in durable Markdown. |
| Checkout and refund control paths | not recorded | No issue found | No additional attacker-controlled duplicate refund/underpayment path established in reviewed typed flows. Exact amount/source identity, generation fencing, state locks and atomic record/outbox effects were traced. Known reservation and other NULL SQL defects remain separately open; this is not a blanket safe finding or live proof. |
| Baseline input and account boundaries | not recorded | No issue found | Source review found bounded owner-scoped uploads, raster processing, sanitizer/URL controls, account export/deletion reverification and current-account checks. No additional concrete exploit reported; indirect dependencies and production settings not comprehensively proven. |
| Prior imported RLS findings | not recorded | Needs follow-up | Three latest Claude attachment files read fully and reconciled with current Order audit1221-1337/input runbooks. Composition corrections present in candidate not production; receipt NULL type has source-query containment, label/reconcile cases not equivalent. Other live-family legacy-grant/catalog/ordering/report-link/file-kind items remain separate open work. Lease timeout alone does not prove exactly-once. |

## Open Questions And Follow Up

- Run isolated full-document and partial-RSC PIN regression before applying a page-data boundary fix; production exposure not dynamically attested.
- Reproduce label provider success plus lost acknowledgement/local failure and immutable replay; prevent automatic creation after ambiguous provider-idempotency lifetime.
- Reproduce composer upload/race and cart response-order cases in a browser/component harness; recommended tests were not executed.
- Choose one shipping packing/address/fallback economics policy and one notification preference default policy, then align UI and backend tests.
- Measure real queue ages, provider latency, concurrent streams and fleet database budget; total registered users does not determine capacity.
- Separately close recorded Stripe lease-overload retirement, DirectUpload transitive authority-catalog coverage, SavedSearch ordering, report context links and message file-kind follow-ups; no fresh full audit acceptance in this pass.
- Source-confirmed financial runtime mismatch, not an attacker-driven security finding; provider consequence conditional. FIN-01 in durable runtime handoff.
  - Follow-up prompt: Review deferred unit label-retry-payload and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-composer-upload-enter and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-message-attachment-cap and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-visible-message-read and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-notification-cross-tab and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-review-batch and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-review-reply and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-custom-category and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-partial-variant and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-custom-sold-out and close its stated proof gap.
- Product/runtime observation retained with source evidence in durable handoff; not classified as an exploitable security finding. Browser/integration regressions remain pending.
  - Follow-up prompt: Review deferred unit product-guest-million-options and close its stated proof gap.
