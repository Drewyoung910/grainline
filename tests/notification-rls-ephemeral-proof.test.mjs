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
    assert.match(proof, /relforcerowsecurity: false/);
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
    assert.match(proof, /notification-proof-block-second/);
    assert.match(proof, /notification-proof-create-second/);
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /if \(family\.setup\)/);
    assert.match(proof, /if \(family\.resetSourceNotification\)/);
    assert.match(proof, /family\.expectedBodyIncludes/);
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

  it("runs only on the isolated branch or explicit dispatch against PostgreSQL 16", () => {
    assert.match(workflow, /codex\/rls-bucket-b-notification-20260719/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /paths:[\s\S]*docs\/rls-drafts\/\*\*/);
    assert.match(workflow, /scripts\/notification-rls-ephemeral-proof\.mjs/);
    assert.match(workflow, /scripts\/audit-runtime-db-grants\.mjs/);
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /notification-related-user\.sql[\s\S]*notification-recipient-access\.sql[\s\S]*notification-service-authority\.sql/);
    assert.match(workflow, /Re-converge Notification-aware runtime grants/);
    assert.ok(
      workflow.indexOf("Apply isolated Notification service-authority draft")
        < workflow.indexOf("Re-converge Notification-aware runtime grants"),
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-ephemeral"],
      "node scripts/notification-rls-ephemeral-proof.mjs",
    );
  });
});
