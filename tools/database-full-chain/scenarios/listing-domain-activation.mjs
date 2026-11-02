import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

const DENIED = "42501";

function roleConnectionString(connectionString, role, password) {
  const url = new URL(connectionString);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function assertDenied(client, sql, params = []) {
  await assert.rejects(
    client.query(sql, params),
    (error) => error?.code === DENIED,
  );
}

function planNodes(plan) {
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan?.[0]?.Plan);
  return nodes;
}

async function explain(client, sql, params = []) {
  const result = await client.query(
    `EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF, SUMMARY ON) ${sql}`,
    params,
  );
  const plan = result.rows[0]?.["QUERY PLAN"];
  assert.ok(Array.isArray(plan), "PostgreSQL must return a JSON query plan");
  return plan;
}

function assertIndexedListingPlan(plan, label) {
  const listingNodes = planNodes(plan).filter(
    (node) => node["Relation Name"] === "Listing",
  );
  assert.ok(listingNodes.length > 0, `${label} must access Listing`);
  assert.equal(
    listingNodes.some((node) => node["Node Type"] === "Seq Scan"),
    false,
    `${label} must not sequentially scan the visible Listing set`,
  );
  assert.ok(
    Number(plan[0]?.["Execution Time"] ?? Number.POSITIVE_INFINITY) < 500,
    `${label} must complete within the 500 ms disposable-proof threshold`,
  );
}

export async function proveListingDomainRlsActivation({
  connectionString,
  database,
  ownerClient,
  repositoryRoot,
  seller,
}) {
  const suffix = randomUUID();
  const runtimePassword = randomBytes(24).toString("base64url");
  const staffPassword = randomBytes(24).toString("base64url");
  const runtime = new pg.Client({
    connectionString: roleConnectionString(
      connectionString,
      "grainline_app_runtime",
      runtimePassword,
    ),
  });
  const staff = new pg.Client({
    connectionString: roleConnectionString(
      connectionString,
      "grainline_staff_read_runtime",
      staffPassword,
    ),
  });
  let runtimeConnected = false;
  let staffConnected = false;

  const otherUserId = `listing-rls-user-${suffix}`;
  const otherSellerId = `listing-rls-seller-${suffix}`;
  const ids = {
    public: `listing-rls-public-${suffix}`,
    sold: `listing-rls-sold-${suffix}`,
    private: `listing-rls-private-${suffix}`,
    archived: `listing-rls-archived-${suffix}`,
    unavailable: `listing-rls-unavailable-${suffix}`,
    invalid: `listing-rls-invalid-${suffix}`,
  };
  const photoIds = {
    public: `listing-rls-photo-public-${suffix}`,
    private: `listing-rls-photo-private-${suffix}`,
  };
  const groupIds = {
    public: `listing-rls-group-public-${suffix}`,
    private: `listing-rls-group-private-${suffix}`,
  };
  const optionIds = {
    public: `listing-rls-option-public-${suffix}`,
    private: `listing-rls-option-private-${suffix}`,
  };
  const now = "2026-11-02 16:00:00";

  await ownerClient.query(
    `ALTER ROLE grainline_app_runtime PASSWORD '${runtimePassword}'`,
  );
  await ownerClient.query(
    `ALTER ROLE grainline_staff_read_runtime PASSWORD '${staffPassword}'`,
  );

  try {
    await runtime.connect();
    runtimeConnected = true;
    await staff.connect();
    staffConnected = true;
    assert.deepEqual((await runtime.query(
      "SELECT current_user, session_user",
    )).rows[0], {
      current_user: "grainline_app_runtime",
      session_user: "grainline_app_runtime",
    });

    await database.query(
      `INSERT INTO public."User"
         (id, "clerkId", email, name, role, "createdAt", "updatedAt",
          "termsAcceptedAt", "termsVersion", "ageAttestedAt")
       VALUES ($1, $2, $3, 'Unavailable listing seller', 'USER',
               $4, $4, $4, '2026-01-01', $4)`,
      [
        otherUserId,
        `clerk_${otherUserId}`.slice(0, 191),
        `${otherUserId}@example.test`.slice(0, 191),
        now,
      ],
    );
    await database.query(
      `INSERT INTO public."SellerProfile"
         (id, "userId", "displayName", "displayNameNormalized",
          "chargesEnabled", "stripeAccountSupported", "vacationMode",
          "createdAt", "updatedAt")
       VALUES ($1, $2, 'Unavailable shop', 'unavailable shop',
               true, true, true, $3, $3)`,
      [otherSellerId, otherUserId, now],
    );

    await database.query(
      `INSERT INTO public."Listing"
         (id, "sellerId", title, description, "priceCents", currency,
          status, "listingType", "stockQuantity", "isPrivate",
          "reservedForUserId", "archivedAt", tags, materials,
          "createdAt", "updatedAt")
       VALUES
         ($1, $6, 'Public RLS listing', 'Public row', 1000, 'usd', 'ACTIVE',
          'IN_STOCK', 2, false, NULL, NULL, ARRAY['rls'], ARRAY['oak'], $8, $8),
         ($2, $6, 'Sold RLS listing', 'Sold row', 1100, 'usd', 'SOLD_OUT',
          'IN_STOCK', 0, false, NULL, NULL, ARRAY['rls'], ARRAY['oak'], $8, $8),
         ($3, $6, 'Private RLS listing', 'Private row', 1200, 'usd', 'ACTIVE',
          'IN_STOCK', 1, true, $7, NULL, ARRAY['rls'], ARRAY['oak'], $8, $8),
         ($4, $6, 'Archived RLS listing', 'Archived row', 1300, 'usd', 'ACTIVE',
          'IN_STOCK', 1, false, NULL, $8, ARRAY['rls'], ARRAY['oak'], $8, $8),
         ($5, $9, 'Unavailable RLS listing', 'Unavailable row', 1400, 'usd', 'ACTIVE',
          'IN_STOCK', 1, false, NULL, NULL, ARRAY['rls'], ARRAY['oak'], $8, $8)`,
      [
        ids.public,
        ids.sold,
        ids.private,
        ids.archived,
        ids.unavailable,
        seller.sellerProfileId,
        seller.userId,
        now,
        otherSellerId,
      ],
    );
    await database.query(
      `INSERT INTO public."Photo"
         (id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt")
       VALUES
         ($1, $3, 'https://cdn.example.test/public.jpg',
          'https://private.example.test/public-original.jpg', 'Public photo', 0, $5),
         ($2, $4, 'https://cdn.example.test/private.jpg',
          'https://private.example.test/private-original.jpg', 'Private photo', 0, $5)`,
      [photoIds.public, photoIds.private, ids.public, ids.private, now],
    );
    await database.query(
      `INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
       VALUES ($1, $3, 'Wood', 0), ($2, $4, 'Hidden wood', 0)`,
      [groupIds.public, groupIds.private, ids.public, ids.private],
    );
    await database.query(
      `INSERT INTO public."ListingVariantOption"
         (id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock")
       VALUES ($1, $3, 'Oak', 100, 0, true),
              ($2, $4, 'Hidden oak', 200, 0, true)`,
      [optionIds.public, optionIds.private, groupIds.public, groupIds.private],
    );

    const visible = (await runtime.query(
      `SELECT id, title, "archivedAt"
         FROM public."Listing"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [Object.values(ids).filter((id) => id !== ids.invalid)],
    )).rows;
    assert.deepEqual(visible, [{
      id: ids.public,
      title: "Public RLS listing",
      archivedAt: null,
    }]);

    assert.deepEqual((await runtime.query(
      `SELECT id, "listingId", url, "altText", "sortOrder", "createdAt"
         FROM public."Photo"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [Object.values(photoIds)],
    )).rows.map(({ id, listingId, url, altText, sortOrder }) => ({
      id, listingId, url, altText, sortOrder,
    })), [{
      id: photoIds.public,
      listingId: ids.public,
      url: "https://cdn.example.test/public.jpg",
      altText: "Public photo",
      sortOrder: 0,
    }]);
    assert.deepEqual((await runtime.query(
      `SELECT id FROM public."ListingVariantGroup"
        WHERE id = ANY($1::text[]) ORDER BY id`,
      [Object.values(groupIds)],
    )).rows, [{ id: groupIds.public }]);
    assert.deepEqual((await runtime.query(
      `SELECT id FROM public."ListingVariantOption"
        WHERE id = ANY($1::text[]) ORDER BY id`,
      [Object.values(optionIds)],
    )).rows, [{ id: optionIds.public }]);

    await assertDenied(runtime, 'SELECT * FROM public."Listing" LIMIT 1');
    await assertDenied(
      runtime,
      'SELECT "priceVersion" FROM public."Listing" WHERE id = $1',
      [ids.public],
    );
    await assertDenied(
      runtime,
      'SELECT "originalUrl" FROM public."Photo" WHERE id = $1',
      [photoIds.public],
    );
    await assertDenied(
      runtime,
      'UPDATE public."Listing" SET title = title WHERE id = $1',
      [ids.public],
    );
    await assertDenied(
      runtime,
      'DELETE FROM public."Photo" WHERE id = $1',
      [photoIds.public],
    );
    await assertDenied(staff, 'SELECT id FROM public."Listing" LIMIT 1');

    await runtime.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [seller.userId],
    );
    assert.deepEqual((await runtime.query(
      `SELECT "listingId" FROM public.grainline_listing_owner_editor($1::text)`,
      [ids.private],
    )).rows, [{ listingId: ids.private }]);

    await assert.rejects(
      database.query(
        `INSERT INTO public."Listing"
           (id, "sellerId", title, description, "priceCents", currency,
            status, "listingType", "stockQuantity", "isPrivate",
            "reservedForUserId", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Invalid public reservation', 'Invalid', 1000, 'usd',
                 'ACTIVE', 'IN_STOCK', 1, false, $3, $4, $4)`,
        [ids.invalid, seller.sellerProfileId, seller.userId, now],
      ),
      (error) => error?.code === "23514",
    );

    const scalePrefix = `listing-rls-scale-${suffix}`;
    const scaleNeedle = `rlsneedle${suffix.replaceAll("-", "").slice(0, 12)}`;
    await database.query(
      `INSERT INTO public."Listing"
         (id, "sellerId", title, description, "priceCents", currency,
          status, "listingType", "stockQuantity", "isPrivate",
          "reservedForUserId", "archivedAt", tags, materials, category,
          "sellerPubliclyOrderable", "createdAt", "updatedAt")
       SELECT $1 || '-' || series.value::text,
              $2,
              CASE WHEN series.value <= 5
                   THEN $3 || ' ' || series.value::text
                   ELSE 'Scale listing ' || series.value::text END,
              'Exact activation query-plan row',
              1000 + (series.value % 100),
              'usd',
              'ACTIVE'::public."ListingStatus",
              'IN_STOCK'::public."ListingType",
              1,
              false,
              NULL,
              NULL,
              CASE WHEN series.value % 1000 = 0
                   THEN ARRAY[$4]::text[] ELSE ARRAY['scale']::text[] END,
              ARRAY['oak']::text[],
              CASE WHEN series.value % 10 = 0
                   THEN 'FURNITURE' ELSE 'OTHER' END::public."Category",
              true,
              $5::timestamp - (series.value::text || ' seconds')::interval,
              $5::timestamp - (series.value::text || ' seconds')::interval
         FROM pg_catalog.generate_series(1, 50000) AS series(value)`,
      [scalePrefix, seller.sellerProfileId, scaleNeedle, `${scaleNeedle}-tag`, now],
    );
    await database.query('ANALYZE public."Listing"');

    assertIndexedListingPlan(
      await explain(
        runtime,
        `SELECT id, title, "createdAt"
           FROM public."Listing"
          WHERE category = 'FURNITURE'
          ORDER BY "createdAt" DESC, id DESC
          LIMIT 24`,
      ),
      "public category newest page",
    );
    assertIndexedListingPlan(
      await explain(
        runtime,
        `SELECT id, title, "updatedAt"
           FROM public."Listing"
          WHERE "sellerId" = $1
          ORDER BY "updatedAt" DESC
          LIMIT 24`,
        [seller.sellerProfileId],
      ),
      "public seller page",
    );
    assertIndexedListingPlan(
      await explain(
        runtime,
        `SELECT id, title
           FROM public."Listing"
          WHERE id = ANY($1::text[])`,
        [[`${scalePrefix}-1`, `${scalePrefix}-25000`, `${scalePrefix}-50000`]],
      ),
      "public exact-id fetch",
    );

    const boundedSearchPlan = await explain(
      runtime,
      `SELECT *
         FROM public.grainline_listing_public_catalog_page(
           $1::jsonb, 0, 24
         )`,
      [JSON.stringify({ query: scaleNeedle, sort: "relevant" })],
    );
    assert.ok(
      Number(boundedSearchPlan[0]?.["Execution Time"] ?? Number.POSITIVE_INFINITY)
        < 1000,
      "bounded selective search must complete within the 1 s scale threshold",
    );
    await database.query(
      `DELETE FROM public."Listing" WHERE id LIKE $1 || '-%'`,
      [scalePrefix],
    );
    await database.query('VACUUM (ANALYZE) public."Listing"');

    const rollbackSql = readFileSync(
      join(repositoryRoot, "docs/rls-drafts/listing-domain-activation-rollback.sql"),
      "utf8",
    );
    await database.executeMigration(rollbackSql, {
      migrationName: "listing-domain-activation-rollback-proof",
    });
    assert.deepEqual((await runtime.query(
      `SELECT id FROM public."Listing"
        WHERE id = ANY($1::text[]) ORDER BY id`,
      [[ids.private, ids.sold]],
    )).rows, [{ id: ids.private }, { id: ids.sold }]);
    assert.deepEqual((await runtime.query(
      'SELECT "priceVersion" FROM public."Listing" WHERE id = $1',
      [ids.public],
    )).rows, [{ priceVersion: 1 }]);

    const activationSql = readFileSync(
      join(
        repositoryRoot,
        "prisma/migrations/20261102060000_activate_listing_domain_rls/migration.sql",
      ),
      "utf8",
    );
    await database.executeMigration(activationSql, {
      migrationName: "listing-domain-activation-reactivation-proof",
    });
    assert.deepEqual((await runtime.query(
      `SELECT id FROM public."Listing"
        WHERE id = ANY($1::text[]) ORDER BY id`,
      [[ids.public, ids.private, ids.sold]],
    )).rows, [{ id: ids.public }]);
    await assertDenied(
      runtime,
      'SELECT "priceVersion" FROM public."Listing" WHERE id = $1',
      [ids.public],
    );
  } finally {
    if (runtimeConnected) await runtime.end().catch(() => {});
    if (staffConnected) await staff.end().catch(() => {});
    await ownerClient.query(
      "ALTER ROLE grainline_app_runtime PASSWORD NULL",
    ).catch(() => {});
    await ownerClient.query(
      "ALTER ROLE grainline_staff_read_runtime PASSWORD NULL",
    ).catch(() => {});
  }
}
