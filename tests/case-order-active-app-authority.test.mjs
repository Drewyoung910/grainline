import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateActiveCaseResult,
} from "../src/lib/caseOrderActiveResult.ts";

describe("Case-aware Order application authority", () => {
  it("accepts only one boolean or unauthorized null result", () => {
    assert.equal(validateActiveCaseResult([{ active: false }], "buyer"), false);
    assert.equal(validateActiveCaseResult([{ active: true }], "seller"), true);
    assert.equal(validateActiveCaseResult([{ active: null }], "buyer"), null);
    for (const rows of [
      [],
      [{ active: false }, { active: true }],
      [{ active: 0 }],
      [{ active: "false" }],
      [{ active: undefined }],
    ]) {
      assert.throws(
        () => validateActiveCaseResult(rows, "seller"),
        /invalid (?:row count|result)/,
      );
    }
  });

  it("uses only two actor-bound one-statement authority wrappers", () => {
    const authority = fs.readFileSync(
      "src/lib/caseOrderActiveAuthority.ts",
      "utf8",
    );
    assert.match(authority, /normalizeDbUserContextUserId/);
    assert.match(
      authority,
      /grainline_case_order_active_for_buyer\(/,
    );
    assert.match(
      authority,
      /grainline_case_order_active_for_seller\(/,
    );
    assert.match(authority, /normalizeOrderId/);
    assert.doesNotMatch(
      authority,
      /prisma\.(?:case|order|orderItem|listing)|\$transaction|\$queryRawUnsafe/,
    );
  });

  it("keeps Case fencing inside fixed fulfillment operations and the label lock", () => {
    const buyer = fs.readFileSync(
      "src/app/api/orders/[id]/confirm-delivery/route.ts",
      "utf8",
    );
    const fulfillment = fs.readFileSync(
      "src/app/api/orders/[id]/fulfillment/route.ts",
      "utf8",
    );
    const label = fs.readFileSync(
      "src/app/api/orders/[id]/label/route.ts",
      "utf8",
    );

    const authority = fs.readFileSync(
      "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
      "utf8",
    );

    assert.match(buyer, /finalizeBuyerOrderReceipt\(\{/);
    assert.match(fulfillment, /finalizeSellerOrderFulfillment\(\{/);
    assert.doesNotMatch(buyer, /caseOrderActiveForBuyer|lockOrderForCaseLifecycle/);
    assert.doesNotMatch(fulfillment, /caseOrderActiveForSeller|lockOrderForCaseLifecycle/);
    assert.equal(
      (authority.match(/source_case\.status::text IN \(\s*'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'\s*\)/g) ?? []).length,
      2,
    );
    assert.equal((label.match(/caseOrderActiveForSeller/g) ?? []).length, 3);
    assert.match(
      label,
      /lockOrderForCaseLifecycle\(tx, [^)]+\)[\s\S]*caseOrderActiveForSeller\([\s\S]*tx,/,
    );
    assert.match(label, /actorUserId: (?:authz\.)?seller\.userId/);

    for (const source of [buyer, fulfillment, label]) {
      assert.doesNotMatch(source, /\bACTIVE_CASE_STATUSES?\b/);
      assert.doesNotMatch(
        source,
        /(?:case:\s*\{\s*select|FROM "Case"|prisma\.case\.)/,
      );
    }
  });

  it("routes retention through a fixed database-clock operation with bounded controls", () => {
    const retention = fs.readFileSync(
      "src/lib/orderPiiRetention.ts",
      "utf8",
    );
    assert.match(
      retention,
      /grainline_order_buyer_pii_prune_batch/,
    );
    assert.match(
      retention,
      /retentionDays !== ORDER_BUYER_PII_RETENTION_DAYS/,
    );
    assert.match(retention, /batchSize > 1000/);
    assert.match(retention, /timeBudgetMs > MAX_TIME_BUDGET_MS/);
    assert.doesNotMatch(
      retention,
      /\$executeRaw|FROM "Case"|UPDATE "Order"|DELETE FROM "OrderShippingRateQuote"/,
    );
  });
});
