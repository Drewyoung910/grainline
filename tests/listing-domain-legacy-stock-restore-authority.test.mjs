import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("legacy checkout stock restoration is one claim-bound fixed operation", async () => {
  const [
    migration,
    predecessor,
    restore,
    maintenance,
    state,
    provision,
    fullChainScenario,
  ] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("prisma/migrations/20260905070000_prepare_order_legacy_stock_restore_fence/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/checkoutStockRestore.ts", root), "utf8"),
    readFile(new URL("src/lib/stripeWebhookMaintenance.ts", root), "utf8"),
    readFile(new URL("src/lib/stripeWebhookMaintenanceState.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  const start = migration.indexOf(
    "CREATE FUNCTION public.grainline_legacy_stock_restore_apply(",
  );
  const end = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_delete_lock(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const authority = migration.slice(start, end);

  const lock = predecessor.indexOf("pg_catalog.pg_advisory_xact_lock(");
  const orderFence = predecessor.indexOf('FROM public."Order" AS source_order');
  const eventInsert = predecessor.indexOf('INSERT INTO public."StripeWebhookEvent"');
  const stockUpdate = authority.indexOf('UPDATE public."Listing" AS listing');
  assert.ok(lock >= 0 && lock < orderFence && orderFence < eventInsert);
  assert.ok(stockUpdate >= 0);
  assert.match(authority, /p_reserved_items jsonb/u);
  assert.match(authority, /jsonb_array_length\(p_reserved_items\) NOT BETWEEN 1 AND 100/u);
  assert.match(authority, /source_claimed := public\.grainline_legacy_stock_restore_claim\(p_session_id\)/u);
  assert.match(predecessor, /checkout\.session\.stock_restored/u);
  assert.match(predecessor, /source_order\."stripeSessionId" = p_session_id/u);
  assert.match(authority, /"stockQuantity" = listing\."stockQuantity" \+ source_item\.quantity/u);
  assert.match(authority, /GRANT EXECUTE ON FUNCTION public\.grainline_legacy_stock_restore_apply/u);

  assert.match(restore, /applyLegacyStockRestore\(input\.sessionId, items, tx\)/u);
  assert.doesNotMatch(restore, /UPDATE "Listing"/u);
  assert.doesNotMatch(restore, /tx\.listing\.updateMany/u);
  assert.doesNotMatch(restore, /claimLegacyStockRestore/u);
  assert.match(maintenance, /grainline_legacy_stock_restore_apply/u);
  assert.match(state, /legacyStockRestoreApplyFromRows/u);

  assert.match(
    provision,
    /public\."grainline_legacy_stock_restore_apply"\(text,jsonb\)/u,
  );
  assert.match(fullChainScenario, /Legacy stock restore must apply exactly once/u);
  assert.match(fullChainScenario, /Legacy stock restore replay must not duplicate stock/u);
});
