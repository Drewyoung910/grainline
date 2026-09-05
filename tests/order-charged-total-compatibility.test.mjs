import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION_SHA256,
  verifyOrderChargedTotalCompatibilityMigrationBytes,
} from "../scripts/order-charged-total-compatibility-catalog.mjs";

const { migration, migrationSha256 } =
  verifyOrderChargedTotalCompatibilityMigrationBytes();

describe("Order charged-total compatibility", () => {
  it("adds only a nullable bounded provider witness", () => {
    assert.match(migration, /ADD COLUMN "chargedTotalCents" integer/);
    assert.doesNotMatch(migration, /"chargedTotalCents" integer NOT NULL/);
    assert.match(
      migration,
      /"chargedTotalCents" IS NULL\s+OR "chargedTotalCents" >= 0/,
    );
    assert.doesNotMatch(migration, /UPDATE public\."Order"/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /GRANT|REVOKE/);
  });

  it("keeps schema, webhook, and release record aligned", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    const paidCheckoutAuthority = readFileSync("docs/rls-drafts/order-paid-checkout-authority.sql", "utf8");
    const audit = readFileSync("docs/order-charged-total-refund-state-audit.md", "utf8");
    assert.match(schema, /chargedTotalCents\s+Int\?/);
    assert.match(webhook, /requireCheckoutChargedTotalCents\(s\.amount_total\)/);
    assert.equal((webhook.match(/\n\s+chargedTotalCents,\n\s+itemsSubtotalCents,/g) ?? []).length, 1);
    assert.match(paidCheckoutAuthority, /\(p_provider->>'chargedTotalCents'\)::integer/);
    assert.match(audit, /legacy Orders remain nullable/i);
  });

  it("pins the reviewed migration bytes", () => {
    assert.equal(migrationSha256, ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION_SHA256);
  });
});
