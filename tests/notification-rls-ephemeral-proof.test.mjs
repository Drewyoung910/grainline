import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const ORDER_RELEASE_SUCCESSORS = Object.freeze([
  [
    "20260926010000_correct_order_provider_terminal_reconciliation",
    "6e835d8da110ee53384d1afd898fe0e02a8c9679f48be24a43557173b3651987",
  ],
  [
    "20260926011000_correct_order_paid_checkout_bound_reservation",
    "757d579c6ac61a9a3d5b434eb9421c1da2dad24d8051c08b61ce2e2850bb4b36",
  ],
  [
    "20260926012000_correct_order_seller_deauthorization_fulfillment",
    "de3db869562e4cdbe411efb1652f0cefb2f2a9687a079e15e84b70aaeb740263",
  ],
  [
    "20260926012100_correct_order_seller_deauthorization_label",
    "75b2c6d00f9f7996c6140a57adbcc91f207cf96e2c495478fb21a9a633f0b29f",
  ],
  [
    "20260926012200_correct_order_seller_deauthorization_projection",
    "4b8ed62faa14d9fa32c57c0045847357d04c16889f9a1d2e3b83633a1c482578",
  ],
  [
    "20260926012300_retire_legacy_checkout_reservation_creators",
    "f66b5314f6116a2900b06c98e0a5cb0236684ab8c0c712e5d6059a758571ae61",
  ],
  [
    "20260928010000_correct_order_deauthorized_case_access",
    "a92fbcbc6c809e51a14cf53c7b98958693c327040565a64929c4527ff56b112f",
  ],
  [
    "20260928020000_correct_order_label_sender_contact",
    "33a6d19fd0e50345bab11fa4c1a5a686aa72768d96db2a4cb9bce80ec7cd521b",
  ],
  [
    "20260928213000_remove_seller_buyer_email_projection",
    "b9b0540de736daa01e8ac15f4fa41af3dd5ae8ffe4d5153aa2487a972b7b6c66",
  ],
  [
    "20260928220000_retire_seller_buyer_email_projection_predecessors",
    "3a1f173fac0293ec05c43b44e9cd2a6895dcdd47effce55236e7e7c7a55fb799",
  ],
  [
    "20260929130000_revoke_order_item_shipping_quote_runtime_access",
    "32c085b262400201864e6bfb7d32829b886b99a48771f62da141352c1c8bab99",
  ],
  [
    "20260929160000_force_order_rls",
    "1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139",
  ],
  [
    "20260930030000_bound_listing_fulfillment_days",
    "ceef219897013aa84bec0155f23e0ce01d8c48472d6e8bcb166e713d1e4edd96",
  ],
  [
    "20260930031000_mark_paid_private_listing_sold",
    "0a1cb4828cce4d05abf783b12d790c13581fb7698f8063aaeaf92b5fa8c6bee1",
  ],
  [
    "20260930032000_block_checkout_user_pairs",
    "dc1cdbf14a5b126635af44fbbc4ca820ac16e46823a68071400fd5786110209d",
  ],
  [
    "20260930033000_order_ops_health_summary",
    "ed5e069248281ef8738f97bd0480ee77b85044a4ad2c9ac433ef2840a2a7e941",
  ],
]);

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

  it("seeds the payout source with the promoted provider-event invariant", () => {
    const payoutInsert = proof.match(
      /INSERT INTO public\."SellerPayoutEvent" \([\s\S]*?\[fixture\.payoutEventId, fixture\.sellerProfileId\]/,
    );
    assert.ok(payoutInsert, "the Notification proof must retain its payout source fixture");
    assert.match(payoutInsert[0], /"stripeEventCreatedSeconds"/);
    assert.match(
      payoutInsert[0],
      /'evt_notification_proof_payout', 1700000000, pg_catalog\.clock_timestamp\(\)/,
      "the payout source fixture must satisfy the post-activation NOT NULL provider time",
    );
  });

  it("seeds the payment-dispute source with canonical signed identity", () => {
    assert.match(
      proof,
      /orderDisputeStripeEventId: "evt_[A-Za-z0-9]+"/,
      "the Notification proof must use the canonical signed-event id shape",
    );
    assert.match(proof, /orderDisputeStripeObjectId: "du_[A-Za-z0-9]+"/);
    assert.match(proof, /orderDisputeStripeChargeId: "ch_[A-Za-z0-9]+"/);
    const paymentInsert = proof.match(
      /INSERT INTO public\."OrderPaymentEvent" \([\s\S]*?fixture\.orderDisputeStripeEventCreatedSeconds,\s*\],/,
    );
    assert.ok(paymentInsert, "the Notification proof must retain its payment-dispute fixture");
    for (const required of [
      '"stripeEventId"',
      '"stripeObjectId"',
      '"stripeObjectType"',
      '"stripeEventCreatedSeconds"',
      "'chargeId'",
      "'disputeId'",
      "'stripeEventType'",
      "'stripeEventCreated'",
      "$4::text",
    ]) {
      assert.ok(
        paymentInsert[0].includes(required),
        `the payment-dispute fixture must include ${required}`,
      );
    }
    assert.doesNotMatch(
      paymentInsert[0],
      /"updatedAt"|clock_timestamp\(\)/,
      "createdAt and updatedAt must use their shared CURRENT_TIMESTAMP defaults",
    );
    assert.match(
      proof,
      /sourceId: fixture\.orderDisputeStripeEventId/,
      "the notification source must use the same canonical event id as the payment fixture",
    );
  });

  it("models refund notifications as distinct immutable local ledger events", () => {
    assert.doesNotMatch(proof, /UPDATE public\."OrderPaymentEvent"/);
    assert.doesNotMatch(proof, /DELETE FROM public\."OrderPaymentEvent"/);
    assert.match(proof, /TRUNCATE TABLE public\."OrderPaymentEvent" CASCADE/);
    assert.match(
      proof,
      /async function cleanFixturesInTransaction\(owner\) \{[\s\S]*?TRUNCATE TABLE public\."OrderPaymentEvent" CASCADE[\s\S]*?const userIds =/,
      "immutable ledger cleanup must precede row deletes that queue deferred triggers",
    );
    assert.match(proof, /async function insertLocalOrderPaymentEvent\(/);
    assert.match(proof, /'refundIds', pg_catalog\.jsonb_build_array\(\$4::text\)/);
    for (const source of [
      "orderSellerRefundStripeEventId",
      "orderBlockedRefundPredecessorStripeEventId",
      "orderBlockedRefundCorrectedStripeEventId",
    ]) {
      assert.match(
        proof,
        new RegExp(`${source}:\\n?\\s*"local:[a-z_]+:re_[A-Za-z0-9]+"`),
        `${source} must use canonical local refund identity`,
      );
      assert.match(
        proof,
        new RegExp(`sourceId: fixture\\.${source}`),
        `${source} must bind its Notification source to the immutable row`,
      );
    }
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
      "order_payment_blocked_checkout_refund_predecessor",
      "order_payment_blocked_checkout_refund_corrected",
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
      /label: "order_payment_blocked_checkout_refund_predecessor"[\s\S]*?type: "NEW_ORDER"[\s\S]*?replayType: "REFUND_ISSUED"[\s\S]*?expectedStoredType: "REFUND_ISSUED"/,
    );
    assert.match(
      proof,
      /label: "order_payment_blocked_checkout_refund_corrected"[\s\S]*?type: "REFUND_ISSUED"[\s\S]*?replayType: "NEW_ORDER"[\s\S]*?expectedStoredType: "REFUND_ISSUED"/,
    );
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
    assert.match(
      proof,
      /checkoutReservationPayloadHash: "[A-Za-z0-9_-]{32}"/,
      "the cross-surface checkout fixture must use the canonical 32-character base64url replay identity",
    );
    assert.match(
      proof,
      /\$2::text, \$3::text, \$4::text, 'cs_notification_proof'/,
      "reused fixture parameters must have one explicit PostgreSQL type",
    );
    assert.match(
      proof,
      /pg_catalog\.jsonb_build_object\(\s*'listingId', \$5::text,\s*'sellerId', \$4::text,\s*'quantity', 1\s*\)/,
      "the cross-surface checkout fixture must retain canonical listing, seller and quantity authority",
    );
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /if \(family\.setup\)/);
    assert.match(proof, /if \(family\.resetSourceNotification\)/);
    assert.match(proof, /family\.expectedBodyIncludes/);
    assert.match(proof, /SET "actorId" = \$2::text/);
    assert.match(proof, /recipient RPC p_user_id must come from server-resolved identity/);
    assert.match(proof, /async function cleanFixturesInTransaction\(owner\)/);
    assert.match(
      proof,
      /async function cleanFixtures\(owner\) \{[\s\S]*await owner\.query\("BEGIN"\);[\s\S]*await cleanFixturesInTransaction\(owner\);[\s\S]*await owner\.query\("COMMIT"\);[\s\S]*await owner\.query\("ROLLBACK"\)/,
      "fixture cleanup must delete each Order and its OrderItems in one transaction so deferred seller-key constraints see a complete final state",
    );
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
    assert.match(
      workflow,
      /scripts\/build-blocked-checkout-refund-delivery-migration\.mjs/,
    );
    assert.match(workflow, /scripts\/stage-notification-rls-candidate-migration\.mjs/);
    assert.match(workflow, /scripts\/audit-runtime-db-grants\.mjs/);
    assert.match(workflow, /image: postgres:16/);
    assert.match(
      workflow,
      /Verify blocked-checkout refund delivery compatibility release[\s\S]*audit:order-payment-blocked-checkout-refund-delivery-release/,
    );
    assert.match(workflow, /Verify committed Notification activation release artifact/);
    assert.match(workflow, /audit:rls-notification-activation-release/);
    assert.match(workflow, /Verify committed Notification FORCE release artifact/);
    assert.match(workflow, /audit:rls-notification-force-release/);
    assert.doesNotMatch(workflow, /Stage byte-pinned Notification activation migration/);
    const successorFence = workflow.indexOf(
      "Isolate reviewed Order release successors from historical proof",
    );
    const coreFence = workflow.indexOf(
      "Isolate staged Core Order ENABLE from historical proof",
    );
    const compatibleApply = workflow.indexOf(
      "Apply compatible migrations including committed Notification FORCE",
    );
    const currentApply = workflow.indexOf(
      "Apply current migrations including DirectUpload activation",
    );
    const notificationProof = workflow.indexOf(
      "Prove Notification RLS and service authority",
    );
    const successorRestore = workflow.indexOf(
      "Restore reviewed Order release successors",
    );
    const coreRestore = workflow.indexOf("Restore staged Core Order ENABLE");
    assert.ok(successorFence >= 0);
    for (const [digest, migration] of [
      [
        "a648437f13d93e1673f64935d381630e6ec2b19e7633c33837e88938240ef5c7",
        "20261002030000_preserve_order_shipping_dispute_evidence",
      ],
      [
        "3f2e6061e1de1a6f6c92645979a686ec4d3ee36409dc4499c2c62c90dafe1cf8",
        "20261002160000_add_user_email_suppression_key_index",
      ],
      [
        "a4b247ce83e871f657ee8228873c3113bdc5cf58adb7292a2e90206c147f67a8",
        "20261002161000_add_user_email_address_suppression_key_index",
      ],
      [
        "02ccc97c9e4d1e48320b58bd7ccc23aa023b7330d0add6fcf76802cc266f567c",
        "20261002162000_add_user_email_address_current_unique_index",
      ],
      [
        "4b058ca847eac24428f8bd4733ed81fed26c6aa138437740e18c58da80bb2933",
        "20261002170000_prepare_user_email_address_authority",
      ],
      [
        "b64751439f75fce70850ab43446c35ce6df45301b2a03970b560306898df1f2e",
        "20261003010000_repair_user_email_address_current_history",
      ],
      [
        "d61df27c1c565d6fffde2fea130eb27b2ef95e842dbffef5e6b2862cd57bcbee",
        "20261003020000_enable_user_email_address_rls",
      ],
    ]) {
      assert.match(workflow, new RegExp(`${digest} ${migration}`));
      assert.ok(workflow.indexOf(`${digest} ${migration}`) > successorFence);
      assert.ok(workflow.indexOf(`${digest} ${migration}`) < compatibleApply);
      assert.ok(workflow.lastIndexOf(migration) > successorRestore);
    }
    assert.ok(successorFence < compatibleApply);
    assert.ok(successorFence < currentApply);
    assert.ok(coreFence > successorFence && coreFence < compatibleApply);
    assert.ok(notificationProof < successorRestore);
    assert.ok(notificationProof < coreRestore);
    const fenceBlock = workflow.slice(successorFence, compatibleApply);
    const restoreBlock = workflow.slice(
      successorRestore,
      workflow.indexOf(
        "Restore reviewed Production-owner Order buyer correction",
        successorRestore,
      ),
    );
    for (const migration of [
      "20261002030000_preserve_order_shipping_dispute_evidence",
      "20261002160000_add_user_email_suppression_key_index",
      "20261002161000_add_user_email_address_suppression_key_index",
      "20261002162000_add_user_email_address_current_unique_index",
      "20261002170000_prepare_user_email_address_authority",
      "20261003010000_repair_user_email_address_current_history",
      "20261003020000_enable_user_email_address_rls",
    ]) {
      assert.match(restoreBlock, new RegExp(migration, "u"));
    }
    for (const [migration, digest] of ORDER_RELEASE_SUCCESSORS) {
      assert.match(fenceBlock, new RegExp(`${digest} ${migration}`, "u"));
      assert.match(restoreBlock, new RegExp(migration, "u"));
    }
    const coreFenceBlock = workflow.slice(coreFence, compatibleApply);
    assert.match(coreFenceBlock, /20260927090000_enable_order_rls/u);
    assert.match(
      coreFenceBlock,
      /350567d0141601fd858dcc2df99f59b085d1f66573560b027148e66278a1eec8/u,
    );
    assert.ok(coreRestore > successorRestore);
    assert.match(
      workflow,
      /Isolate DirectUpload activation until external grants converge[\s\S]*Apply compatible migrations including committed Notification FORCE[\s\S]*Converge pre-activation production-style runtime grants[\s\S]*Converge pre-activation DirectUpload cleanup-worker grants[\s\S]*Restore exact DirectUpload activation[\s\S]*Apply current migrations including DirectUpload activation[\s\S]*Reconverge activated production-style runtime grants[\s\S]*Reconverge activated DirectUpload cleanup-worker grants/,
    );
    const activationApply = workflow.indexOf(
      "Apply current migrations including DirectUpload activation",
    );
    const grantAudit = workflow.indexOf("Audit production-style runtime grants");
    assert.ok(
      workflow.indexOf("Verify committed Notification activation release artifact")
        < activationApply,
    );
    assert.ok(activationApply < grantAudit);
    assert.match(workflow, /scripts\/provision-direct-upload-cleanup-role\.sql/);
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
    assert.equal(
      packageJson.scripts[
        "audit:order-payment-blocked-checkout-refund-delivery-release"
      ],
      "node scripts/build-blocked-checkout-refund-delivery-migration.mjs --verify",
    );
  });
});
