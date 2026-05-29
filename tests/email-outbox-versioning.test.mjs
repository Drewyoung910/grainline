import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("email outbox template versioning", () => {
  it("persists template name and version on queued email rows", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260529062000_email_outbox_template_version/migration.sql",
    );
    const outbox = source("src/lib/emailOutbox.ts");

    assert.match(schema, /model EmailOutbox[\s\S]*templateName\s+String\s+@default\("unknown"\) @db\.VarChar\(80\)/);
    assert.match(schema, /model EmailOutbox[\s\S]*templateVersion\s+Int\s+@default\(1\)/);
    assert.match(schema, /model EmailOutbox[\s\S]*@@index\(\[templateName, createdAt\]\)/);
    assert.match(migration, /ADD COLUMN "templateName" VARCHAR\(80\) NOT NULL DEFAULT 'unknown'/);
    assert.match(migration, /ADD COLUMN "templateVersion" INTEGER NOT NULL DEFAULT 1/);
    assert.match(migration, /"EmailOutbox_templateVersion_positive_chk"/);
    assert.match(outbox, /EMAIL_OUTBOX_TEMPLATE_VERSION = 1/);
    assert.match(outbox, /templateName: EmailOutboxTemplateName/);
    assert.match(outbox, /templateVersion\?: number/);
    assert.match(outbox, /templateName: email\.templateName/);
    assert.match(outbox, /templateVersion: normalizeTemplateVersion\(email\.templateVersion\)/);
  });

  it("requires every outbox enqueue caller to identify its template", () => {
    const callerTemplates = [
      ["src/app/api/clerk/webhook/route.ts", "welcome"],
      ["src/app/api/listings/[id]/stock/route.ts", "back_in_stock"],
      ["src/app/api/seller/broadcast/route.ts", "seller_broadcast"],
      ["src/app/dashboard/listings/new/page.tsx", "first_listing_congrats"],
      ["src/lib/followerListingNotifications.ts", "followed_maker_new_listing"],
    ];

    for (const [path, templateName] of callerTemplates) {
      assert.match(source(path), new RegExp(`templateName:\\s*"${templateName}"`), path);
    }

    const webhook = source("src/app/api/stripe/webhook/route.ts");
    assert.match(webhook, /source: QueuedEmail\["templateName"\]/);
    assert.match(webhook, /templateName: source/);
    assert.match(webhook, /source: "order_confirmed_buyer"/);
    assert.match(webhook, /source: "order_confirmed_seller"/);
    assert.match(webhook, /source: "first_sale_congrats"/);
  });
});
