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
    const backInStockClaimCount = files.reduce((count, file) => (
      count + (fs.readFileSync(file, "utf8").match(/await claimBackInStockNotification\(\{/g) ?? []).length
    ), 0);
    assert.equal(objectLiteralCreateCount, 50);
    assert.equal(indirectCreateCount, 1);
    assert.equal(objectLiteralCreateCount + indirectCreateCount, 51);
    assert.equal(fulfillmentPayloadCount, 3);
    assert.equal(backInStockClaimCount, 1);
    assert.equal(objectLiteralCreateCount + fulfillmentPayloadCount + backInStockClaimCount, 54);
    assert.equal(createCallers.length, 29);
    assert.deepEqual(directAccess.sort(), []);
  });

  it("keeps asymmetric writes, staged activation, and blockers explicit", () => {
    const plan = fs.readFileSync("docs/rls-bucket-b-notification-plan.md", "utf8");
    const strategy = fs.readFileSync("STRATEGY.md", "utf8");
    assert.match(plan, /Bucket B means `Notification` only/);
    assert.match(plan, /51 direct `createNotification/);
    assert.match(plan, /54 distinct emission paths/);
    assert.match(plan, /column-level `UPDATE \(read\)` only/);
    assert.match(plan, /Do not grant direct `INSERT` or `DELETE`/);
    assert.match(plan, /atomic activation-transaction purge/);
    assert.match(plan, /rejects the interactive-transaction wrapper for Notification hot\s+reads/);
    assert.match(plan, /two fresh slots on its\s+real one-statement recipient operations plus route\/data-shape proof/);
    assert.match(plan, /explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY`/);
    assert.match(plan, /separate `FORCE ROW LEVEL SECURITY` release/);
    assert.match(plan, /production\s+Notification RLS activation/i);
    assert.match(plan, /production preparation-release packaging is in progress/);
    assert.match(plan, /No package\s+may merge until temporary Preview artifacts are excluded/);
    assert.match(plan, /No production migration, application deployment, or RLS\s+activation is authorized/);
    assert.match(plan, /activation migration remains absent/);
    assert.match(plan, /one-statement `SECURITY INVOKER`\s+recipient RPC direction/);
    assert.match(plan, /Recipient RPCs are distinct from cross-user creation\/cleanup service\s+authority/);
    assert.match(plan, /All 54 emission paths now carry reviewed creation authority/);
    assert.match(plan, /54 distinct emission paths\. All 54 are currently\s+authority-bound and none are source-less/);
    assert.match(plan, /missing SQL wrapper\/revoke\/runtime grant/);
    assert.match(plan, /notification-create-authority-inventory\.md/);
    assert.match(plan, /fixed-column insert primitive ungranted to runtime/);
    assert.match(strategy, /Bucket A is complete in production/);
    assert.match(strategy, /Runtime database credential separation is also complete/);
    assert.match(strategy, /prerequisite subsequently enabled the\s+separately proven Notification rollout, which is now complete through FORCE/);
    assert.match(strategy, /does not authorize bundling later sensitive tables or putting an owner\s+credential back into an application environment/);
    assert.doesNotMatch(strategy, /before beginning\s+Notification\/Bucket B/);
    assert.match(strategy, /seventeen owner-backed functions/);
    assert.match(strategy, /runtime-ungranted fixed-column core/);
    assert.match(strategy, /`SECURITY INVOKER` recipient RPCs/);
    assert.match(strategy, /must not be conflated\s+with recipient RPCs/);
    assert.match(strategy, /AST gate covers all 54 application emission paths/);
    assert.match(strategy, /executes all 26 family-dispatched\s+private-core source-validation branches/);
    assert.match(strategy, /59 creation cases cover all 38 successful source\/type pairs/);
    assert.match(strategy, /byte-pinned split migration\s+and database-first rollback have passed disposable PostgreSQL proof/);
    assert.match(strategy, /no longer accept notification title, body, link, or dedup/);
    assert.match(strategy, /derives all four inside owner authority/);
    assert.match(strategy, /share a deterministic lock protocol with every\s+ordinary block\/unblock writer/);
    assert.match(plan, /Accepted run `29883083596`/);
    assert.match(plan, /exact source\s+`1b9bd603d53488f18375d369835085e6581fb9b2`/);
    assert.match(plan, /Earlier accepted draft run `29893071538`/);
    assert.match(plan, /exact source\s+`187ac2fa5a5b7c08a3889b27ef57c873ee7a79ea`/);
    assert.match(plan, /Earlier accepted sequencing run `29894316762`/);
    assert.match(plan, /exact source\s+`c47acbc79b77dc51c40024e553ee8efceb2e097a`/);
    assert.match(plan, /Latest accepted run `29894705025`/);
    assert.match(plan, /exact source\s+`a4ced63b065be985965c47a37583ba4c1fdf1e32`/);
    assert.match(plan, /`activationPurgeReversible=false`/);
    assert.match(plan, /technically green but rejected release topology/);
    assert.match(plan, /Accepted run `29892353264`/);
    assert.match(plan, /Accepted run `29890596734`/);
    assert.match(plan, /19 catalog\/isolation\/service\/\s*race checks/);
    assert.match(plan, /genuine draft defect, PostgreSQL error `42804`/);
    assert.match(plan, /expanded-fixture bind parameter was inferred as both `varchar`\s+and `text` \(`42P08`\)/);
    assert.match(plan, /`29892949346`: the Guild-system action-variant fixture/);
    assert.match(plan, /does not claim to stop a fully compromised runtime role/);
    assert.match(strategy, /latest isolated PostgreSQL proof is\s+green/);
    assert.match(strategy, /selected the one-statement RPC direction/);
    assert.match(strategy, /consumed slot 1 and failed the existing generic gate/);
    assert.match(plan, /slot 2 was not called/);
    assert.match(plan, /Do not rerun the same\s+shape hoping/);
    assert.match(plan, /all 24\s+branch variables/);
  });

  it("pins the complete creation-authority family inventory", () => {
    const inventory = fs.readFileSync("docs/notification-create-authority-inventory.md", "utf8");
    const familyCounts = [5, 10, 2, 3, 12, 4, 3, 3, 3, 9];

    assert.equal(familyCounts.reduce((sum, count) => sum + count, 0), 54);
    assert.match(inventory, /51 direct `createNotification` calls across 29 files/);
    assert.match(inventory, /54\s+distinct emission paths/);
    assert.match(inventory, /54 authority-bound paths/);
    assert.match(inventory, /0 source-less paths/);
    assert.match(inventory, /26 literal creation sites currently carrying `relatedUserId`/);
    assert.match(inventory, /internal fixed-column insert primitive ungranted to `PUBLIC` and the\s+runtime role/);
    assert.match(inventory, /Grant runtime only reviewed family functions/);
    assert.match(inventory, /provider and cron families[\s\S]{0,220}persisted order\/payment\/payout/);
    assert.match(inventory, /staff-only families[\s\S]{0,220}audit or domain source/);
    assert.match(inventory, /omit title\/body\/link\/dedup parameters/);
    assert.match(inventory, /dedup identity[\s\S]{0,180}derived inside owner authority/);
    assert.match(inventory, /shared protocol gives the absence check a deterministic linearization\s+point/);
    assert.match(inventory, /reserved listing,[\s\S]{0,80}seller, buyer, conversation/);
    assert.doesNotMatch(inventory, /custom-listing reservation\/link binding remains blocking/);
    assert.doesNotMatch(inventory, /write-side RLS on Notification is low-value/);
  });

  it("starts B0 with paired source metadata and narrow cleanup only", () => {
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
    const stockRoute = fs.readFileSync("src/app/api/listings/[id]/stock/route.ts", "utf8");
    const listingReview = fs.readFileSync("src/app/api/admin/listings/[id]/review/route.ts", "utf8");
    const userReport = fs.readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");
    const adminEmail = fs.readFileSync("src/app/api/admin/email/route.ts", "utf8");
    const ban = fs.readFileSync("src/lib/ban.ts", "utf8");
    const fulfillment = fs.readFileSync("src/app/api/orders/[id]/fulfillment/route.ts", "utf8");
    const sellerRefund = fs.readFileSync("src/app/api/orders/[id]/refund/route.ts", "utf8");

    assert.match(sources, /BLOG_COMMENT: "blog_comment"/);
    assert.match(sources, /CASE: "case"/);
    assert.match(sources, /CASE_MESSAGE: "case_message"/);
    assert.match(sources, /CASE_RESOLUTION_MARK: "case_resolution_mark"/);
    assert.match(sources, /CASE_SYSTEM_ACTION: "case_system_action"/);
    assert.match(sources, /COMMISSION_INTEREST: "commission_interest"/);
    assert.match(sources, /COMMISSION_REQUEST: "commission_request"/);
    assert.match(sources, /CHECKOUT_LOW_STOCK: "checkout_low_stock"/);
    assert.match(sources, /MANUAL_LOW_STOCK: "manual_low_stock"/);
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
    assert.doesNotMatch(blog, /tx\.notification\./);
    assert.match(broadcasts, /deleteSellerBroadcastNotificationServiceRows\(tx, broadcast\.id\)/);
    assert.doesNotMatch(broadcasts, /tx\.notification\./);
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
    assert.match(stockRoute, /sourceType: NOTIFICATION_SOURCE_TYPES\.MANUAL_LOW_STOCK,\s*sourceId: lowStockAuthoritySourceId/);
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
      stockRoute,
      listingReview,
      userReport,
      adminEmail,
      ban,
      fulfillment,
      sellerRefund,
    ].reduce((count, source) => count + (source.match(/createNotification\(\{[\s\S]{0,700}?sourceType:/g) ?? []).length, 0);
    assert.equal(taggedCreationCount, 40);
  });

  it("uses exact related-user lifecycle metadata without broad text cleanup", () => {
    const files = sourceFiles("src");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    const migration = fs.readFileSync(
      "docs/rls-drafts/notification-related-user.sql",
      "utf8",
    );
    const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");
    const accountDeletion = fs.readFileSync("src/lib/accountDeletion.ts", "utf8");
    const preparationVerifier = fs.readFileSync(
      "scripts/verify-notification-preparation-release.mjs",
      "utf8",
    );

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
    assert.match(preparationVerifier, /20260722051500_prepare_notification_rls/);
    assert.match(preparationVerifier, /executable body drifted from disposable proof/);
    assert.match(preparationVerifier, /activation migration must remain absent/);

    const relatedUserAssignments = files.reduce((count, file) => {
      const source = fs.readFileSync(file, "utf8");
      if (file === "src/lib/notifications.ts" || !source.includes("createNotification({")) {
        return count;
      }
      return count + (source.match(/relatedUserId\s*:/g) ?? []).length;
    }, 0);
    assert.equal(relatedUserAssignments, 26);

    assert.match(accountDeletion, /deleteAccountNotificationServiceRows\(tx, user\.id\)/);
    assert.doesNotMatch(accountDeletion, /tx\.notification\.|FROM "Notification"/);
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
      "grainline_notification_create_verification_event",
      "grainline_notification_create_moderation_event",
      "grainline_notification_create_account_warning",
      "grainline_notification_create_order_event",
      "grainline_notification_claim_back_in_stock",
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
    assert.equal((sql.match(/^SECURITY DEFINER$/gm) ?? []).length, 17);
    assert.equal((sql.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 17);
    assert.equal((sql.match(/REVOKE ALL ON FUNCTION public\.grainline_notification_/g) ?? []).length, 17);
    assert.equal((sql.match(/FROM PUBLIC, grainline_app_runtime/g) ?? []).length, 17);
    assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION public\.grainline_notification_/g) ?? []).length, 16);
    assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_core\(/);
    assert.match(sql, /ORDER BY notification_user_lock\.id\s+FOR SHARE/);
    assert.match(sql, /recipient\.banned = false[\s\S]{0,100}recipient\."deletedAt" IS NULL;/);
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
    assert.match(sql, /p_related_user_id[\s\S]{0,1500}related_user\.banned = false[\s\S]{0,100}related_user\."deletedAt" IS NULL;/);
    assert.match(sql, /source_comment\."authorId" = p_related_user_id/);
    assert.match(sql, /parent_comment\."authorId" = p_user_id/);
    assert.equal((sql.match(/JOIN public\."Follow" AS source_follow/g) ?? []).length, 3);
    assert.equal((sql.match(/source_seller\."userId" = p_related_user_id/g) ?? []).length, 4);
    assert.match(sql, /account_user\.id = p_user_id FOR UPDATE/);
    assert.match(sql, /blog comment notification cleanup requires a deleted source/);
    assert.match(sql, /seller broadcast notification cleanup requires a deleted source/);
    assert.match(sql, /ON CONFLICT \("userId", "type", "dedupKey"\) DO NOTHING/);
    assert.match(sql, /replay_material := pg_catalog\.concat_ws\(/);
    assert.equal((sql.match(/pg_catalog\.md5\(/g) ?? []).length, 4);
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
    assert.match(serviceAccess, /public\.grainline_notification_create_verification_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_moderation_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_account_warning\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_order_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_claim_back_in_stock\(/);
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

  it("routes every recipient operation through the one-statement invoker candidate", () => {
    const ownerAccess = fs.readFileSync("src/lib/notificationOwnerAccess.ts", "utf8");
    const dashboardPage = fs.readFileSync("src/app/dashboard/notifications/page.tsx", "utf8");

    assert.equal((ownerAccess.match(/^export async function /gm) ?? []).length, 8);
    assert.equal((ownerAccess.match(/public\.grainline_notification_/g) ?? []).length, 8);
    assert.match(ownerAccess, /from "@\/lib\/db"/);
    assert.doesNotMatch(ownerAccess, /withDbUserContext/);
    assert.doesNotMatch(ownerAccess, /prisma\.notification\./);
    assert.doesNotMatch(ownerAccess, /Promise\.all/);
    assert.match(dashboardPage, /ownerNotificationPageData\(me\.id/);
    assert.doesNotMatch(dashboardPage, /ownerNotificationPageRows/);
  });
});
