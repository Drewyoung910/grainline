import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("schema retention guardrails", () => {
  it("keeps retention-sensitive foreign keys from cascading hard deletes", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260523235500_retention_fk_and_schema_drift/migration.sql",
    );

    for (const [model, relation, field] of [
      ["Photo", "listing", "listingId"],
      ["Review", "listing", "listingId"],
      ["OrderPaymentEvent", "order", "orderId"],
      ["SellerPayoutEvent", "sellerProfile", "sellerProfileId"],
      ["BlogComment", "post", "postId"],
      ["BlogComment", "author", "authorId"],
      ["CommissionRequest", "buyer", "buyerId"],
      ["Block", "blocker", "blockerId"],
      ["Block", "blocked", "blockedId"],
      ["UserReport", "reporter", "reporterId"],
      ["UserReport", "reported", "reportedId"],
    ]) {
      assert.match(
        schema,
        new RegExp(
          `${relation}\\s+\\w+\\s+@relation\\([^\\n]*fields: \\[${field}\\][^\\n]*onDelete: Restrict`,
        ),
        `${model}.${relation} should restrict parent hard deletes`,
      );
      assert.match(
        migration,
        new RegExp(
          `ADD CONSTRAINT "${model}_${field}_fkey"[\\s\\S]*?ON DELETE RESTRICT ON UPDATE CASCADE`,
        ),
        `${model}.${field} migration should install ON DELETE RESTRICT`,
      );
    }
  });

  it("preserves conversation links without blocking retained thread deletion", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260523235500_retention_fk_and_schema_drift/migration.sql",
    );

    assert.match(
      schema,
      /contextListing\s+Listing\?\s+@relation\("ConversationContextListing", fields: \[contextListingId\], references: \[id\], onDelete: SetNull\)/,
    );
    assert.match(
      schema,
      /conversation\s+Conversation\?\s+@relation\("CommissionInterestConversation", fields: \[conversationId\], references: \[id\], onDelete: SetNull\)/,
    );
    assert.match(schema, /@@index\(\[conversationId\]\)/);
    assert.match(migration, /UPDATE "CommissionInterest"[\s\S]*SET "conversationId" = NULL/);
    assert.match(
      migration,
      /ADD CONSTRAINT "CommissionInterest_conversationId_fkey"[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/,
    );
  });

  it("keeps Stripe order ids raw-managed as partial unique indexes", () => {
    const schema = source("prisma/schema.prisma");
    const paymentIntentMigration = source(
      "prisma/migrations/20260424_add_performance_indexes_v2/migration.sql",
    );
    const chargeMigration = source(
      "prisma/migrations/20260424194500_webhook_idempotency_retention_constraints/migration.sql",
    );
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    const paymentIntentLine = schema.match(/stripePaymentIntentId\s+String\?[^\n]*/)?.[0] ?? "";
    const chargeLine = schema.match(/stripeChargeId\s+String\?[^\n]*/)?.[0] ?? "";

    assert.doesNotMatch(paymentIntentLine, /@unique/);
    assert.doesNotMatch(chargeLine, /@unique/);
    assert.match(paymentIntentMigration, /"Order_stripePaymentIntentId_idx"[\s\S]*WHERE "stripePaymentIntentId" IS NOT NULL/);
    assert.match(chargeMigration, /"Order_stripeChargeId_idx"[\s\S]*WHERE "stripeChargeId" IS NOT NULL/);
    assert.match(webhook, /order\.findFirst\(\{\s*where: \{ stripeChargeId: charge\.id \}/);
    assert.match(webhook, /order\.findFirst\(\{\s*where: \{ stripeChargeId: chargeId \}/);
  });

  it("archives dashboard blog posts instead of hard-deleting comment trees", () => {
    const dashboardBlog = source("src/app/dashboard/blog/page.tsx");

    assert.doesNotMatch(dashboardBlog, /blogPost\.delete/);
    assert.match(dashboardBlog, /blogPost\.updateMany\(/);
    assert.match(dashboardBlog, /data: \{ status: "ARCHIVED" \}/);
    assert.match(dashboardBlog, /confirm="Archive this post\?"/);
  });

  it("detaches blog comment replies when a parent comment is removed", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260523235500_retention_fk_and_schema_drift/migration.sql",
    );

    assert.match(
      schema,
      /parent\s+BlogComment\?\s+@relation\("CommentReplies", fields: \[parentId\], references: \[id\], onDelete: SetNull\)/,
    );
    assert.match(
      migration,
      /ADD CONSTRAINT "BlogComment_parentId_fkey"[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/,
    );
  });
});
