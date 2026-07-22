import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Notification verification and Guild authority", () => {
  const admin = source("src/app/admin/verification/page.tsx");
  const memberCron = source("src/app/api/cron/guild-member-check/route.ts");
  const metricsCron = source("src/app/api/cron/guild-metrics/route.ts");
  const sql = source("docs/rls-drafts/notification-service-authority.sql");

  it("binds all seven staff notifications to transaction-returned admin audit ids", () => {
    assert.equal(
      (admin.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.GUILD_ADMIN_ACTION/g) ?? []).length,
      7,
    );
    assert.equal((admin.match(/sourceId: (?:approval|rejection|revocation)AuditId/g) ?? []).length, 6);
    assert.match(admin, /sourceId: reinstatedSeller\.auditLogId/);
    assert.equal((admin.match(/return logAdminActionOrThrow\(\{/g) ?? []).length, 6);
    assert.match(admin, /const auditLogId = await logAdminActionOrThrow\(\{/);
    assert.match(admin, /return \{ \.\.\.seller, auditLogId \}/);
  });

  it("co-commits all three cron sources and does not authorize a warning from mutable state alone", () => {
    assert.match(metricsCron, /action: "WARN_GUILD_MASTER_METRICS"/);
    assert.match(
      metricsCron,
      /const warningAuditId = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]{0,900}client: tx/,
    );
    assert.equal(
      (metricsCron.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.GUILD_SYSTEM_ACTION/g) ?? []).length,
      2,
    );
    assert.equal(
      (memberCron.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.GUILD_SYSTEM_ACTION/g) ?? []).length,
      1,
    );
    assert.match(memberCron, /sourceId: revocationAuditId/);
    assert.match(metricsCron, /sourceId: warningAuditId/);
    assert.match(metricsCron, /sourceId: revocationAuditId/);
  });

  it("derives staff and cron payload authority from exact actors, audits, recipients, and states", () => {
    assert.match(sql, /p_source_type = 'guild_admin_action'/);
    assert.match(sql, /p_source_type = 'guild_system_action'/);
    assert.match(sql, /source_audit\.undone = false/);
    assert.match(sql, /source_staff\.role IN \('EMPLOYEE', 'ADMIN'\)/);
    assert.match(sql, /source_audit\.action <> 'REINSTATE_GUILD_MEMBER' OR source_staff\.role = 'ADMIN'/);
    assert.match(sql, /source_verification\."reviewedById" = source_audit\."adminId"/);
    assert.match(sql, /source_seller\."userId" = p_user_id/);
    assert.match(sql, /source_verification\.status = 'GUILD_MASTER_APPROVED'/);
    assert.match(sql, /source_seller\."guildLevel" = 'GUILD_MASTER'/);
    assert.match(sql, /source_audit\."actorId" = CASE[\s\S]{0,180}'guild-member-check'[\s\S]{0,120}'guild-metrics'/);
    assert.match(sql, /source_audit\.metadata ->> 'jobName' = source_audit\."actorId"/);
    assert.match(sql, /source_audit\.metadata ->> 'sellerUserId' = source_seller\."userId"/);
    assert.match(sql, /verification notification requires a reviewed Guild source/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_verification_event/);
  });
});
