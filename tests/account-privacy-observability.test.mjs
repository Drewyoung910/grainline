import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account and privacy route observability guardrails", () => {
  it("captures account export failures without exporting payload details to Sentry", () => {
    const route = source("src/app/api/account/export/route.ts");

    assert.match(route, /source: "account_export"/);
    assert.match(route, /source: "account_export_audit_log"/);
    assert.match(route, /extra: \{ userId: exportUserId, method \}/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*payload/s);
  });

  it("keeps newsletter signup fail-closed and observable with hashed email telemetry", () => {
    const route = source("src/app/api/newsletter/route.ts");

    assert.match(route, /getIP\(req\)/);
    assert.match(route, /safeRateLimit\(newsletterRatelimit, ip\)/);
    assert.doesNotMatch(route, /safeRateLimitOpen\(newsletterRatelimit/);
    assert.match(route, /readBoundedJson\(req, NEWSLETTER_BODY_MAX_BYTES\)/);
    assert.match(
      route,
      /parsed\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/,
    );
    assert.match(route, /isRequestBodyTooLargeError/);
    assert.match(
      route,
      /rateLimitResponse\(rl\.reset, "Too many newsletter signup attempts\."\)/,
    );
    assert.match(route, /hashEmailForTelemetry\(email\)/);
    assert.match(route, /source: "newsletter_subscribe"/);
    assert.match(route, /extra: \{ emailHash \}/);
    assert.match(
      route,
      /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/,
    );
    assert.match(route, /logServerError\(err, \{/);
    assert.doesNotMatch(route, /Sentry\.captureException\(err/);
    assert.doesNotMatch(route, /console\.error\("POST \/api\/newsletter error:", err\)/);
    assert.match(route, /isEmailSuppressedForNewsletterSignup\(email\)/);
    assert.doesNotMatch(route, /isEmailSuppressed\(email\)/);
    assert.match(route, /confirmationRequired: true/);
    assert.match(route, /sendNewsletterConfirmationEmail/);
    assert.match(route, /active: false/);
    assert.doesNotMatch(route, /suppressed: true/);
    assert.doesNotMatch(route, /subscribed: false/);
  });

  it("bounds public support and privacy request bodies before normalization", () => {
    const support = source("src/app/api/support/route.ts");
    const dataRequest = source("src/app/api/legal/data-request/route.ts");

    for (const route of [support, dataRequest]) {
      assert.match(route, /readBoundedJson\(req, [A-Z_]+_BODY_MAX_BYTES\)/);
      assert.match(route, /isRequestBodyTooLargeError/);
      assert.match(route, /Request body too large/);
      assert.doesNotMatch(route, /body = await req\.json\(\)/);
    }
  });

  it("keeps support and privacy request email delivery state admin-visible on double failure", () => {
    const support = source("src/app/api/support/route.ts");
    const dataRequest = source("src/app/api/legal/data-request/route.ts");
    const adminPage = source("src/app/admin/support/page.tsx");

    for (const route of [support, dataRequest]) {
      assert.match(route, /SUPPORT_REQUEST_EMAIL_PENDING_MARKER/);
      assert.match(
        route,
        /emailLastError: SUPPORT_REQUEST_EMAIL_PENDING_MARKER/,
      );
      assert.match(route, /sendRenderedEmail\(/);
      assert.match(
        route,
        /data: \{ emailSentAt: new Date\(\), emailLastError: null \}/,
      );
      assert.match(route, /email_error_update/);
      assert.match(route, /email_sent_update/);
    }
    assert.match(adminPage, /supportRequestEmailNotificationState\(request\)/);
    assert.doesNotMatch(
      adminPage,
      /request\.emailSentAt \? "Sent" : request\.emailLastError \? "Failed" : "Pending"/,
    );
  });

  it("links signed-in support and privacy requests to the local account without requiring auth", () => {
    const support = source("src/app/api/support/route.ts");
    const dataRequest = source("src/app/api/legal/data-request/route.ts");
    const accountLink = source("src/lib/supportRequestAccount.ts");

    assert.match(accountLink, /auth\(\)/);
    assert.match(accountLink, /where: \{ clerkId: clerkUserId \}/);
    assert.match(accountLink, /select: \{ id: true \}/);
    for (const route of [support, dataRequest]) {
      assert.match(route, /currentSupportRequestUserId\(\)/);
      assert.match(route, /userId: requesterUserId/);
      assert.doesNotMatch(route, /ensureUser/);
    }
  });

  it("captures unsubscribe processing failures with hashed email telemetry only", () => {
    const route = source("src/app/api/email/unsubscribe/route.ts");

    assert.match(
      route,
      /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/,
    );
    assert.match(route, /logServerError\(error, \{/);
    assert.match(route, /source: "unsubscribe_email"/);
    assert.match(route, /level: "warning"/);
    assert.match(route, /hashEmailForTelemetry\(email\)/);
    assert.doesNotMatch(route, /extra: \{ email \}/);
    assert.doesNotMatch(
      route,
      /console\.error\("Unsubscribe failed:", error\)/,
    );
  });

  it("sanitizes duplicate route-level logs for direct email send failures", () => {
    const newsletterRoute = source("src/app/api/newsletter/route.ts");
    const adminEmailRoute = source("src/app/api/admin/email/route.ts");

    assert.match(
      newsletterRoute,
      /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/,
    );
    assert.match(newsletterRoute, /logServerError\(err, \{/);
    assert.doesNotMatch(newsletterRoute, /Sentry\.captureException\(err/);
    assert.doesNotMatch(newsletterRoute, /console\.error\([^,\n]+,\s*err\)/);

    assert.match(
      adminEmailRoute,
      /import \{ sanitizeEmailOutboxError \} from "@\/lib\/emailOutboxSanitize"/,
    );
    assert.match(
      adminEmailRoute,
      /console\.error\([^,\n]+,\s*sanitizeEmailOutboxError\(err\)\)/,
    );
    assert.doesNotMatch(adminEmailRoute, /console\.error\([^,\n]+,\s*err\)/);
  });

  it("sanitizes newsletter confirmation failure telemetry", () => {
    const route = source("src/app/api/newsletter/confirm/route.ts");

    assert.match(
      route,
      /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/,
    );
    assert.match(route, /logServerError\(error, \{/);
    assert.match(route, /source: "newsletter_confirm"/);
    assert.match(route, /level: "warning"/);
    assert.match(route, /tokenHashPrefix: "tokenHash" in validated \? validated\.tokenHash\.slice\(0, 8\) : undefined/);
    assert.doesNotMatch(route, /Sentry\.captureException\(error/);
    assert.doesNotMatch(
      route,
      /console\.error\("Newsletter confirmation failed:", error\)/,
    );
  });

  it("lets signed-in email preference opt-in clear only one-click manual suppression", () => {
    const route = source(
      "src/app/api/account/notifications/preferences/route.ts",
    );
    const suppression = source("src/lib/emailSuppression.ts");
    const clearStart = suppression.indexOf(
      "export async function clearOneClickEmailSuppression",
    );
    const clearHelper = suppression.slice(
      clearStart,
      suppression.indexOf("export async function suppressEmail", clearStart),
    );

    assert.match(
      route,
      /import \{ isValidEmailPreferenceKey, VALID_PREFERENCE_KEYS \}/,
    );
    assert.match(route, /clearOneClickEmailSuppression\(me\.email, tx\)/);
    assert.match(route, /if \(enabled && isValidEmailPreferenceKey\(type\)\)/);
    assert.ok(
      route.indexOf("tx.$executeRaw") <
        route.indexOf("clearOneClickEmailSuppression(me.email, tx)"),
      "preference opt-in should write the preference before clearing one-click suppression",
    );

    assert.match(clearHelper, /emailSuppressionAddressKeys\(email\)/);
    assert.match(clearHelper, /reason: EmailSuppressionReason\.MANUAL/);
    assert.match(clearHelper, /source: "one_click_unsubscribe"/);
    assert.doesNotMatch(clearHelper, /source: "account_deletion"/);
    assert.doesNotMatch(
      clearHelper,
      /reason: EmailSuppressionReason\.BOUNCE|reason: EmailSuppressionReason\.COMPLAINT/,
    );
  });

  it("keeps one-click unsubscribe separate from hard email delivery suppression", () => {
    const email = source("src/lib/email.ts");
    const newsletterRoute = source("src/app/api/newsletter/route.ts");
    const adminEmailRoute = source("src/app/api/admin/email/route.ts");
    const suppression = source("src/lib/emailSuppression.ts");
    const deliveryStart = suppression.indexOf(
      "export async function isEmailDeliverySuppressed",
    );
    const deliveryHelper = suppression.slice(
      deliveryStart,
      suppression.indexOf(
        "export async function clearOneClickEmailSuppression",
        deliveryStart,
      ),
    );

    assert.match(
      email,
      /import \{ isEmailDeliverySuppressed, normalizeEmailAddress \}/,
    );
    assert.match(email, /isEmailDeliverySuppressed\(recipient\)/);
    assert.doesNotMatch(email, /isEmailSuppressed\(recipient\)/);

    assert.match(deliveryHelper, /EmailSuppressionReason\.BOUNCE/);
    assert.match(deliveryHelper, /EmailSuppressionReason\.COMPLAINT/);
    assert.match(deliveryHelper, /source: "account_deletion"/);
    assert.doesNotMatch(deliveryHelper, /source: "one_click_unsubscribe"/);

    assert.match(newsletterRoute, /isEmailSuppressedForNewsletterSignup\(email\)/);
    assert.doesNotMatch(newsletterRoute, /isEmailSuppressed\(email\)/);
    assert.match(suppression, /export async function isEmailSuppressedForNewsletterSignup/);
    assert.match(suppression, /source: "account_deletion"/);
    assert.match(suppression, /reason: EmailSuppressionReason\.MANUAL, source: null/);
    assert.match(suppression, /reason: EmailSuppressionReason\.MANUAL, source: \{ not: "one_click_unsubscribe" \}/);
    assert.match(
      adminEmailRoute,
      /isEmailSuppressed\(normalizedRecipientEmail\)/,
    );
    assert.match(
      adminEmailRoute,
      /Recipient email is suppressed or unsubscribed/,
    );
    assert.doesNotMatch(
      adminEmailRoute,
      /Recipient email is suppressed after a bounce or complaint/,
    );
  });

  it("preserves hard email suppressions per key when lower-priority manual suppression is written", () => {
    const unsubscribe = source("src/lib/unsubscribe.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const oneClickStart = unsubscribe.indexOf(
      "async function setOneClickEmailSuppression",
    );
    const oneClickHelper = unsubscribe.slice(
      oneClickStart,
      unsubscribe.indexOf(
        "export async function unsubscribeTokenSuperseded",
        oneClickStart,
      ),
    );
    const deletionStart = deletion.indexOf(
      "const existingEmailSuppressions = await tx.emailSuppression.findMany",
    );
    const deletionSuppressionBlock = deletion.slice(
      deletionStart,
      deletion.indexOf("await tx.commissionRequest.updateMany", deletionStart),
    );

    assert.ok(
      oneClickStart >= 0,
      "unsubscribe should use an explicit one-click suppression writer",
    );
    assert.match(oneClickHelper, /emailSuppressionAddressKeys\(email\)/);
    assert.match(oneClickHelper, /EmailSuppressionReason\.BOUNCE/);
    assert.match(oneClickHelper, /EmailSuppressionReason\.COMPLAINT/);
    assert.match(oneClickHelper, /source === "account_deletion"/);
    assert.match(oneClickHelper, /reason: EmailSuppressionReason\.MANUAL/);
    assert.match(oneClickHelper, /source: "one_click_unsubscribe"/);
    assert.doesNotMatch(oneClickHelper, /emailSuppression\.upsert/);

    assert.ok(
      deletionStart >= 0,
      "account deletion should inspect existing suppression before writing",
    );
    assert.match(deletionSuppressionBlock, /providerHardSuppressionEmails/);
    assert.match(deletionSuppressionBlock, /EmailSuppressionReason\.BOUNCE/);
    assert.match(deletionSuppressionBlock, /EmailSuppressionReason\.COMPLAINT/);
    assert.match(
      deletionSuppressionBlock,
      /manualSuppressionEmails = suppressionEmailMatches\.filter/,
    );
    assert.match(
      deletionSuppressionBlock,
      /!providerHardSuppressionEmails\.has\(email\)/,
    );
    assert.match(
      deletionSuppressionBlock,
      /email: \{ in: manualSuppressionEmails \}/,
    );
    assert.match(
      deletionSuppressionBlock,
      /reason: EmailSuppressionReason\.MANUAL/,
    );
    assert.match(deletionSuppressionBlock, /source: "account_deletion"/);
    assert.doesNotMatch(deletionSuppressionBlock, /emailSuppression\.upsert/);
    assert.doesNotMatch(deletionSuppressionBlock, /hasProviderHardSuppression/);
  });

  it("rejects unsubscribe links issued before a later signed-in email opt-in", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260604033000_add_email_preference_opt_in_epoch/migration.sql",
    );
    const preferencesRoute = source(
      "src/app/api/account/notifications/preferences/route.ts",
    );
    const unsubscribeRoute = source("src/app/api/email/unsubscribe/route.ts");
    const unsubscribe = source("src/lib/unsubscribe.ts");
    const validateStart = unsubscribeRoute.indexOf(
      "async function validateUnsubscribeRequest",
    );
    const validateRequest = unsubscribeRoute.slice(
      validateStart,
      unsubscribeRoute.indexOf("async function handlePost", validateStart),
    );

    assert.match(schema, /emailPreferenceOptInAt DateTime\?/);
    assert.match(
      migration,
      /ADD COLUMN "emailPreferenceOptInAt" TIMESTAMP\(3\)/,
    );
    assert.match(
      preferencesRoute,
      /SET "emailPreferenceOptInAt" = \$\{new Date\(\)\}/,
    );
    assert.ok(
      preferencesRoute.indexOf('SET "emailPreferenceOptInAt"') <
        preferencesRoute.indexOf("clearOneClickEmailSuppression(me.email, tx)"),
      "email opt-in epoch should be written before one-click suppression is cleared",
    );

    assert.match(
      unsubscribeRoute,
      /import \{ unsubscribeEmail, unsubscribeTokenSuperseded, verifyUnsubscribeToken \}/,
    );
    assert.match(
      validateRequest,
      /verifyUnsubscribeToken\(email, token, issuedAt\)/,
    );
    assert.match(
      validateRequest,
      /unsubscribeTokenSuperseded\(email, issuedAt\)/,
    );
    assert.ok(
      validateRequest.indexOf(
        "verifyUnsubscribeToken(email, token, issuedAt)",
      ) <
        validateRequest.indexOf("unsubscribeTokenSuperseded(email, issuedAt)"),
      "unsubscribe token should be authenticated before checking opt-in epoch",
    );

    assert.match(
      unsubscribe,
      /export async function unsubscribeTokenSuperseded/,
    );
    assert.match(unsubscribe, /emailSuppressionAddressKeys\(normalized\)/);
    assert.match(unsubscribe, /emailSuppressionLookupForEmails\(emails\)/);
    assert.match(unsubscribe, /function emailSuppressionMatchWhereSql/);
    assert.match(unsubscribe, /split_part\(\$\{emailColumn\}, '@', 2\) IN \('gmail\.com', 'googlemail\.com'\)/);
    assert.match(unsubscribe, /replace\(split_part\(split_part\(\$\{emailColumn\}, '@', 1\), '\+', 1\), '\.', ''\) IN/);
    assert.match(
      unsubscribe,
      /WHERE \$\{emailSuppressionMatchWhereSql\(lookup\)\}\s+AND "deletedAt" IS NULL\s+AND "createdAt" > \$\{new Date\(issuedAt\)\}/,
    );
    assert.match(unsubscribe, /ORDER BY "createdAt" DESC/);
    assert.match(unsubscribe, /if \(newerAccountClaim\) return true/);
    assert.match(unsubscribe, /FROM "UserEmailAddress" uea/);
    assert.match(unsubscribe, /INNER JOIN "User" u ON u\."id" = uea\."userId"/);
    assert.match(unsubscribe, /emailSuppressionMatchWhereSql\(lookup, Prisma\.sql`uea\."email"`\)/);
    assert.match(unsubscribe, /AND uea\."isCurrent" = true/);
    assert.match(unsubscribe, /AND uea\."firstSeenAt" > \$\{new Date\(issuedAt\)\}/);
    assert.match(unsubscribe, /ORDER BY uea\."firstSeenAt" DESC/);
    assert.match(unsubscribe, /if \(newerCurrentEmailClaim\) return true/);
    assert.match(
      unsubscribe,
      /AND "emailPreferenceOptInAt" IS NOT NULL/,
    );
    assert.match(unsubscribe, /ORDER BY "emailPreferenceOptInAt" DESC/);
    assert.match(
      unsubscribe,
      /user\.emailPreferenceOptInAt\.getTime\(\) > issuedAt/,
    );
    assert.match(unsubscribe, /FROM "NewsletterSubscriber"/);
    assert.match(
      unsubscribe,
      /AND "confirmedAt" IS NOT NULL/,
    );
    assert.match(unsubscribe, /ORDER BY "confirmedAt" DESC/);
    assert.match(
      unsubscribe,
      /newsletter\.confirmedAt\.getTime\(\) > issuedAt/,
    );
  });

  it("applies Gmail suppression keys to one-click unsubscribe preference and newsletter updates", () => {
    const unsubscribe = source("src/lib/unsubscribe.ts");
    const unsubscribeEmailStart = unsubscribe.indexOf(
      "export async function unsubscribeEmail",
    );
    const unsubscribeEmailHelper = unsubscribe.slice(unsubscribeEmailStart);

    assert.match(
      unsubscribeEmailHelper,
      /const suppressionEmailKeys = emailSuppressionAddressKeys\(normalized\)/,
    );
    assert.match(
      unsubscribeEmailHelper,
      /const emails =\s*suppressionEmailKeys\.length > 0 \? suppressionEmailKeys : \[normalized\]/,
    );
    assert.match(
      unsubscribeEmailHelper,
      /newsletterIdsMatchingSuppressionLookup\(tx, lookup\)/,
    );
    assert.match(
      unsubscribeEmailHelper,
      /newsletterSubscriber\.updateMany\(\{\s*where: \{ id: \{ in: newsletterIds \} \}/s,
    );
    assert.match(
      unsubscribeEmailHelper,
      /userIdsMatchingSuppressionLookup\(tx, lookup\)/,
    );
    assert.match(
      unsubscribeEmailHelper,
      /user\.findMany\(\{\s*where: \{ id: \{ in: userIds \} \}/s,
    );
    assert.match(unsubscribeEmailHelper, /for \(const user of users\)/);
    assert.match(unsubscribeEmailHelper, /userUpdated = users\.length > 0/);
    assert.doesNotMatch(
      unsubscribeEmailHelper,
      /newsletterSubscriber\.updateMany\(\{\s*where: \{ email: normalized \}/s,
    );
    assert.doesNotMatch(
      unsubscribeEmailHelper,
      /user\.findUnique\(\{\s*where: \{ email: normalized \}/s,
    );
  });

  it("keeps Clerk user ids out of favorites route telemetry", () => {
    const route = source("src/app/api/favorites/route.ts");

    assert.match(route, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(route, /source: "favorite_ensure_user"/);
    assert.doesNotMatch(route, /console\.error\("POST \/api\/favorites ensureUser error:/);
    assert.doesNotMatch(route, /source: "favorite_ensure_user"[\s\S]{0,160}userId/);
  });

  it("keeps central email failure telemetry off raw recipient emails", () => {
    const email = source("src/lib/email.ts");

    assert.match(email, /hashEmailForTelemetry/);
    assert.match(
      email,
      /console\.log\("\[email:dev\]", \{ emailHash, subjectLength: sanitizedSubject\.length \}\)/,
    );
    assert.match(
      email,
      /console\.error\("\[email\] inactive-account lookup failed; skipping send:", sanitizeEmailOutboxError\(err\)\)/,
    );
    assert.match(
      email,
      /console\.error\("\[email\] send failed:", sanitizeEmailOutboxError\(err\)\)/,
    );
    assert.match(email, /source: "email_inactive_account_lookup"/);
    assert.match(email, /source: "email_send_retry"/);
    assert.match(email, /source: "email_send"/);
    assert.match(email, /function sanitizedEmailSentryError\(error: unknown\)/);
    assert.match(email, /sanitizeEmailOutboxError\(error\.stack\)/);
    assert.match(email, /Sentry\.captureException\(sanitizedEmailSentryError\(err\), \{/);
    assert.doesNotMatch(email, /Sentry\.captureException\(err, \{[\s\S]*source: "email_send_retry"/);
    assert.doesNotMatch(email, /Sentry\.captureException\(err, \{[\s\S]*source: "email_send"/);
    assert.doesNotMatch(
      email,
      /console\.log\("\[email:dev\]", \{ to: recipient/,
    );
    assert.doesNotMatch(email, /extra:\s*\{[^}]*\bto:\s*recipient/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*\bto,/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*subject:\s*sanitizedSubject/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*subject\s*\}/s);
    assert.doesNotMatch(
      email,
      /console\.error\("\[email\] send failed:", err\)/,
    );
  });

  it("preserves Resend webhook error evidence even when marking the event failed errors", () => {
    const route = source("src/app/api/resend/webhook/route.ts");
    const launch = source("docs/launch-checklist.md");

    assert.match(route, /markWebhookFailed\(id, err\)\.catch/);
    assert.match(route, /sanitizeEmailOutboxError\(err\)/);
    assert.match(route, /processingStartedAt: null/);
    assert.match(route, /safeResendWebhookDetails\(event, id, emails\)/);
    assert.match(route, /const TRANSIENT_FAILURE_SUPPRESSION_THRESHOLD = 5/);
    assert.match(route, /return type === "email\.failed"/);
    assert.match(route, /INSERT INTO "EmailFailureCount"/);
    assert.match(route, /ON CONFLICT \(email\) DO UPDATE SET/);
    assert.match(
      route,
      /"EmailFailureCount"\."firstFailedAt" < \$\{windowStart\}/,
    );
    assert.doesNotMatch(route, /emailFailureCount\.findUnique/);
    assert.doesNotMatch(route, /email\.delivery_delayed/);
    assert.match(launch, /Delivery-delayed provider events may be monitored in the Resend dashboard/);
    assert.match(launch, /app intentionally ignores them for durable suppression/);
    assert.doesNotMatch(
      route,
      /details: event as unknown as Prisma\.InputJsonValue/,
    );
    assert.match(route, /source: "resend_webhook_mark_failed"/);
    assert.match(route, /source: "resend_webhook_process"/);
  });

  it("returns retryable status for in-progress Resend webhook reservations", () => {
    const route = source("src/app/api/resend/webhook/route.ts");

    assert.match(route, /reservation === "processed"/);
    assert.match(route, /reservation === "in_progress"/);
    const inProgressStart = route.indexOf('reservation === "in_progress"');
    const processStart = route.indexOf("try {", inProgressStart);
    const inProgressBlock = route.slice(inProgressStart, processStart);
    assert.match(inProgressBlock, /status: HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(
      inProgressBlock,
      /"Retry-After": String\(RESEND_WEBHOOK_RETRY_AFTER_SECONDS\)/,
    );
    assert.doesNotMatch(inProgressBlock, /ok: true/);
  });

  it("keeps Clerk user.deleted retryable when local anonymization is already in progress", () => {
    const route = source("src/app/api/clerk/webhook/route.ts");
    const userDeletedStart = route.indexOf('event.type === "user.deleted"');
    const userDeletedBlock = route.slice(
      userDeletedStart,
      route.indexOf('if (event.type !== "user.created"', userDeletedStart),
    );

    assert.match(userDeletedBlock, /const anonymized = await anonymizeUserAccountByClerkId\(event\.data\.id\)/);
    assert.match(userDeletedBlock, /"inProgress" in anonymized && anonymized\.inProgress/);
    assert.match(userDeletedBlock, /markClerkWebhookFailed\(svixId, retryError\)/);
    assert.match(userDeletedBlock, /source: "clerk_webhook_user_deleted_in_progress"/);
    assert.match(userDeletedBlock, /status: HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(userDeletedBlock, /"Retry-After": String\(CLERK_WEBHOOK_RETRY_AFTER_SECONDS\)/);
    assert.ok(
      userDeletedBlock.indexOf("markClerkWebhookFailed(svixId, retryError)") <
        userDeletedBlock.indexOf("return NextResponse.json"),
      "in-progress local anonymization should leave the Clerk event retryable before returning 503",
    );
    assert.doesNotMatch(userDeletedBlock, /await markClerkWebhookProcessed\(svixId\);\s*return NextResponse\.json\(\s*\{ ok: true \}\s*\);[\s\S]*inProgress/);
  });

  it("captures each Resend recipient task failure before retrying the webhook", () => {
    const route = source("src/app/api/resend/webhook/route.ts");

    assert.match(route, /Promise\.allSettled\(tasks\)/);
    assert.match(route, /"resend_webhook_suppress_email"/);
    assert.match(route, /"resend_webhook_transient_failure"/);
    assert.match(route, /recipientIndex: index/);
    assert.doesNotMatch(route, /await Promise\.all\(\s*emails\.map/s);
  });
});
