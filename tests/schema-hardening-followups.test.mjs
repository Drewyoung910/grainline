import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("schema hardening follow-ups", () => {
  it("keeps custom-order conversation references on a real SetNull foreign key", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260521150000_schema_hardening_text_and_custom_order/migration.sql");

    assert.match(schema, /customOrderConversation\s+Conversation\?\s+@relation\("ListingCustomOrderConversation", fields: \[customOrderConversationId\], references: \[id\], onDelete: SetNull\)/);
    assert.match(schema, /customOrderListings\s+Listing\[\]\s+@relation\("ListingCustomOrderConversation"\)/);
    assert.match(schema, /@@index\(\[customOrderConversationId\]\)/);
    assert.match(migration, /SET "customOrderConversationId" = NULL/);
    assert.match(migration, /ADD CONSTRAINT "Listing_customOrderConversationId_fkey"/);
    assert.match(migration, /ON DELETE SET NULL/);
  });

  it("bounds email outbox HTML in schema and at enqueue time", () => {
    const schema = source("prisma/schema.prisma");
    const outbox = source("src/lib/emailOutbox.ts");
    const migration = source("prisma/migrations/20260521150000_schema_hardening_text_and_custom_order/migration.sql");

    assert.match(schema, /html\s+String\s+@db\.VarChar\(200000\)/);
    assert.match(outbox, /export const EMAIL_OUTBOX_HTML_MAX_CHARS = 200_000/);
    assert.match(outbox, /html: truncateText\(email\.html, EMAIL_OUTBOX_HTML_MAX_CHARS\)/);
    assert.match(migration, /SET "html" = LEFT\("html", 200000\)/);
    assert.match(migration, /ALTER COLUMN "html" TYPE VARCHAR\(200000\)/);
  });

  it("bounds order payment event descriptions in schema and webhook writes", () => {
    const schema = source("prisma/schema.prisma");
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const migration = source("prisma/migrations/20260521150000_schema_hardening_text_and_custom_order/migration.sql");

    assert.match(schema, /description\s+String\?\s+@db\.VarChar\(5000\)/);
    assert.match(webhook, /function paymentEventDescription\(value: string \| null \| undefined\)/);
    assert.match(webhook, /truncateText\(sanitizeText\(value \?\? ""\), 5000\)/);
    assert.match(webhook, /description: paymentEventDescription\(data\.description\)/);
    assert.match(migration, /SET "description" = LEFT\("description", 5000\)/);
    assert.match(migration, /ALTER COLUMN "description" TYPE VARCHAR\(5000\)/);
  });

  it("keeps saved-search dedupe race guarded by serializable retry", () => {
    const route = source("src/app/api/search/saved/route.ts");

    assert.match(route, /withSerializableRetry\(\(\) =>\s*prisma\.\$transaction\(async \(tx\) =>/s);
    assert.match(route, /tx\.savedSearch\.findFirst\(/);
    assert.match(route, /tx\.savedSearch\.create\(/);
    assert.match(route, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  });
});
