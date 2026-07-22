import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  normalizeNotificationLegacyCounts,
  parseNotificationLegacyInspectionConfig,
} from "../scripts/notification-legacy-inspect.mjs";

const DIRECT_URL = "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const PREREQUISITE = "saved-search-phase-b-and-runtime-separation-postflights-passed";

function configEnv() {
  return {
    DIRECT_URL,
    MIGRATION_DB_ROLE: "neondb_owner",
    NOTIFICATION_LEGACY_INSPECT_CONFIRM: "inspect-prelaunch-notification-legacy-state",
    NOTIFICATION_RLS_PREREQUISITES_CONFIRMED: PREREQUISITE,
  };
}

describe("Notification prelaunch legacy inspection operator", () => {
  const source = fs.readFileSync("scripts/notification-legacy-inspect.mjs", "utf8");
  const accountDeletion = fs.readFileSync("src/lib/accountDeletion.ts", "utf8");
  const blogAdmin = fs.readFileSync("src/app/admin/blog/page.tsx", "utf8");
  const broadcastAdmin = fs.readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");

  it("requires exact prerequisite and inspect-only acknowledgement", () => {
    assert.equal(parseNotificationLegacyInspectionConfig(configEnv()).mode, "inspect");
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        NOTIFICATION_LEGACY_INSPECT_CONFIRM: "yes",
      }),
      /must match the reviewed inspect value/,
    );
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        NOTIFICATION_RLS_PREREQUISITES_CONFIRMED: "pending",
      }),
      /prerequisites are not explicitly confirmed/,
    );
  });

  it("rejects pooler and non-owner targets", () => {
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        DIRECT_URL: DIRECT_URL.replace(".westus3", "-pooler.westus3"),
      }),
      /not the reviewed direct production owner target/,
    );
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        MIGRATION_DB_ROLE: "grainline_app_runtime",
      }),
      /not the reviewed direct production owner target/,
    );
  });

  it("keeps the standalone operator read-only and pre-RLS only", () => {
    assert.match(source, /row\.rls_enabled !== false/);
    assert.match(source, /row\.rls_forced !== false/);
    assert.doesNotMatch(source, /DELETE FROM public\."Notification"|LOCK TABLE|\bCOMMIT\b/);
  });

  it("normalizes only aggregate evidence and rejects malformed counts", () => {
    assert.deepEqual(normalizeNotificationLegacyCounts({
      total_count: "4",
      missing_source_count: "3",
      missing_related_user_count: "2",
    }), { total: 4, missingSource: 3, missingRelatedUser: 2 });
    assert.throws(
      () => normalizeNotificationLegacyCounts({ total_count: "NaN" }),
      /invalid counts/,
    );
  });

  it("removes broad runtime Notification cleanup fallbacks", () => {
    assert.doesNotMatch(accountDeletion, /tx\.notification\.|FROM "Notification"/);
    assert.doesNotMatch(blogAdmin, /tx\.notification\./);
    assert.doesNotMatch(broadcastAdmin, /tx\.notification\./);
    assert.match(blogAdmin, /deleteBlogCommentNotificationServiceRows/);
    assert.match(broadcastAdmin, /deleteSellerBroadcastNotificationServiceRows/);
  });
});
