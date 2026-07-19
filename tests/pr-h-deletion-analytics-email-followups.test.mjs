import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  emailPreferenceLookupFailureAllowsSend,
} = await import("../src/lib/notificationPreferenceState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("PR H account deletion, analytics, and email follow-ups", () => {
  it("preserves conversations while redacting deleted user's sent messages", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const schema = source("prisma/schema.prisma");

    assert.doesNotMatch(accountDeletion, /tx\.conversation\.deleteMany/);
    assert.match(accountDeletion, /tx\.message\.updateMany\(\{\s*where: \{ senderId: user\.id \}/s);
    assert.match(schema, /userA\s+User\s+@relation\("ConvoA".*onDelete: Restrict\)/);
    assert.match(schema, /userB\s+User\s+@relation\("ConvoB".*onDelete: Restrict\)/);
  });

  it("skips likely bots for listing and seller analytics counters", () => {
    assert.match(source("src/lib/botUserAgent.ts"), /facebookexternalhit/);
    for (const path of [
      "src/app/api/listings/[id]/view/route.ts",
      "src/app/api/listings/[id]/click/route.ts",
      "src/app/api/seller/[id]/view/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /isLikelyBotUserAgent/);
      assert.match(text, /return telemetryJson\(\{ ok: true, skipped: true \}\)/);
      assert.match(text, /privateResponse\(NextResponse\.json\(body\)\)/);
    }
  });

  it("fails closed when email preference or inactive-account lookups fail", () => {
    const notifications = source("src/lib/notifications.ts");
    const notificationServiceSql = source("docs/rls-drafts/notification-service-authority.sql");
    const email = source("src/lib/email.ts");

    assert.equal(emailPreferenceLookupFailureAllowsSend(), false);
    assert.match(notifications, /failClosed: true/);
    assert.match(notifications, /logServerError\(e, \{\s*source: "email_preference_check"/);
    assert.match(notifications, /extra: \{ userId, prefKey, failClosed: true \}/);
    assert.match(notifications, /return emailPreferenceLookupFailureAllowsSend\(\)/);
    assert.match(notifications, /select: \{ notificationPreferences: true, banned: true, deletedAt: true \}/);
    assert.match(notificationServiceSql, /recipient\.banned = false/);
    assert.match(notificationServiceSql, /recipient\."deletedAt" IS NULL/);
    assert.match(notificationServiceSql, /recipient_preferences -> \(p_type::text\) = 'false'::jsonb/);
    assert.match(notifications, /tags: \{ source: "create_notification", notificationType: type \}/);
    assert.match(notifications, /notificationType: type/);
    assert.match(notifications, /function notificationTelemetryExtra/);
    assert.match(notifications, /hasLink: typeof link === "string" && link\.length > 0/);
    assert.match(notifications, /linkLength: typeof link === "string" \? Math\.min\(link\.length, NOTIFICATION_LINK_MAX_LENGTH\) : 0/);
    assert.match(notifications, /hasDedupScope: Boolean\(dedupScope\)/);
    assert.match(notifications, /extra: notificationTelemetryExtra\(\{ userId, link, dedupScope \}\)/);
    assert.match(notificationServiceSql, /ON CONFLICT \("userId", "type", "dedupKey"\) DO NOTHING/);
    assert.doesNotMatch(notifications, /extra: \{ userId, link \}/);
    assert.doesNotMatch(notifications, /catch \{\s*return null;\s*\}/);
    assert.doesNotMatch(notifications, /return fallbackEnabled/);
    assert.match(email, /inactive-account lookup failed; skipping send/);
    assert.match(email, /throw err/);
    assert.doesNotMatch(email, /sending anyway/);
  });
});
