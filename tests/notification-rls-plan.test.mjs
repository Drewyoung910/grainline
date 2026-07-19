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
      "src/lib/accountDeletion.ts",
      "src/lib/notificationOwnerAccess.ts",
    ]);
  });

  it("keeps asymmetric writes, staged activation, and blockers explicit", () => {
    const plan = fs.readFileSync("docs/rls-bucket-b-notification-plan.md", "utf8");
    const strategy = fs.readFileSync("STRATEGY.md", "utf8");
    assert.match(plan, /Bucket B means `Notification` only/);
    assert.match(plan, /51 `createNotification/);
    assert.match(plan, /column-level `UPDATE \(read\)` only/);
    assert.match(plan, /Do not grant direct `INSERT` or `DELETE`/);
    assert.match(plan, /legacy account-deletion text scan\/redaction/);
    assert.match(plan, /generic provider wrapper\/performance gate/);
    assert.match(plan, /explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY`/);
    assert.match(plan, /separate `FORCE ROW LEVEL SECURITY` release/);
    assert.match(plan, /production Notification RLS activation/i);
    assert.match(plan, /They prohibit merge, deployment, live-database or staging activation/);
    assert.match(plan, /isolated B0 implementation in progress/);
    assert.match(plan, /Code, unapplied migration\/RPC\/policy drafts, tests, and local\s+verification may continue/);
    assert.match(plan, /No Notification[\s\S]{0,140}merge, deploy, touch a live database/);
    assert.match(plan, /one-statement `SECURITY INVOKER` recipient RPCs/);
    assert.match(plan, /Recipient RPCs are distinct from cross-user creation\/cleanup service\s+authority/);
    assert.match(plan, /46 of the 51 creation callsites do not\s+yet carry a lifecycle source/);
    assert.match(plan, /type-specific database\s+predicates or split service functions/);
    assert.match(strategy, /isolated implementation drafts/);
    assert.match(strategy, /before any Bucket B merge, deployment, or\s+live-database activation/);
    assert.match(strategy, /before merging,\s+deploying, or activating Notification\/Bucket B/);
    assert.doesNotMatch(strategy, /before beginning\s+Notification\/Bucket B/);
    assert.match(strategy, /six fixed-purpose owner-backed/);
    assert.match(strategy, /`SECURITY INVOKER` recipient RPCs/);
    assert.match(strategy, /must not be conflated with recipient RPCs/);
    assert.match(strategy, /46 source-less paths/);
    assert.match(strategy, /add database\s+predicates or split functions/);
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
    assert.equal((blog.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.BLOG_COMMENT/g) ?? []).length, 2);
    assert.match(blog, /deleteBlogCommentNotificationServiceRows\(tx, deleted\.id\)/);
    assert.match(blog, /sourceType: null,\s*sourceId: null/);
    assert.match(broadcasts, /deleteSellerBroadcastNotificationServiceRows\(tx, broadcast\.id\)/);
    assert.match(broadcasts, /sourceType: null,\s*sourceId: null/);
  });

  it("uses exact related-user lifecycle metadata before legacy text cleanup", () => {
    const files = sourceFiles("src");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    const migration = fs.readFileSync(
      "docs/rls-drafts/notification-related-user.sql",
      "utf8",
    );
    const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");
    const accountDeletion = fs.readFileSync("src/lib/accountDeletion.ts", "utf8");
    const runtimeGuard = fs.readFileSync("scripts/guard-runtime-db-env.mjs", "utf8");

    assert.match(schema, /relatedUserId String\?/);
    assert.match(schema, /@@index\(\[relatedUserId\]\)/);
    assert.doesNotMatch(schema, /NotificationRelatedUser/);
    assert.match(migration, /ADD COLUMN "relatedUserId" TEXT/);
    assert.doesNotMatch(migration, /FOREIGN KEY|ON DELETE/);
    assert.match(migration, /lifecycle metadata key, not a Prisma ownership relation/);
    assert.equal(
      fs.existsSync("prisma/migrations/20260720070000_add_notification_related_user"),
      false,
    );
    assert.match(migration, /deliberately outside\s+-- prisma\/migrations/);
    assert.match(notifications, /NotificationRelatedUserFields/);
    assert.match(notifications, /relatedUserId: relatedUserId \?\? null,\s*dedupKey/);
    assert.match(runtimeGuard, /assertNoNotificationRlsDraftDeployment/);
    assert.match(runtimeGuard, /notification-service-authority\.sql/);
    assert.match(runtimeGuard, /deployment is barred while the unapplied Notification RLS draft is present/);

    const relatedUserAssignments = files.reduce((count, file) => {
      const source = fs.readFileSync(file, "utf8");
      if (file === "src/lib/notifications.ts" || !source.includes("createNotification({")) {
        return count;
      }
      return count + (source.match(/relatedUserId\s*:/g) ?? []).length;
    }, 0);
    assert.equal(relatedUserAssignments, 21);

    assert.match(accountDeletion, /deleteAccountNotificationServiceRows\(tx, user\.id\)/);
    assert.equal((accountDeletion.match(/AND "relatedUserId" IS NULL/g) ?? []).length, 2);
  });

  it("drafts narrow service authority without direct runtime table writes", () => {
    const sql = fs.readFileSync("docs/rls-drafts/notification-service-authority.sql", "utf8");
    const serviceAccess = fs.readFileSync("src/lib/notificationServiceAccess.ts", "utf8");
    const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");

    for (const functionName of [
      "grainline_notification_create",
      "grainline_notification_delete_for_account",
      "grainline_notification_delete_blog_comment",
      "grainline_notification_delete_seller_broadcast",
      "grainline_notification_prune_read_batch",
      "grainline_notification_prune_unread_batch",
    ]) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}\\(`));
    }
    assert.equal((sql.match(/^SECURITY DEFINER$/gm) ?? []).length, 6);
    assert.equal((sql.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 6);
    assert.equal((sql.match(/REVOKE ALL ON FUNCTION public\.grainline_notification_/g) ?? []).length, 6);
    assert.equal((sql.match(/FROM PUBLIC, grainline_app_runtime/g) ?? []).length, 6);
    assert.match(sql, /recipient\.banned = false[\s\S]{0,100}recipient\."deletedAt" IS NULL[\s\S]{0,80}FOR SHARE/);
    assert.match(sql, /recipient_preferences -> \(p_type::text\) = 'false'::jsonb/);
    assert.match(sql, /pg_catalog\.strpos\(p_link, pg_catalog\.chr\(92\)\) > 0/);
    assert.match(sql, /p_link ~ '\[\[:cntrl:\]\]'/);
    assert.match(sql, /notification source metadata must be paired/);
    assert.match(sql, /notification source does not match notification type/);
    assert.match(sql, /notification source requires a distinct related user/);
    assert.match(sql, /p_related_user_id[\s\S]{0,1000}related_user\.banned = false[\s\S]{0,100}FOR SHARE/);
    assert.match(sql, /source_comment\."authorId" = p_related_user_id/);
    assert.match(sql, /parent_comment\."authorId" = p_user_id/);
    assert.equal((sql.match(/JOIN public\."Follow" AS source_follow/g) ?? []).length, 3);
    assert.equal((sql.match(/source_seller\."userId" = p_related_user_id/g) ?? []).length, 3);
    assert.match(sql, /account_user\.id = p_user_id FOR UPDATE/);
    assert.match(sql, /blog comment notification cleanup requires a deleted source/);
    assert.match(sql, /seller broadcast notification cleanup requires a deleted source/);
    assert.match(sql, /ON CONFLICT \("userId", "type", "dedupKey"\) DO NOTHING/);
    assert.match(sql, /request_user_id <> p_user_id/);
    assert.equal((sql.match(/requires staff context/g) ?? []).length, 2);
    assert.match(sql, /interval '90 days'/);
    assert.match(sql, /interval '365 days'/);
    assert.equal((sql.match(/LIMIT 1000/g) ?? []).length, 2);
    assert.match(sql, /REVOKE INSERT, DELETE ON TABLE public\."Notification" FROM grainline_app_runtime/);
    assert.doesNotMatch(sql, /grainline_notification_delete_source/);
    assert.doesNotMatch(sql, /\bEXECUTE\s+(?:format|p_)/i);

    assert.match(serviceAccess, /public\.grainline_notification_create\(/);
    assert.match(serviceAccess, /public\.grainline_notification_delete_for_account\(/);
    assert.match(serviceAccess, /public\.grainline_notification_delete_blog_comment\(/);
    assert.match(serviceAccess, /public\.grainline_notification_delete_seller_broadcast\(/);
    assert.match(serviceAccess, /public\.grainline_notification_prune_read_batch\(\)/);
    assert.match(serviceAccess, /public\.grainline_notification_prune_unread_batch\(\)/);
    assert.match(serviceAccess, /Pick<DbUserContextTransactionClient, "\$queryRaw">/);
    assert.doesNotMatch(serviceAccess, /prisma\.notification\./);
    assert.match(notifications, /createNotificationServiceRow\(\{/);
    assert.match(notifications, /notificationId: randomUUID\(\)/);
    assert.doesNotMatch(notifications, /prisma\.notification\.(?:create|findUnique)/);
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
