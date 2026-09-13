import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  VALID_PREFERENCE_KEYS,
} = await import("../src/lib/notificationPreferenceKeys.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = [
  source("prisma/migrations/20260529070500_json_shape_and_size_guardrails/migration.sql"),
  source("prisma/migrations/20260531033000_prune_unsupported_email_preferences/migration.sql"),
  source("prisma/migrations/20260529173000_add_system_audit_log/migration.sql"),
].join("\n");
const preferencePruneMigration = source("prisma/migrations/20260531033000_prune_unsupported_email_preferences/migration.sql");
const schema = source("prisma/schema.prisma");

describe("json column guardrails", () => {
  it("keeps notification preference DB validation aligned with runtime keys", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION "grainline_notification_preferences_valid"/);
    assert.match(migration, /jsonb_typeof\(preferences\) <> 'object'/);
    assert.match(migration, /jsonb_typeof\(pref\.value\) <> 'boolean'/);
    assert.match(migration, /"User_notificationPreferences_shape_chk"/);
    assert.match(migration, /VALIDATE CONSTRAINT "User_notificationPreferences_shape_chk"/);
    assert.match(schema, /grainline_notification_preferences_valid\(\) enforces known/);

    for (const key of VALID_PREFERENCE_KEYS) {
      assert.match(migration, new RegExp(`'${key}'`), `${key} must be allowed by the DB validator`);
    }
  });

  it("normalizes historical malformed notification preference rows before validation", () => {
    assert.match(migration, /UPDATE "User"/);
    assert.match(migration, /jsonb_object_agg\(pref\.key, pref\.value\)/);
    assert.match(migration, /ELSE '\{\}'::jsonb/);
    assert.match(migration, /WHERE NOT "grainline_notification_preferences_valid"\("notificationPreferences"\)/);
  });

  it("prunes unsupported email preference keys before narrowing the DB validator", () => {
    assert.match(preferencePruneMigration, /CREATE OR REPLACE FUNCTION "grainline_notification_preferences_valid"/);
    assert.match(preferencePruneMigration, /pref\.key LIKE 'EMAIL_%'/);
    assert.match(preferencePruneMigration, /ELSE '\{\}'::jsonb/);
    assert.match(preferencePruneMigration, /DROP CONSTRAINT "User_notificationPreferences_shape_chk"/);
    assert.match(preferencePruneMigration, /ADD CONSTRAINT "User_notificationPreferences_shape_chk"/);
    assert.match(preferencePruneMigration, /VALIDATE CONSTRAINT "User_notificationPreferences_shape_chk"/);

    for (const key of VALID_PREFERENCE_KEYS) {
      assert.match(preferencePruneMigration, new RegExp(`'${key}'`), `${key} must stay allowed by the narrowed DB validator`);
    }

    for (const key of [
      "EMAIL_ORDER_SHIPPED",
      "EMAIL_ORDER_DELIVERED",
      "EMAIL_CUSTOM_ORDER_LINK",
      "EMAIL_LOW_STOCK",
      "EMAIL_NEW_FAVORITE",
      "EMAIL_NEW_BLOG_COMMENT",
      "EMAIL_BLOG_COMMENT_REPLY",
      "EMAIL_NEW_FOLLOWER",
      "EMAIL_FOLLOWED_MAKER_NEW_BLOG",
      "EMAIL_COMMISSION_INTEREST",
      "EMAIL_LISTING_APPROVED",
      "EMAIL_LISTING_REJECTED",
      "EMAIL_ACCOUNT_WARNING",
      "EMAIL_LISTING_FLAGGED_BY_USER",
      "EMAIL_PAYMENT_DISPUTE",
      "EMAIL_PAYOUT_FAILED",
    ]) {
      assert.doesNotMatch(preferencePruneMigration, new RegExp(`'${key}'`), `${key} should be pruned from the narrowed validator`);
    }
  });

  it("adds raw-managed write-size caps for bulky json columns", () => {
    for (const [constraint, bytes] of [
      ["User_notificationPreferences_size_chk", 8192],
      ["AdminAuditLog_metadata_size_chk", 1000000],
      ["SystemAuditLog_metadata_size_chk", 64000],
      ["OrderItem_listingSnapshot_size_chk", 128000],
      ["OrderItem_selectedVariants_size_chk", 16000],
      ["OrderShippingRateQuote_rates_size_chk", 64000],
      ["OrderPaymentEvent_metadata_size_chk", 64000],
      ["EmailSuppression_details_size_chk", 16000],
      ["CronRun_result_size_chk", 64000],
    ]) {
      assert.match(migration, new RegExp(`"${constraint}"`), `${constraint} should exist`);
      assert.match(migration, new RegExp(`<= ${bytes}`), `${constraint} should enforce ${bytes} bytes`);
    }
  });

  it("documents schema-level json payload contracts near raw-managed fields", () => {
    for (const phrase of [
      "array of trimmed rate objects",
      "Stripe payment/refund/dispute event context",
      "checkout-time listing snapshot",
      "hashed/safe webhook context",
      "cron summary payload",
      "Bounded action metadata",
      "Bounded system/cron/webhook action metadata",
    ]) {
      assert.match(schema, new RegExp(phrase));
    }
  });
});
