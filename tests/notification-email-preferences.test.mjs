import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { emailPreferenceDefaultEnabled, isEmailNotificationEnabled } = await import("../src/lib/notificationEmailPreferences.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("notification email preferences", () => {
  it("keeps high-volume marketing-style email preferences default-off", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_SELLER_BROADCAST"), false);
  });

  it("keeps transactional email preferences default-on for transient preference lookup failures", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_NEW_ORDER"), true);
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_CASE_MESSAGE"), true);
  });

  it("fails closed for unsupported email preference keys", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_NEW_FOLLOWER"), false);
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_FOLLOWER: true }, "EMAIL_NEW_FOLLOWER"), false);
    assert.equal(isEmailNotificationEnabled({ EMAIL_ORDER_SHIPPED: true }, "EMAIL_ORDER_SHIPPED"), false);
  });

  it("disables default-on emails only for explicit boolean false", () => {
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_ORDER: false }, "EMAIL_NEW_ORDER"), false);
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_ORDER: true }, "EMAIL_NEW_ORDER"), true);
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_ORDER: "false" }, "EMAIL_NEW_ORDER"), true);
    assert.equal(isEmailNotificationEnabled(["EMAIL_NEW_ORDER"], "EMAIL_NEW_ORDER"), true);
  });

  it("enables default-off emails only for explicit boolean true", () => {
    assert.equal(isEmailNotificationEnabled({ EMAIL_SELLER_BROADCAST: true }, "EMAIL_SELLER_BROADCAST"), true);
    assert.equal(isEmailNotificationEnabled({ EMAIL_SELLER_BROADCAST: false }, "EMAIL_SELLER_BROADCAST"), false);
    assert.equal(isEmailNotificationEnabled({ EMAIL_SELLER_BROADCAST: "true" }, "EMAIL_SELLER_BROADCAST"), false);
    assert.equal(isEmailNotificationEnabled({}, "EMAIL_SELLER_BROADCAST"), false);
  });

  it("shows seller email toggles only for currently gated seller email senders", () => {
    const sellerSettings = source("src/app/dashboard/seller/page.tsx");

    for (const key of [
      "EMAIL_REFUND_ISSUED",
      "EMAIL_PAYMENT_DISPUTE",
      "EMAIL_NEW_FOLLOWER",
      "EMAIL_LISTING_APPROVED",
      "EMAIL_LISTING_REJECTED",
      "EMAIL_LOW_STOCK",
      "EMAIL_ACCOUNT_WARNING",
      "EMAIL_LISTING_FLAGGED_BY_USER",
      "EMAIL_PAYOUT_FAILED",
    ]) {
      assert.doesNotMatch(sellerSettings, new RegExp(`type: "${key}"`));
    }

    for (const key of [
      "EMAIL_NEW_ORDER",
      "EMAIL_CUSTOM_ORDER",
      "EMAIL_CASE_OPENED",
      "EMAIL_NEW_REVIEW",
      "EMAIL_VERIFICATION_APPROVED",
      "EMAIL_VERIFICATION_REJECTED",
    ]) {
      assert.match(sellerSettings, new RegExp(`type: "${key}"`));
    }
  });

  it("honors verification email preferences before admin verification emails", () => {
    const adminVerification = source("src/app/admin/verification/page.tsx");
    const firstApprovalPref = adminVerification.indexOf('shouldSendEmail(verification.sellerProfile.userId, "EMAIL_VERIFICATION_APPROVED")');
    const firstApprovalSend = adminVerification.indexOf("await sendVerificationApproved");
    const firstRejectionPref = adminVerification.indexOf('shouldSendEmail(verification.sellerProfile.userId, "EMAIL_VERIFICATION_REJECTED")');
    const firstRejectionSend = adminVerification.indexOf("await sendVerificationRejected");
    const revokePref = adminVerification.indexOf('shouldSendEmail(seller.userId, "EMAIL_VERIFICATION_REJECTED")');
    const revokeMemberSend = adminVerification.indexOf("await sendGuildMemberRevokedEmail");
    const secondApprovalPref = adminVerification.indexOf('shouldSendEmail(verification.sellerProfile.userId, "EMAIL_VERIFICATION_APPROVED")', firstApprovalPref + 1);
    const secondRevokePref = adminVerification.indexOf('shouldSendEmail(seller.userId, "EMAIL_VERIFICATION_REJECTED")', revokePref + 1);
    const revokeMasterSend = adminVerification.indexOf("await sendGuildMasterRevokedEmail");

    assert.ok(firstApprovalPref >= 0 && firstApprovalPref < firstApprovalSend);
    assert.ok(firstRejectionPref >= 0 && firstRejectionPref < firstRejectionSend);
    assert.ok(revokePref >= 0 && revokePref < revokeMemberSend);
    assert.ok(secondApprovalPref >= 0 && secondApprovalPref < adminVerification.lastIndexOf("await sendVerificationApproved"));
    assert.ok(secondRevokePref >= 0 && secondRevokePref < revokeMasterSend);
  });

  it("honors verification email preferences before cron Guild warning and revocation emails", () => {
    const guildMemberCheck = source("src/app/api/cron/guild-member-check/route.ts");
    const guildMetrics = source("src/app/api/cron/guild-metrics/route.ts");
    const memberPref = guildMemberCheck.indexOf('shouldSendEmail(seller.userId, "EMAIL_VERIFICATION_REJECTED")');
    const memberSend = guildMemberCheck.indexOf("await sendGuildMemberRevokedEmail");
    const warningPref = guildMetrics.indexOf('shouldSendEmail(seller.userId, "EMAIL_VERIFICATION_REJECTED")');
    const warningSend = guildMetrics.indexOf("await sendGuildMasterWarningEmail");
    const revokePref = guildMetrics.indexOf('shouldSendEmail(seller.userId, "EMAIL_VERIFICATION_REJECTED")', warningPref + 1);
    const revokeSend = guildMetrics.indexOf("await sendGuildMasterRevokedEmail");

    assert.ok(memberPref >= 0 && memberPref < memberSend);
    assert.ok(warningPref >= 0 && warningPref < warningSend);
    assert.ok(revokePref >= 0 && revokePref < revokeSend);
  });
});
