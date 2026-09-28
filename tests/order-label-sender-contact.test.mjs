import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (path) => readFileSync(path, "utf8");
const migrationPath =
  "prisma/migrations/20260928020000_correct_order_label_sender_contact/migration.sql";

function functionBody(sql, delimiter) {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_preflight(");
  const end = sql.indexOf(delimiter, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return sql.slice(start, end + delimiter.length);
}

describe("Order label sender contact correction", () => {
  it("changes the latest preflight only by requiring and returning seller phone", () => {
    const predecessor = source(
      "prisma/migrations/20260926012100_correct_order_seller_deauthorization_label/migration.sql",
    );
    const migration = source(migrationPath);
    const delimiter = "$grainline_order_seller_label_preflight$;";
    const expected = functionBody(predecessor, delimiter)
      .replace(
        "     OR COALESCE(seller.\"shipFromCountry\", 'US') !~ '^[A-Za-z]{2}$'\n",
        () => "     OR COALESCE(seller.\"shipFromCountry\", 'US') !~ '^[A-Za-z]{2}$'\n"
          + "     OR NULLIF(pg_catalog.btrim(seller.\"shipFromPhone\"), '') IS NULL\n"
          + "     OR seller.\"shipFromPhone\" !~ '^[+][1-9][0-9]{7,14}$'\n",
      )
      .replace(
        "      'country', COALESCE(seller.\"shipFromCountry\", 'US')\n",
        "      'country', COALESCE(seller.\"shipFromCountry\", 'US'),\n"
          + "      'phone', pg_catalog.btrim(seller.\"shipFromPhone\")\n",
      );
    assert.equal(functionBody(migration, delimiter), expected);
  });

  it("adds one nullable E.164 field without changing RLS or table grants", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(migrationPath);
    const ci = source(".github/workflows/ci.yml");

    assert.match(schema, /shipFromPhone\s+String\?\s+@db\.VarChar\(30\)/);
    assert.match(migration, /ADD COLUMN "shipFromPhone" VARCHAR\(30\)/);
    assert.match(migration, /"shipFromPhone" IS NULL[\s\S]*"shipFromPhone" ~ '\^\[\+\]\[1-9\]\[0-9\]\{7,14\}\$'/);
    assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_order_seller_label_preflight\(text, text\)[\s\S]*FROM PUBLIC/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_order_seller_label_preflight\(text, text\)[\s\S]*TO grainline_app_runtime/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /GRANT\s+.*\s+ON\s+(?:TABLE\s+)?public\./i);
    assert.match(ci, /Verify Order label sender-contact correction source package[\s\S]*Isolate Order label sender-contact correction until predecessors pass/);
    assert.match(ci, /Restore Order deauthorized Case-access correction[\s\S]*Restore Order label sender-contact correction[\s\S]*Apply only Order label sender-contact correction in disposable PostgreSQL/);
  });

  it("keeps the seller phone private, exportable and deletion-safe", () => {
    const seller = source("src/app/dashboard/seller/page.tsx");
    const fields = source("src/components/SellerShipFromAddressFields.tsx");
    const authority = source("src/lib/orderLabelAuthority.ts");
    const shippo = source("src/lib/shippo.ts");
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");
    const accountExport = source("src/app/api/account/export/route.ts");
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(fields, /name="shipFromPhone"[\s\S]*type="tel"/);
    assert.match(seller, /sanitizeOptionalE164Phone\(rawShipFromPhone\)/);
    assert.match(seller, /shipFromPhone !== null && !isE164Phone\(shipFromPhone\)/);
    assert.match(authority, /shipFrom: LabelSenderAddress/);
    assert.match(authority, /senderAddress\(row\.shipFrom, "Order label ship-from"\)/);
    assert.match(shippo, /type SenderAddress = Address & \{ phone: string \}/);
    assert.match(shippo, /phone: from\.phone/);
    assert.doesNotMatch(shippo, /SHIPPO_LABEL_SENDER_PHONE/);
    assert.match(labelRoute, /shipping address, ship-from address, or sender phone is incomplete/);
    assert.match(accountExport, /shipFromPhone: true/);
    assert.match(accountDeletion, /user\.sellerProfile\?\.shipFromPhone/);
    assert.match(accountDeletion, /shipFromPhone: null/);
  });
});
