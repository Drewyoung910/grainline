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
    let objectLiteralCreateCount = 0;
    let indirectCreateCount = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const calls = source.match(/createNotification\(\{/g) ?? [];
      const callerCount = file === "src/lib/notifications.ts" ? calls.length - 1 : calls.length;
      const indirectCount = (source.match(/createNotification\(payload\)/g) ?? []).length;
      if (callerCount + indirectCount > 0) createCallers.push(file);
      objectLiteralCreateCount += callerCount;
      indirectCreateCount += indirectCount;
      if (
        /\b(?:prisma|tx|db)\.notification\.(?:find|count|create|update|delete|upsert)/.test(source)
        || /(?:FROM|DELETE FROM) "Notification"/.test(source)
      ) {
        directAccess.push(file);
      }
    }

    const fulfillment = fs.readFileSync("src/app/api/orders/[id]/fulfillment/route.ts", "utf8");
    const fulfillmentPayloadCount = (fulfillment.match(/await notifyBuyer\([\s\S]{0,100}?\{/g) ?? []).length;
    assert.equal(objectLiteralCreateCount, 51);
    assert.equal(indirectCreateCount, 1);
    assert.equal(objectLiteralCreateCount + indirectCreateCount, 52);
    assert.equal(fulfillmentPayloadCount, 3);
    assert.equal(objectLiteralCreateCount + fulfillmentPayloadCount, 54);
    assert.equal(createCallers.length, 29);
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
    assert.match(plan, /52 direct `createNotification/);
    assert.match(plan, /54 distinct emission paths/);
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
    assert.match(plan, /26 of the 54 emission paths do not\s+yet carry provenance/);
    assert.match(plan, /54 distinct emission paths\. Twenty-eight are currently\s+source-tagged and 26 are source-less/);
    assert.match(plan, /type-specific database\s+predicates or split service functions/);
    assert.match(plan, /notification-create-authority-inventory\.md/);
    assert.match(plan, /fixed-column insert primitive ungranted to runtime/);
    assert.match(strategy, /isolated implementation drafts/);
    assert.match(strategy, /before any Bucket B merge, deployment, or\s+live-database activation/);
    assert.match(strategy, /before merging,\s+deploying, or activating Notification\/Bucket B/);
    assert.doesNotMatch(strategy, /before beginning\s+Notification\/Bucket B/);
    assert.match(strategy, /twelve owner-backed functions/);
    assert.match(strategy, /runtime-ungranted fixed-column core/);
    assert.match(strategy, /`SECURITY INVOKER` recipient RPCs/);
    assert.match(strategy, /must not be conflated with recipient RPCs/);
    assert.match(strategy, /26 source-less emission paths/);
    assert.match(strategy, /currently fail closed/);
    assert.match(strategy, /bounded caller control of notification text/);
    assert.match(strategy, /dedup identity inside owner authority/);
    assert.match(strategy, /do not yet serialize with a\s+concurrent block insertion/);
  });

  it("pins the complete creation-authority family inventory", () => {
    const inventory = fs.readFileSync("docs/notification-create-authority-inventory.md", "utf8");
    const familyCounts = [5, 10, 2, 3, 12, 4, 3, 3, 3, 9];

    assert.equal(familyCounts.reduce((sum, count) => sum + count, 0), 54);
    assert.match(inventory, /52 direct `createNotification` calls across 29 files/);
    assert.match(inventory, /54\s+distinct emission paths/);
    assert.match(inventory, /28 source-tagged paths/);
    assert.match(inventory, /26 source-less paths/);
    assert.match(inventory, /23 paths currently carrying `relatedUserId`/);
    assert.match(inventory, /internal fixed-column insert primitive ungranted to `PUBLIC` and the\s+runtime role/);
    assert.match(inventory, /Grant runtime only reviewed family functions/);
    assert.match(inventory, /provider and cron families[\s\S]{0,220}persisted order\/payment\/payout/);
    assert.match(inventory, /staff-only families[\s\S]{0,220}audit or domain source/);
    assert.match(inventory, /caller-supplied title and body/);
    assert.match(inventory, /dedup identity[\s\S]{0,180}derived inside owner authority/);
    assert.match(inventory, /do not serialize against a concurrent\s+block creation/);
    assert.match(inventory, /reserved listing,[\s\S]{0,80}seller, buyer, conversation/);
    assert.doesNotMatch(inventory, /custom-listing reservation\/link binding remains blocking/);
    assert.doesNotMatch(inventory, /write-side RLS on Notification is low-value/);
  });

  it("starts B0 with paired source metadata and legacy-only fallbacks", () => {
    const sources = fs.readFileSync("src/lib/notificationSources.ts", "utf8");
    const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");
    const blog = fs.readFileSync("src/app/admin/blog/page.tsx", "utf8");
    const broadcasts = fs.readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");
    const favorite = fs.readFileSync("src/app/api/favorites/route.ts", "utf8");
    const follow = fs.readFileSync("src/app/api/follow/[sellerId]/route.ts", "utf8");
    const review = fs.readFileSync("src/app/api/reviews/route.ts", "utf8");
    const followerBlog = fs.readFileSync("src/lib/followerBlogNotifications.ts", "utf8");
    const followerListing = fs.readFileSync("src/lib/followerListingNotifications.ts", "utf8");
    const messagePage = fs.readFileSync("src/app/messages/[id]/page.tsx", "utf8");
    const customOrderRequest = fs.readFileSync("src/app/api/messages/custom-order-request/route.ts", "utf8");
    const customOrderReady = fs.readFileSync("src/lib/customOrderReadyLink.ts", "utf8");
    const caseOpen = fs.readFileSync("src/app/api/cases/route.ts", "utf8");
    const caseMessages = fs.readFileSync("src/app/api/cases/[id]/messages/route.ts", "utf8");
    const caseMarkResolved = fs.readFileSync("src/app/api/cases/[id]/mark-resolved/route.ts", "utf8");
    const caseResolve = fs.readFileSync("src/app/api/cases/[id]/resolve/route.ts", "utf8");
    const caseAutoClose = fs.readFileSync("src/app/api/cron/case-auto-close/route.ts", "utf8");
    const commissionInterest = fs.readFileSync("src/app/api/commission/[id]/interest/route.ts", "utf8");
    const commissionStatus = fs.readFileSync("src/app/api/commission/[id]/route.ts", "utf8");
    const commissionExpire = fs.readFileSync("src/app/api/cron/commission-expire/route.ts", "utf8");
    const sellerBroadcast = fs.readFileSync("src/app/api/seller/broadcast/route.ts", "utf8");
    const stripeWebhook = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

    assert.match(sources, /BLOG_COMMENT: "blog_comment"/);
    assert.match(sources, /CASE: "case"/);
    assert.match(sources, /CASE_MESSAGE: "case_message"/);
    assert.match(sources, /CASE_RESOLUTION_MARK: "case_resolution_mark"/);
    assert.match(sources, /CASE_SYSTEM_ACTION: "case_system_action"/);
    assert.match(sources, /COMMISSION_INTEREST: "commission_interest"/);
    assert.match(sources, /COMMISSION_REQUEST: "commission_request"/);
    assert.match(sources, /CHECKOUT_LOW_STOCK: "checkout_low_stock"/);
    assert.match(sources, /FAVORITE: "favorite"/);
    assert.match(sources, /FOLLOW: "follow"/);
    assert.match(sources, /MESSAGE: "message"/);
    assert.match(sources, /REVIEW: "review"/);
    assert.match(sources, /SELLER_BROADCAST: "seller_broadcast"/);
    assert.match(sources, /\{ sourceType: NotificationSourceType; sourceId: string \}/);
    assert.match(sources, /\{ sourceType\?: never; sourceId\?: never \}/);
    assert.match(notifications, /& NotificationSourceFields/);
    assert.equal((blog.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.BLOG_COMMENT/g) ?? []).length, 2);
    assert.match(blog, /deleteBlogCommentNotificationServiceRows\(tx, deleted\.id\)/);
    assert.match(blog, /sourceType: null,\s*sourceId: null/);
    assert.match(broadcasts, /deleteSellerBroadcastNotificationServiceRows\(tx, broadcast\.id\)/);
    assert.match(broadcasts, /sourceType: null,\s*sourceId: null/);
    assert.match(favorite, /sourceType: NOTIFICATION_SOURCE_TYPES\.FAVORITE,\s*sourceId: listingId/);
    assert.match(follow, /sourceType: NOTIFICATION_SOURCE_TYPES\.FOLLOW,\s*sourceId: sellerProfile\.id/);
    assert.match(review, /sourceType: NOTIFICATION_SOURCE_TYPES\.REVIEW,\s*sourceId: created\.id/);
    assert.match(messagePage, /sourceType: NOTIFICATION_SOURCE_TYPES\.MESSAGE,\s*sourceId: committedNotificationMessageId/);
    assert.match(customOrderRequest, /sourceType: NOTIFICATION_SOURCE_TYPES\.MESSAGE,\s*sourceId: requestMessage\.id/);
    assert.match(customOrderReady, /sourceType: NOTIFICATION_SOURCE_TYPES\.MESSAGE,\s*sourceId: notificationMessageId/);
    assert.match(caseOpen, /sourceType: NOTIFICATION_SOURCE_TYPES\.CASE,\s*sourceId: newCase\.id/);
    assert.equal((caseMessages.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.CASE_MESSAGE/g) ?? []).length, 3);
    assert.match(caseMarkResolved, /sourceType: NOTIFICATION_SOURCE_TYPES\.CASE_RESOLUTION_MARK,\s*sourceId: authoritySourceId/);
    assert.match(caseMarkResolved, /prisma\.\$transaction\(async \(tx\) =>[\s\S]{0,4500}logAdminActionOrThrow\(\{[\s\S]{0,180}client: tx/);
    assert.match(caseMarkResolved, /action: "MARK_CASE_RESOLVED"[\s\S]{0,180}actorKind: "user"/);
    assert.match(caseResolve, /sourceType: NOTIFICATION_SOURCE_TYPES\.CASE,\s*sourceId: id/);
    assert.equal((caseAutoClose.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.CASE_SYSTEM_ACTION/g) ?? []).length, 6);
    assert.equal((caseAutoClose.match(/const auditLogId = await logSystemActionOrThrow/g) ?? []).length, 3);
    assert.equal((caseAutoClose.match(/return auditLogId/g) ?? []).length, 3);
    assert.match(commissionInterest, /sourceType: NOTIFICATION_SOURCE_TYPES\.COMMISSION_INTEREST,\s*sourceId: finalCommissionInterestId/);
    assert.match(commissionStatus, /sourceType: NOTIFICATION_SOURCE_TYPES\.COMMISSION_REQUEST,\s*sourceId: id/);
    assert.equal((commissionExpire.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.COMMISSION_REQUEST/g) ?? []).length, 2);
    assert.match(stripeWebhook, /sourceType: NOTIFICATION_SOURCE_TYPES\.CHECKOUT_LOW_STOCK,\s*sourceId: sourceItem\.orderItemId/);
    const taggedCreationCount = [
      blog,
      favorite,
      follow,
      review,
      followerBlog,
      followerListing,
      messagePage,
      customOrderRequest,
      customOrderReady,
      caseOpen,
      caseMessages,
      caseMarkResolved,
      caseResolve,
      caseAutoClose,
      commissionInterest,
      commissionStatus,
      commissionExpire,
      sellerBroadcast,
      stripeWebhook,
    ].reduce((count, source) => count + (source.match(/createNotification\(\{[\s\S]{0,700}?sourceType:/g) ?? []).length, 0);
    assert.equal(taggedCreationCount, 28);
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
    assert.match(notifications, /relatedUserId: relatedUserId \?\? null,\s*\}\);/);
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
    assert.equal(relatedUserAssignments, 23);

    assert.match(accountDeletion, /deleteAccountNotificationServiceRows\(tx, user\.id\)/);
    assert.equal((accountDeletion.match(/AND "relatedUserId" IS NULL/g) ?? []).length, 2);
  });

  it("drafts narrow service authority without direct runtime table writes", () => {
    const sql = fs.readFileSync("docs/rls-drafts/notification-service-authority.sql", "utf8");
    const serviceAccess = fs.readFileSync("src/lib/notificationServiceAccess.ts", "utf8");
    const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");

    const functionNames = [
      "grainline_notification_create_core",
      "grainline_notification_create_source_fanout",
      "grainline_notification_create_social_event",
      "grainline_notification_create_message_event",
      "grainline_notification_create_case_event",
      "grainline_notification_create_commission_event",
      "grainline_notification_create_inventory_event",
      "grainline_notification_delete_for_account",
      "grainline_notification_delete_blog_comment",
      "grainline_notification_delete_seller_broadcast",
      "grainline_notification_prune_read_batch",
      "grainline_notification_prune_unread_batch",
    ];
    for (const functionName of functionNames) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}\\(`));
    }
    for (const functionName of functionNames.slice(1)) {
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}\\(`));
    }
    assert.equal((sql.match(/^SECURITY DEFINER$/gm) ?? []).length, 12);
    assert.equal((sql.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 12);
    assert.equal((sql.match(/REVOKE ALL ON FUNCTION public\.grainline_notification_/g) ?? []).length, 12);
    assert.equal((sql.match(/FROM PUBLIC, grainline_app_runtime/g) ?? []).length, 12);
    assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION public\.grainline_notification_/g) ?? []).length, 11);
    assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_core\(/);
    assert.match(sql, /recipient\.banned = false[\s\S]{0,100}recipient\."deletedAt" IS NULL[\s\S]{0,80}FOR SHARE/);
    assert.match(sql, /recipient_preferences -> \(p_type::text\) = 'false'::jsonb/);
    assert.match(sql, /pg_catalog\.strpos\(notification_link, pg_catalog\.chr\(92\)\) > 0/);
    assert.match(sql, /notification_link ~ '\[\[:cntrl:\]\]'/);
    assert.match(sql, /notification source metadata must be paired/);
    assert.match(sql, /notification source does not match notification type/);
    assert.match(sql, /notification source requires a distinct related user/);
    assert.match(sql, /social notification requires a social source/);
    assert.match(sql, /source_favorite\."userId" = p_related_user_id/);
    assert.match(sql, /source_follow\."followerId" = p_related_user_id/);
    assert.match(sql, /source_message\."senderId" = p_related_user_id/);
    assert.match(sql, /source_message\."recipientId" = p_user_id/);
    assert.match(sql, /source_message\.kind = 'custom_order_request'/);
    assert.match(sql, /source_message\.kind = 'custom_order_link'/);
    assert.match(sql, /context_listing\."customOrderConversationId" = source_conversation\.id/);
    assert.match(sql, /context_listing\."reservedForUserId" = p_user_id/);
    assert.match(sql, /context_seller\."userId" = p_related_user_id/);
    assert.match(sql, /context_listing\.status IN \('ACTIVE', 'SOLD_OUT'\)/);
    assert.match(sql, /pg_catalog\.substring\([\s\S]{0,100}source_message\.body,[\s\S]{0,100}'"listingId":"\(\[\^"\]\+\)"'/);
    assert.match(sql, /source_review\."reviewerId" = p_related_user_id/);
    assert.match(sql, /source_message\."authorId" = p_related_user_id/);
    assert.match(sql, /source_audit\.action = 'MARK_CASE_RESOLVED'/);
    assert.match(sql, /source_audit\."actorType" = 'cron'/);
    assert.match(sql, /source_audit\.metadata ->> 'previousStatus' IN \('OPEN', 'IN_DISCUSSION'\)/);
    assert.match(sql, /source_case\."resolvedById" = p_related_user_id/);
    assert.match(sql, /source_request\."buyerId" = p_user_id/);
    assert.match(sql, /source_seller\."userId" = p_related_user_id/);
    assert.match(sql, /source_request\.status IN \('CLOSED', 'FULFILLED', 'EXPIRED'\)/);
    assert.match(sql, /source_reservation\.status = 'COMPLETED'/);
    assert.match(sql, /source_reservation\."reservedItems" @> pg_catalog\.jsonb_build_array/);
    assert.match(sql, /source_listing\."stockQuantity" > 0[\s\S]{0,100}source_listing\."stockQuantity" <= 2/);
    assert.match(sql, /INTO notification_link, notification_title, notification_body/);
    assert.match(sql, /p_related_user_id IS NULL/);
    assert.match(sql, /p_related_user_id[\s\S]{0,1000}related_user\.banned = false[\s\S]{0,100}FOR SHARE/);
    assert.match(sql, /source_comment\."authorId" = p_related_user_id/);
    assert.match(sql, /parent_comment\."authorId" = p_user_id/);
    assert.equal((sql.match(/JOIN public\."Follow" AS source_follow/g) ?? []).length, 3);
    assert.equal((sql.match(/source_seller\."userId" = p_related_user_id/g) ?? []).length, 4);
    assert.match(sql, /account_user\.id = p_user_id FOR UPDATE/);
    assert.match(sql, /blog comment notification cleanup requires a deleted source/);
    assert.match(sql, /seller broadcast notification cleanup requires a deleted source/);
    assert.match(sql, /ON CONFLICT \("userId", "type", "dedupKey"\) DO NOTHING/);
    assert.match(sql, /replay_material := pg_catalog\.concat_ws\(/);
    assert.equal((sql.match(/pg_catalog\.md5\(/g) ?? []).length, 2);
    assert.doesNotMatch(sql, /\bp_link\b|\bp_dedup_key\b/);
    assert.match(sql, /request_user_id <> p_user_id/);
    assert.equal((sql.match(/requires staff context/g) ?? []).length, 2);
    assert.match(sql, /interval '90 days'/);
    assert.match(sql, /interval '365 days'/);
    assert.equal((sql.match(/LIMIT 1000/g) ?? []).length, 2);
    assert.match(sql, /REVOKE INSERT, DELETE ON TABLE public\."Notification" FROM grainline_app_runtime/);
    assert.doesNotMatch(sql, /grainline_notification_delete_source/);
    assert.doesNotMatch(sql, /\bEXECUTE\s+(?:format|p_)/i);

    assert.match(serviceAccess, /public\.grainline_notification_create_source_fanout\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_social_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_message_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_case_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_commission_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_inventory_event\(/);
    assert.doesNotMatch(serviceAccess, /extractRouteId|authorityContextId|\$\{link\}|\$\{dedupKey\}/);
    assert.match(serviceAccess, /notification create family is not implemented for a source-less event/);
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
