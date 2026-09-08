// Offline schema projection only: exact DDL slices from the byte-attested
// sources, with explicitly minimal pre-existing tables. Not migration replay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS } from "../../scripts/stage-order-zero-direct-compatible-prefix.mjs";

export async function createZeroDirectSchemaBase(db) {
  await db.exec(`CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED','EXPIRED','VOIDED');
    CREATE TABLE public."Order"(id text, "sellerProfileId" text, "labelStatus" public."LabelStatus",
      "labelClaimStatus" varchar(32), "sellerRefundId" varchar(255), "refundClaimId" varchar(255));
    CREATE TABLE public."CheckoutStockReservation"(id text);
    ALTER TABLE public."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public."Order" TO grainline_app_runtime;`);
}

export async function applyZeroDirectSchemaMember(db, n) {
  if (![3, 10, 11, 12].includes(n)) return;
  const source = readFileSync(`prisma/migrations/${ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS[n - 1].migration}/migration.sql`, "utf8");
  let sql;
  if (n === 3) sql = source.slice(source.indexOf('ALTER TABLE public."Order"'), source.lastIndexOf("COMMIT;"));
  if (n === 10) sql = source.slice(source.indexOf('CREATE TABLE public."OrderStaffCapability"'), source.indexOf("CREATE OR REPLACE FUNCTION"));
  if (n === 11) sql = source.slice(source.indexOf('ALTER TABLE public."CheckoutStockReservation"'), source.indexOf("CREATE FUNCTION"));
  if (n === 12) sql = source.slice(source.indexOf('ALTER TABLE public."Order"'), source.indexOf("CREATE FUNCTION public.grainline_stripe_seller_deauthorization_apply"));
  assert.ok(sql?.length > 100 && !sql.includes("COMMIT;"), "unexpected fixed schema slice");
  await db.exec(sql);
}
