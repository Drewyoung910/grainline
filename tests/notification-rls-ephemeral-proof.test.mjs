import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("Notification RLS ephemeral PostgreSQL proof", () => {
  const proof = fs.readFileSync("scripts/notification-rls-ephemeral-proof.mjs", "utf8");
  const workflow = fs.readFileSync(".github/workflows/notification-rls-ephemeral-proof.yml", "utf8");
  const recipientSql = fs.readFileSync("docs/rls-drafts/notification-recipient-access.sql", "utf8");
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  it("is hard-limited to the loopback grainline_ci database", () => {
    assert.match(proof, /ephemeral proof refuses a non-loopback database/);
    assert.match(proof, /parsed\.pathname, "\/grainline_ci"/);
    assert.match(proof, /current_user: "ci"/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
  });

  it("proves catalog, grants, direct denial, every service family, and both lock orderings", () => {
    assert.match(proof, /relrowsecurity: true/);
    assert.match(proof, /relforcerowsecurity: true/);
    assert.match(proof, /can_insert: false/);
    assert.match(proof, /can_delete: false/);
    assert.match(proof, /can_update_read: true/);
    assert.match(proof, /private notification core/);
    for (const family of [
      "source_fanout",
      "followed_maker_new_blog",
      "blog_comment_top_level",
      "blog_comment_reply",
      "seller_broadcast",
      "social",
      "favorite",
      "review",
      "message",
      "custom_order_request",
      "custom_order_link",
      "case",
      "case_message",
      "case_resolution_mark",
      "case_system_action",
      "commission",
      "commission_request_closed",
      "inventory",
      "checkout_low_stock",
      "verification",
      "guild_system_action",
      "listing_admin_review",
      "moderation",
      "account_warning",
      "banned_seller_order",
      "order",
      "order_checkout",
      "order_fulfillment",
      "order_payment",
    ]) {
      assert.match(proof, new RegExp(`label: "${family}"`));
    }
    for (const variant of [
      "case_resolved_dismissed",
      "case_refund_full",
      "case_refund_partial",
      "case_message_seller_to_buyer",
      "case_message_staff_to_buyer",
      "case_message_staff_to_seller",
      "case_resolution_mark_resolved_seller_to_buyer",
      "case_system_open_seller",
      "case_system_discussion_buyer",
      "case_system_discussion_seller",
      "case_system_close_buyer",
      "case_system_close_seller",
      "commission_request_fulfilled_seller",
      "commission_request_expired_seller",
      "commission_request_expired_buyer",
      "order_checkout_seller",
      "order_fulfillment_picked_up",
      "order_fulfillment_ready_for_pickup",
      "order_payment_seller_refund",
      "order_payment_blocked_checkout_refund",
      "listing_admin_review_sold_out",
      "listing_admin_review_rejected",
      "guild_admin_reject_member",
      "guild_admin_revoke_member",
      "guild_admin_approve_master",
      "guild_admin_reject_master",
      "guild_admin_revoke_master",
      "guild_admin_reinstate_member",
      "guild_system_auto_revoke_member",
      "guild_system_auto_revoke_master",
    ]) {
      assert.match(proof, new RegExp(`label: "${variant}"`));
    }
    assert.match(
      proof,
      /service_family_\$\{family\.label\}_valid_replay_and_forged_recipient_rejected/,
    );
    assert.match(
      proof,
      /service_back_in_stock_claim_derives_identity_consumes_once_and_rejects_bad_evidence/,
    );
    assert.deepEqual(
      [...new Set([...proof.matchAll(/sourceType: "([a-z_]+)"/g)].map((match) => match[1]))].sort(),
      [
        "admin_account_message",
        "banned_seller_order",
        "blog_comment",
        "case",
        "case_message",
        "case_resolution_mark",
        "case_system_action",
        "checkout_low_stock",
        "commission_interest",
        "commission_request",
        "favorite",
        "follow",
        "followed_maker_new_blog",
        "followed_maker_new_listing",
        "guild_admin_action",
        "guild_system_action",
        "listing_admin_review",
        "listing_user_report",
        "manual_low_stock",
        "manual_restock",
        "message",
        "order_checkout",
        "order_fulfillment",
        "order_payment",
        "review",
        "seller_broadcast",
        "stripe_payout_failure",
      ],
    );
    assert.deepEqual(
      [...new Set(
        [...proof.matchAll(/type: "([A-Z_]+)",\n\s+sourceType: "([a-z_]+)"/g)]
          .map((match) => `${match[2]}:${match[1]}`),
      )].sort(),
      [
        "admin_account_message:ACCOUNT_WARNING",
        "banned_seller_order:ACCOUNT_WARNING",
        "blog_comment:BLOG_COMMENT_REPLY",
        "blog_comment:NEW_BLOG_COMMENT",
        "case:CASE_OPENED",
        "case:CASE_RESOLVED",
        "case:REFUND_ISSUED",
        "case_message:CASE_MESSAGE",
        "case_resolution_mark:CASE_MESSAGE",
        "case_resolution_mark:CASE_RESOLVED",
        "case_system_action:CASE_MESSAGE",
        "case_system_action:CASE_RESOLVED",
        "checkout_low_stock:LOW_STOCK",
        "commission_interest:COMMISSION_INTEREST",
        "commission_request:COMMISSION_INTEREST",
        "favorite:NEW_FAVORITE",
        "follow:NEW_FOLLOWER",
        "followed_maker_new_blog:FOLLOWED_MAKER_NEW_BLOG",
        "followed_maker_new_listing:FOLLOWED_MAKER_NEW_LISTING",
        "guild_admin_action:VERIFICATION_APPROVED",
        "guild_admin_action:VERIFICATION_REJECTED",
        "guild_system_action:VERIFICATION_REJECTED",
        "listing_admin_review:LISTING_APPROVED",
        "listing_admin_review:LISTING_REJECTED",
        "listing_user_report:LISTING_FLAGGED_BY_USER",
        "manual_low_stock:LOW_STOCK",
        "message:CUSTOM_ORDER_LINK",
        "message:CUSTOM_ORDER_REQUEST",
        "message:NEW_MESSAGE",
        "order_checkout:NEW_ORDER",
        "order_fulfillment:ORDER_DELIVERED",
        "order_fulfillment:ORDER_SHIPPED",
        "order_payment:NEW_ORDER",
        "order_payment:PAYMENT_DISPUTE",
        "order_payment:REFUND_ISSUED",
        "review:NEW_REVIEW",
        "seller_broadcast:SELLER_BROADCAST",
        "stripe_payout_failure:PAYOUT_FAILED",
      ],
    );
    assert.match(proof, /notification-proof-block-second/);
    assert.match(proof, /notification-proof-create-second/);
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /if \(family\.setup\)/);
    assert.match(proof, /if \(family\.resetSourceNotification\)/);
    assert.match(proof, /family\.expectedBodyIncludes/);
    assert.match(proof, /SET "actorId" = \$2::text/);
    assert.match(proof, /recipient RPC p_user_id must come from server-resolved identity/);
    assert.ok(
      (recipientSql.match(/notification\.title::text/g) ?? []).length >= 3,
      "text-returning recipient RPCs must cast varchar title columns",
    );
    assert.ok(
      (recipientSql.match(/notification\.body::text/g) ?? []).length >= 3,
      "text-returning recipient RPCs must cast varchar body columns",
    );
    assert.ok(
      (recipientSql.match(/notification\.link::text/g) ?? []).length >= 3,
      "text-returning recipient RPCs must cast varchar link columns",
    );
  });

  it("proves the exact FORCE release on its isolated branch, main, or explicit dispatch", () => {
    assert.match(workflow, /codex\/rls-notification-force-20260722/);
    assert.match(workflow, /^\s+- main$/m);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /paths:[\s\S]*docs\/rls-drafts\/\*\*/);
    assert.match(workflow, /scripts\/notification-rls-ephemeral-proof\.mjs/);
    assert.match(workflow, /scripts\/stage-notification-rls-candidate-migration\.mjs/);
    assert.match(workflow, /scripts\/audit-runtime-db-grants\.mjs/);
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /Verify committed Notification activation release artifact/);
    assert.match(workflow, /audit:rls-notification-activation-release/);
    assert.match(workflow, /Verify committed Notification FORCE release artifact/);
    assert.match(workflow, /audit:rls-notification-force-release/);
    assert.doesNotMatch(workflow, /Stage byte-pinned Notification activation migration/);
    assert.match(workflow, /Converge activated production-style runtime grants/);
    const activationApply = workflow.indexOf(
      "Apply current migrations including committed Notification FORCE",
    );
    const grantAudit = workflow.indexOf("Audit production-style runtime grants");
    assert.ok(
      workflow.indexOf("Verify committed Notification activation release artifact")
        < activationApply,
    );
    assert.ok(activationApply < grantAudit);
    assert.doesNotMatch(workflow, /Apply isolated Notification .* draft/);
    assert.equal(
      packageJson.scripts["audit:rls-notification-ephemeral"],
      "node scripts/notification-rls-ephemeral-proof.mjs",
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-candidate"],
      "node scripts/stage-notification-rls-candidate-migration.mjs --verify",
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-preparation-release"],
      "node scripts/verify-notification-preparation-release.mjs",
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-preparation"],
      "node scripts/notification-rls-preparation-proof.mjs",
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-activation-release"],
      "node scripts/verify-notification-activation-release.mjs",
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-force-release"],
      "node scripts/verify-notification-force-release.mjs",
    );
  });
});
