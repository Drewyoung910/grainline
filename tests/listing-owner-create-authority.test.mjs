import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ordinary and reserved listing creation use one actor-bound composite authority", async () => {
  const [
    migration,
    ownerAccess,
    ordinaryPage,
    customPage,
    provision,
    fullChainScenario,
    fullChainRunner,
  ] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/new/page.tsx", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/custom/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
    readFile(new URL("tests/database-full-chain-postgres.test.mjs", root), "utf8"),
  ]);

  const authorityStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_create(",
  );
  const authorityEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_content_update(",
    authorityStart,
  );
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  const authority = migration.slice(authorityStart, authorityEnd);
  const childCoreStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_children_replace_core(",
  );
  assert.ok(childCoreStart >= 0 && authorityStart > childCoreStart);
  const childCore = migration.slice(childCoreStart, authorityStart);

  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /actor\.banned = false/u);
  assert.match(authority, /actor\."deletedAt" IS NULL/u);
  assert.match(authority, /seller\."ownerAccountActive" = true/u);
  assert.match(authority, /seller_state\."chargesEnabled" = true/u);
  assert.match(authority, /seller_state\."stripeAccountSupported" = true/u);
  assert.match(authority, /seller_state\."vacationMode" = false/u);
  assert.match(authority, /grainline_conversation_lock_pair_core/u);
  assert.match(authority, /conversation\."userAId" = pair\.user_a_id/u);
  assert.match(authority, /conversation\."userBId" = pair\.user_b_id/u);
  assert.match(
    authority,
    /p_is_private = false[\s\S]*jsonb_array_length\(p_photos\) < 1/u,
  );
  assert.doesNotMatch(
    childCore,
    /jsonb_array_length\(p_photos\) < 1/u,
  );
  assert.match(authority, /INSERT INTO public\."Listing"/u);
  assert.match(authority, /grainline_listing_children_replace_core/u);
  assert.match(authority, /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_create/u);

  assert.match(ownerAccess, /export function createListingOwner/u);
  assert.match(ownerAccess, /withDbUserContext\(userId, async \(client\) =>/u);
  assert.match(ownerAccess, /FROM public\.grainline_listing_owner_create\(/u);
  assert.match(ownerAccess, /syncListingDirectUploadReferences\(\{/u);
  assert.match(ownerAccess, /requireAllTracked: true/u);
  assert.match(ownerAccess, /input\.priceCents,\s*input\.isPrivate,\s*\)/u);
  assert.match(ownerAccess, /validNullableNonnegativeNumber\(input\.productLengthIn\)/u);
  assert.match(ownerAccess, /validNullableNonnegativeInteger\(input\.packagedWeightGrams\)/u);
  assert.match(authority, /p_product_length_in < 0/u);
  assert.match(authority, /p_packaged_weight_grams < 0/u);

  for (const page of [ordinaryPage, customPage]) {
    assert.match(page, /createListingOwner\(/u);
    assert.doesNotMatch(page, /tx\.listing\.create/u);
    assert.doesNotMatch(page, /tx\.photo\.create/u);
    assert.doesNotMatch(page, /tx\.listingVariantGroup\.create/u);
  }
  assert.match(customPage, /isPrivate: true/u);
  assert.match(customPage, /reservedForUserId/u);
  assert.match(customPage, /customOrderConversationId: conversationId/u);
  assert.match(customPage, /photos: photoPairs\.map/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_create"\([^\n]+\)'\s*,\s*true/u,
  );
  assert.match(
    provision,
    /public\."grainline_listing_children_replace_core"\(text,integer,jsonb,jsonb\)'\s*,\s*false/u,
  );

  assert.match(
    fullChainScenario,
    /export async function proveListingDomainOwnerMutations/u,
  );
  assert.match(fullChainScenario, /SET LOCAL ROLE grainline_app_runtime/u);
  assert.match(fullChainScenario, /invalid child data must roll back the parent update atomically/u);
  assert.match(fullChainScenario, /Forbidden cross-owner update/u);
  assert.match(fullChainScenario, /Reserved full-chain listing authority proof/u);
  assert.match(fullChainScenario, /title: "Reserved full-chain listing authority proof",\s*photos: \[\]/u);
  assert.match(fullChainScenario, /\[\{ count: 0 \}\]/u);
  assert.match(fullChainRunner, /proveListingDomainOwnerMutations\(\{/u);
});
