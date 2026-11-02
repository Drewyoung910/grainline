import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  import.meta.url,
);
const accessPath = new URL("../src/lib/listingOwnerAccess.ts", import.meta.url);
const dashboardPath = new URL("../src/app/dashboard/page.tsx", import.meta.url);
const shopActionsPath = new URL("../src/app/seller/[id]/shop/actions.ts", import.meta.url);
const editPath = new URL("../src/app/dashboard/listings/[id]/edit/page.tsx", import.meta.url);
const newPath = new URL("../src/app/dashboard/listings/new/page.tsx", import.meta.url);
const stockRoutePath = new URL("../src/app/api/listings/[id]/stock/route.ts", import.meta.url);
const provisionPath = new URL("../scripts/provision-runtime-db-role.sql", import.meta.url);

test("owner listing lifecycle reads use an actor-bound action-state authority", async () => {
  const [migration, access, dashboard, shopActions, editPage, newPage, stockRoute, provision] =
    await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(accessPath, "utf8"),
      readFile(dashboardPath, "utf8"),
      readFile(shopActionsPath, "utf8"),
      readFile(editPath, "utf8"),
      readFile(newPath, "utf8"),
      readFile(stockRoutePath, "utf8"),
      readFile(provisionPath, "utf8"),
    ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_action_state\(\s*p_listing_id text\s*\)[\s\S]*current_setting\('app\.user_id', true\)/u,
  );
  assert.match(migration, /listing\.id = p_listing_id/u);
  assert.match(migration, /listing\."sellerId" = seller_id/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_action_state\(text\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export function listingOwnerActionState\(userId: string, listingId: string\)/u);
  assert.match(access, /FROM public\.grainline_listing_owner_action_state\(/u);

  assert.equal(dashboard.match(/listingOwnerActionState\(me\.id, listingId\)/gu)?.length, 3);
  assert.match(shopActions, /listingOwnerActionState\(ownerId, listingId\)/u);
  assert.equal(editPage.match(/listingOwnerActionState\(actor\.id, listingId\)/gu)?.length, 2);
  assert.match(newPage, /listingOwnerActionState\(seller\.userId, created\.id\)/u);
  assert.match(stockRoute, /listingOwnerActionState\(me\.id, id\)/u);
  assert.doesNotMatch(dashboard, /prisma\.listing\.findUnique\(/u);
  assert.doesNotMatch(shopActions, /prisma\.listing\.findFirst\(/u);
  assert.doesNotMatch(editPage, /prisma\.listing\.findUnique\(/u);
  assert.doesNotMatch(newPage, /prisma\.listing\.findUnique\(/u);
  assert.doesNotMatch(stockRoute, /prisma\.listing\.findFirst\(/u);
  assert.doesNotMatch(stockRoute, /sellerOwnerCore/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_action_state"\(text\)'\s*,\s*true/u,
  );
});
