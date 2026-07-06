# Closed Audit History

Historical audit and fix-pass logs moved out of `CLAUDE.md` so project instructions stay focused on current architecture and behavior contracts. `audit_open_findings.md` remains the source of truth for individual findings.

## Residual Observability and US-Only Copy Pass (2026-05-24)

- Terms messaging retention copy now defers to the current Privacy Policy instead of a nonexistent fixed three-year message-prune workflow.
- `/not-available` now matches the US-only product/legal boundary instead of telling blocked visitors the service is available in Canada.
- Admin ban undo now captures Stripe account verification failures with bounded Sentry context before falling back to a disabled seller restore state.
- The unused `generateAltText()` helper no longer has a bare silent catch; failures are warning-level Sentry captures without image URL payloads.
- Re-verified stale/current in the same sweep: processed image upload size/signature/Sharp guardrails and the Round 8 compliance-copy items for GPC, INFORM, commission retention, seller export wording, OpenFreeMap, Cloudflare Email Routing, and immediate account deletion wording were already current on `main` or explicitly product-tracked.
- Guardrail coverage: `tests/admin-audit-durability.test.mjs`, `tests/review-report-observability.test.mjs`, and `tests/round8-fulfillment-privacy-guardrails.test.mjs`.

## Checkout Privacy, Variant Price, Env, and Seller Perf Pass (2026-05-24)

- Cart checkout no longer persists full shipping address or selected rates in `sessionStorage`; legacy cart session address/rate/secrets are cleared by default, and mounted cart state listens for local account-state cleanup so a same-tab auth switch drops in-memory address/rate/payment state.
- Listing variants now share price-adjustment normalization and validation. Create/edit listing actions reject option sets that can produce a final unit price below $0.01 or above $100,000, cart update rejects invalid recalculated prices before persisting cart snapshots, and `ListingVariantOption.priceAdjustCents` has a raw DB range CHECK.
- Critical production env reads now go through `requiredProductionEnv()` for database, R2, Redis, Shippo, and `EMAIL_FROM` configuration, so production missing-config failures happen at module load rather than first customer traffic.
- Public seller profile metadata/page rendering shares a React `cache()` seller loader and batches independent seller-page queries with `Promise.all`.
- Verified stale/current from the same read-only agent sweep: anonymous-cart account switching, Stripe redirect allowlisting, fulfillment origin guardrails, schema listing checks, order money checks, and retention FKs were already current. `#973` remains a live-data audit question, and Stripe payment-intent/charge partial uniqueness remains raw-managed by design.
- Guardrail coverage: `tests/local-account-state.test.mjs`, `tests/listing-variants.test.mjs`, `tests/schema-numeric-index-guardrails.test.mjs`, `tests/env-validation.test.mjs`, `tests/seller-page-performance.test.mjs`, `tests/observability-cleanup-followups.test.mjs`, `tests/round8-fulfillment-privacy-guardrails.test.mjs`, and `tests/order-seller-route-ownership.test.mjs`.

## Analytics, Cache, Geo, and Upload Guardrails Pass (2026-05-24)

- Analytics bot filtering now treats missing/blank user agents and common non-browser clients as non-human traffic before incrementing listing click/view or seller profile view counters.
- Stock-driven listing visibility flips now invalidate the public listing-tag cache after commit across Stripe checkout completion, blocked-checkout stock restore, checkout-expiry restore, seller refunds, and admin case-resolution refunds.
- Seller rating summary refreshes now take a seller-scoped advisory transaction lock before aggregate/upsert work, reducing concurrent-review stale-summary races while keeping review mutations and summary refreshes in one transaction.
- Auto-created metros now store bounded reverse-geocoded locality coordinates instead of the first caller's precise lat/lng, reducing off-center metro assignment and avoiding precise seller coordinates in generated metro rows.
- Processed image uploads now accept the documented 15MB banner size plus multipart overhead, reject mismatched JPEG/PNG/WebP signatures before Sharp, and set a 50MP Sharp input-pixel limit.
- AI review prompt prices now use `formatCurrencyCents()` with listing currency, and remaining AI/backfill/seller-analytics catch blocks leave bounded Sentry evidence instead of console-only failures.
- Guardrail coverage: `tests/bot-user-agent.test.mjs`, `tests/cache-invalidation-guardrails.test.mjs`, `tests/review-report-observability.test.mjs`, `tests/reverse-geocode-throttle.test.mjs`, `tests/geo-metro-privacy.test.mjs`, `tests/form-data-body-bounds.test.mjs`, `tests/ai-review-outer-failclosed.test.mjs`, `tests/pr-h-deletion-analytics-email-followups.test.mjs`, and `tests/post-launch-ui-followups.test.mjs`.

## Refund, Money, and Stock Helper Pass (2026-05-24)

- Refund idempotency bases are now built through `refundIdempotencyKeyBase()` and must include the refund scope, target id, resolution, and positive amount before Stripe suffixes are appended.
- `createMarketplaceRefund()` now separates platform-funded refunds from seller-transfer reconciliation: tax-only platform-funded refunds no longer imply manual seller reconciliation, while disconnected-seller platform refunds still do.
- `formatCurrencyCents()` now returns an explicit invalid-amount sentinel for non-finite cents instead of rendering malformed values as zero; `parseMoneyInputToCents()` has documented/tested empty-versus-zero semantics.
- Manual stock writes now share `MAX_MANUAL_STOCK_QUANTITY` / `normalizeManualStockQuantity()` and the stock PATCH API, listing forms, and create/edit/custom server actions enforce the cap before Prisma Int writes.
- Verified stale/current from the same agent-assisted sweep: quality-score malformed flag handling and finite score caps were already covered, Guild active-case metrics count all unresolved cases across all time, reverse geocoding already fails closed on Redis throttle outages, and the Next.js/audit CI documentation drift claims were already closed on current main.
- Guardrail coverage: `tests/marketplace-refunds.test.mjs`, `tests/money.test.mjs`, `tests/stock-mutation-state.test.mjs`, `tests/quality-score-state.test.mjs`, `tests/guild-metrics-state.test.mjs`, `tests/reverse-geocode-throttle.test.mjs`, `tests/schema-numeric-index-guardrails.test.mjs`, `tests/ban-side-effect-guardrails.test.mjs`, `tests/email-delivery-guardrails.test.mjs`, and `tests/round10-state-machine-guardrails.test.mjs`.

## Blog, Broadcast, and Rendering Follow-up Pass (2026-05-24)

- Removed the dead legacy `src/actions/listings.ts` listing update action so future imports cannot bypass the active edit-page price, rate-limit, ownership, and AI re-review path.
- Seller broadcasts now enqueue `EMAIL_SELLER_BROADCAST` only for explicit default-off email opt-ins, use source-specific notification links, and admin broadcast deletion is idempotent while cleaning source-specific notifications plus pending/failed broadcast email jobs.
- Approved blog comment notifications now link to `#comment-{commentId}` and staff comment deletion removes matching source-specific notifications; public blog publish checks now include normalized tags in the profanity/moderation boundary.
- Listing edit photo cleanup failures now leave Sentry evidence keyed by bounded listing/seller IDs, and `safeJsonLd()` now also escapes `&`.
- Verified stale/current from the same agent-assisted sweep: the old direct photo mutation chain is retired, message/file URL rendering is trusted-origin gated, `sanitizeRichText()` stores plain text, and blog status/republish/comment-dedup/cache-invalidation guardrails were already current.
- Guardrail coverage: `tests/pr-i-media-upload-unsubscribe-followups.test.mjs`, `tests/seller-ops-hardening.test.mjs`, `tests/blog-action-guardrails.test.mjs`, `tests/admin-action-guardrails.test.mjs`, `tests/email-delivery-guardrails.test.mjs`, `tests/r56-r67-small-fixes.test.mjs`, and `tests/rendering-security.test.mjs`.

## Notification Preference Runtime Shape Pass (2026-05-24)

- Added `normalizeNotificationPreferences()` as the shared runtime boundary for `User.notificationPreferences` JSON. It preserves only known preference keys with boolean values.
- In-app notification delivery, email preference checks, unsubscribe writes, seller broadcast follower filtering, and preference UI rendering now use the normalized shape instead of trusting `Record<string, boolean>` casts.
- This reduces current reader-side risk from malformed JSON values; a database-level JSON CHECK, historical data scan, and broader JSON/TEXT size policy remain separate product/ops decisions.
- Guardrail coverage: `tests/notification-preference-keys.test.mjs`, `tests/notification-delivery-preferences.test.mjs`, and `tests/notification-email-preferences.test.mjs`.

## Conversation Pair Invariant Pass (2026-05-24)

- Added a raw-managed unique expression index on `Conversation` unordered participant pairs (`LEAST(userAId,userBId)`, `GREATEST(userAId,userBId)`) while keeping the Prisma-visible ordered unique key used by app upserts.
- The migration fails with an explicit duplicate-pair error instead of silently merging retained conversation history if pre-existing swapped duplicates are found.
- Added guardrail coverage for the raw migration and normal canonical conversation creation paths.
- Guardrail coverage: `tests/conversation-pair-guardrails.test.mjs`.

## AI Review Outer Fail-Closed Coverage Pass (2026-05-24)

- `reviewListingWithAI()` now accepts optional test-only dependency injection for its duplicate-title lookup, OpenAI fetch, and retry sleep while preserving existing production callers.
- Added direct outer-wrapper coverage for missing OpenAI config, malformed model output, and transient provider retry exhaustion.
- Cross-seller duplicate detection remains a product-risk design decision because generic woodworking titles can create false positives without a broader threshold/appeal design.
- Guardrail coverage: `tests/ai-review-outer-failclosed.test.mjs`.

## Anonymous Cart Merge Durability Pass (2026-05-24)

- Extracted anonymous-cart sign-in merge outcome handling into `src/lib/anonymousCartMerge.ts`.
- Merge now removes only successfully merged or terminally rejected anonymous-cart lines; retryable auth, rate-limit, conflict, network, and 5xx failures remain in local storage for a later retry.
- Signed-out/sign-out cross-account leakage findings remain closed through `clearSignedOutLocalAccountState()`; this pass targeted partial-merge data loss and regression coverage.
- Guardrail coverage: `tests/anonymous-cart-merge.test.mjs`.

## Round 11 Verification Follow-up Pass (2026-05-24)

- Buyer order confirmations now show the multi-seller separate-order disclaimer only when checkout metadata records a multi-seller cart flow.
- The numeric-guard migration now normalizes malformed historical listing processing windows before validating the processing-days check constraint.
- Prisma schema comments and guardrail coverage now document that `Order.stripePaymentIntentId` and `Order.stripeChargeId` are raw-managed partial unique indexes, not plain Prisma `@unique` fields.
- Verified false/stale: `Order.platformFeeCents` is not a persisted column in current schema, and `tests/round10-state-machine-guardrails.test.mjs` exists.
- Guardrail coverage: `tests/email-delivery-guardrails.test.mjs`, `tests/schema-numeric-index-guardrails.test.mjs`, and `tests/schema-retention-guardrails.test.mjs`.

## Admin Audit Durability Pass (2026-05-24)

- Added strict transactional admin audit logging via `logAdminActionOrThrow({ client: tx, ... })` while preserving best-effort `logAdminAction()` for non-blocking evidence.
- Co-committed audit rows with listing removal/review, admin order review actions, support/report resolution, admin review deletion, blog/broadcast deletes, and Guild verification state changes.
- BAN undo now fails closed for legacy or malformed `BAN_USER` audit rows without `metadata.appliedBannedAt`; staff should use the explicit unban workflow for manual current-state unbans.
- Guardrail coverage: `tests/admin-audit-durability.test.mjs`, `tests/admin-moderation-observability.test.mjs`, `tests/admin-action-guardrails.test.mjs`, `tests/admin-audit-undo-state.test.mjs`, `tests/ban-side-effect-guardrails.test.mjs`, and `tests/ban-audit-metadata.test.mjs`.

## Ban Open-Order Review Update Pass (2026-05-24)

- Replaced the per-order `tx.order.update()` loop in `banUser()` with a chunked `UPDATE ... FROM (VALUES ...)` that applies per-order review notes inside the ban transaction.
- The bulk update guards on each order's captured `reviewNeeded` and `reviewNote`, using `IS NOT DISTINCT FROM` so concurrent staff note edits are not overwritten.
- Guardrail coverage: `tests/ban-side-effect-guardrails.test.mjs`, `tests/ban-order-review-state.test.mjs`, `tests/ban-audit-metadata.test.mjs`, and `tests/ban-side-effect-repair.test.mjs`.

Older completed audit-pass sections dated before the rolling 60-day window live in `CLOSED_AUDIT_ARCHIVE.md`.
