import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Listing preparation retires caller-selected legacy stock restoration", async () => {
  const [
    migration,
    restore,
    maintenance,
    state,
    provision,
    fullChainScenario,
  ] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/checkoutStockRestore.ts", root), "utf8"),
    readFile(new URL("src/lib/stripeWebhookMaintenance.ts", root), "utf8"),
    readFile(new URL("src/lib/stripeWebhookMaintenanceState.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  assert.doesNotMatch(migration, /grainline_legacy_stock_restore_apply/u);
  assert.match(restore, /reportMissingDurableStockReservation/u);
  assert.match(restore, /Checkout stock restoration requires a durable reservation/u);
  assert.match(restore, /checkout_stock_restore_missing_reservation/u);
  assert.match(restore, /releaseCheckoutLock\(input\.metadata\.checkoutLockKey, input\.sessionId\)/u);
  assert.doesNotMatch(restore, /UPDATE "Listing"/u);
  assert.doesNotMatch(restore, /tx\.listing\.updateMany/u);
  assert.doesNotMatch(restore, /applyLegacyStockRestore|claimLegacyStockRestore/u);
  assert.doesNotMatch(maintenance, /grainline_legacy_stock_restore_apply/u);
  assert.doesNotMatch(state, /legacyStockRestoreApplyFromRows/u);
  assert.doesNotMatch(provision, /grainline_legacy_stock_restore_apply/u);
  assert.doesNotMatch(fullChainScenario, /LEGACY_STOCK_RESTORE_SQL|Legacy stock restore must apply/u);
});
