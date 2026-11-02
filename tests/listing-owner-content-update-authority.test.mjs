import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing edit content update is owner-, version-, and state-bound", async () => {
  const [migration, ownerAccess, editPage, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/[id]/edit/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_content_update\(/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /listing\."sellerId" = seller_id[\s\S]*FOR UPDATE/u);
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_expected_updated_at/u);
  assert.match(migration, /source_listing\.status::text <> p_expected_status/u);
  assert.match(migration, /source_listing\."listingType"::text <> p_expected_listing_type/u);
  assert.match(migration, /source_listing\."archivedAt" IS NOT NULL/u);
  assert.match(migration, /source_listing\.status::text = 'PENDING_REVIEW'/u);
  assert.match(migration, /source_listing\.status::text = 'SOLD'/u);
  assert.match(migration, /source_listing\."rejectionReason" = 'Removed by Grainline staff\.'/u);
  assert.match(
    migration,
    /"priceVersion" = CASE[\s\S]*source_listing\."priceVersion" \+ 1/u,
  );
  assert.match(migration, /"updatedAt" = source_now/u);

  assert.match(ownerAccess, /export async function updateListingOwnerContent/u);
  assert.match(ownerAccess, /DbUserContextTransactionClient/u);
  assert.match(ownerAccess, /FROM public\.grainline_listing_owner_content_update\(/u);
  assert.match(ownerAccess, /row\.updatedAt instanceof Date/u);

  assert.match(editPage, /withDbUserContext\(actor\.id, async \(tx\) => \{/u);
  assert.match(editPage, /updateListingOwnerContent\(tx,/u);
  assert.doesNotMatch(editPage, /tx\.listing\.update\(/u);
  assert.match(editPage, /await tx\.listingVariantGroup\.deleteMany/u);
  assert.match(editPage, /await tx\.photo\.deleteMany/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_content_update"\([^\n]+\)'\s*,\s*true/u,
  );
});
