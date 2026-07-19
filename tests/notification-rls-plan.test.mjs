import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

describe("Bucket B Notification RLS inventory", () => {
  it("pins the current cross-user creation and direct-access surfaces", () => {
    const files = sourceFiles("src");
    const createCallers = [];
    const directAccess = [];
    let createInvocationCount = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const calls = source.match(/createNotification\(\{/g) ?? [];
      const callerCount = file === "src/lib/notifications.ts" ? calls.length - 1 : calls.length;
      if (callerCount > 0) createCallers.push(file);
      createInvocationCount += callerCount;
      if (
        /\b(?:prisma|tx|db)\.notification\.(?:find|count|create|update|delete|upsert)/.test(source)
        || /(?:FROM|DELETE FROM) "Notification"/.test(source)
      ) {
        directAccess.push(file);
      }
    }

    assert.equal(createInvocationCount, 51);
    assert.equal(createCallers.length, 28);
    assert.deepEqual(directAccess.sort(), [
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/api/cron/notification-prune/route.ts",
      "src/lib/accountDeletion.ts",
      "src/lib/notificationOwnerAccess.ts",
      "src/lib/notifications.ts",
    ]);
  });

  it("keeps asymmetric writes, staged activation, and blockers explicit", () => {
    const plan = fs.readFileSync("docs/rls-bucket-b-notification-plan.md", "utf8");
    assert.match(plan, /Bucket B means `Notification` only/);
    assert.match(plan, /51 `createNotification/);
    assert.match(plan, /column-level `UPDATE \(read\)` only/);
    assert.match(plan, /Do not grant direct `INSERT` or `DELETE`/);
    assert.match(plan, /legacy account-deletion text scan\/redaction/);
    assert.match(plan, /generic provider wrapper\/performance gate/);
    assert.match(plan, /explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY`/);
    assert.match(plan, /separate `FORCE ROW LEVEL SECURITY` release/);
    assert.match(plan, /prohibit[\s\S]{0,80}production Notification RLS activation/i);
  });

  it("starts B0 with paired source metadata and legacy-only fallbacks", () => {
    const sources = fs.readFileSync("src/lib/notificationSources.ts", "utf8");
    const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");
    const blog = fs.readFileSync("src/app/admin/blog/page.tsx", "utf8");
    const broadcasts = fs.readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");

    assert.match(sources, /BLOG_COMMENT: "blog_comment"/);
    assert.match(sources, /SELLER_BROADCAST: "seller_broadcast"/);
    assert.match(sources, /\{ sourceType: NotificationSourceType; sourceId: string \}/);
    assert.match(sources, /\{ sourceType\?: never; sourceId\?: never \}/);
    assert.match(notifications, /& NotificationSourceFields/);
    assert.equal((blog.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.BLOG_COMMENT/g) ?? []).length, 3);
    assert.match(blog, /sourceType: null,\s*sourceId: null/);
    assert.match(broadcasts, /sourceType: NOTIFICATION_SOURCE_TYPES\.SELLER_BROADCAST/);
    assert.match(broadcasts, /sourceType: null,\s*sourceId: null/);
  });

  it("requires branded context transactions for every recipient operation", () => {
    const ownerAccess = fs.readFileSync("src/lib/notificationOwnerAccess.ts", "utf8");
    const dashboardPage = fs.readFileSync("src/app/dashboard/notifications/page.tsx", "utf8");

    assert.match(ownerAccess, /Pick<DbUserContextTransactionClient, "notification">/);
    assert.equal((ownerAccess.match(/^export async function /gm) ?? []).length, 8);
    assert.equal((ownerAccess.match(/return withDbUserContext\(userId,/g) ?? []).length, 8);
    assert.doesNotMatch(ownerAccess, /from "@\/lib\/db"/);
    assert.doesNotMatch(ownerAccess, /NotificationOwnerAccessClient = prisma/);
    assert.doesNotMatch(ownerAccess, /Promise\.all/);
    assert.match(dashboardPage, /ownerNotificationPageData\(me\.id/);
    assert.doesNotMatch(dashboardPage, /ownerNotificationPageRows/);
  });
});
