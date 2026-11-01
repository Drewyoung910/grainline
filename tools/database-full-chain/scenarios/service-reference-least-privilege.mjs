import assert from "node:assert/strict";

import pg from "pg";

const EXPECTED_DENIAL_CODE = "42501";

function runtimeConnectionString(connectionString) {
  const value = new URL(connectionString);
  value.username = "grainline_app_runtime";
  value.password = "";
  return value.toString();
}

async function assertDenied(client, sql, params = []) {
  await assert.rejects(
    client.query(sql, params),
    (error) => error?.code === EXPECTED_DENIAL_CODE,
  );
}

export async function proveServiceReferenceLeastPrivilege({
  connectionString,
  ownerClient,
}) {
  const suffix = `service-reference-${Date.now()}`;
  const runtime = new pg.Client({
    connectionString: runtimeConnectionString(connectionString),
  });
  await runtime.connect();

  const auditId = `${suffix}:audit`;
  const metroId = `${suffix}:metro`;
  const metroSlug = `${suffix}-tx`;
  const foundingGrantId = `${suffix}:founding`;
  const deniedFoundingGrantId = `${foundingGrantId}:denied`;
  const foundingMakerNumber = 249;
  const siteConfigId = 2_147_483_000;
  const deniedSiteConfigId = 2_147_483_001;
  const siteMetricsId = 2_147_483_000;

  try {
    await ownerClient.query(
      `INSERT INTO public."FoundingMakerGrant" (
         id, "sellerProfileId", "foundingMakerNumber", "grantedAt", "createdAt", "updatedAt"
       ) VALUES ($1, NULL, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("foundingMakerNumber") DO NOTHING`,
      [foundingGrantId, foundingMakerNumber],
    );
    await ownerClient.query(
      `INSERT INTO public."SiteConfig" (id, "fallbackShippingCents")
       VALUES ($1, 1500)
       ON CONFLICT (id) DO UPDATE
         SET "fallbackShippingCents" = EXCLUDED."fallbackShippingCents"`,
      [siteConfigId],
    );
    await ownerClient.query(
      `INSERT INTO public."SiteMetricsSnapshot" (
         id, "avgConversion", "avgCtr", "avgRating", "calculatedAt", "updatedAt"
       ) VALUES ($1, 0, 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE
         SET "avgConversion" = EXCLUDED."avgConversion",
             "avgCtr" = EXCLUDED."avgCtr",
             "avgRating" = EXCLUDED."avgRating",
             "calculatedAt" = EXCLUDED."calculatedAt",
             "updatedAt" = EXCLUDED."updatedAt"`,
      [siteMetricsId],
    );

    const config = await runtime.query(
      'SELECT id, "fallbackShippingCents" FROM public."SiteConfig" WHERE id = $1',
      [siteConfigId],
    );
    assert.equal(config.rows.length, 1);
    await assertDenied(
      runtime,
      'UPDATE public."SiteConfig" SET "fallbackShippingCents" = "fallbackShippingCents" WHERE id = $1',
      [siteConfigId],
    );
    await assertDenied(
      runtime,
      'INSERT INTO public."SiteConfig" (id, "fallbackShippingCents") VALUES ($1, 1500)',
      [deniedSiteConfigId],
    );
    await assertDenied(
      runtime,
      'DELETE FROM public."SiteConfig" WHERE id = $1',
      [siteConfigId],
    );

    await runtime.query(
      `INSERT INTO public."SystemAuditLog" (
         id, "actorType", "actorId", action, "targetType", "targetId", metadata, "createdAt"
       ) VALUES ($1, 'system', NULL, 'SERVICE_REFERENCE_PROOF', 'PROOF', $1, '{}'::jsonb, CURRENT_TIMESTAMP)`,
      [auditId],
    );
    const audit = await runtime.query(
      'SELECT id FROM public."SystemAuditLog" WHERE id = $1',
      [auditId],
    );
    assert.deepEqual(audit.rows, [{ id: auditId }]);
    await assertDenied(
      runtime,
      'UPDATE public."SystemAuditLog" SET reason = NULL WHERE id = $1',
      [auditId],
    );
    await assertDenied(
      runtime,
      'DELETE FROM public."SystemAuditLog" WHERE id = $1',
      [auditId],
    );

    const founding = await runtime.query(
      'SELECT "foundingMakerNumber" FROM public."FoundingMakerGrant" ORDER BY "foundingMakerNumber" LIMIT 1',
    );
    assert.equal(founding.rows.length, 1);
    await assertDenied(
      runtime,
      `INSERT INTO public."FoundingMakerGrant" (
         id, "sellerProfileId", "foundingMakerNumber", "grantedAt", "createdAt", "updatedAt"
       ) VALUES ($1, NULL, 250, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [deniedFoundingGrantId],
    );
    await assertDenied(
      runtime,
      'UPDATE public."FoundingMakerGrant" SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1',
      [foundingGrantId],
    );
    await assertDenied(
      runtime,
      'DELETE FROM public."FoundingMakerGrant" WHERE id = $1',
      [foundingGrantId],
    );

    const metro = await runtime.query(
      `INSERT INTO public."Metro" (
         id, slug, name, state, latitude, longitude, "radiusMiles", "isActive", "createdAt", "updatedAt"
       ) VALUES ($1, $2, 'Service Reference Proof', 'Texas', 30.0, -97.0, 45, true,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             "updatedAt" = CURRENT_TIMESTAMP
       RETURNING id, slug`,
      [metroId, metroSlug],
    );
    assert.deepEqual(metro.rows, [{ id: metroId, slug: metroSlug }]);
    await assertDenied(
      runtime,
      'DELETE FROM public."Metro" WHERE id = $1',
      [metroId],
    );

    const metrics = await runtime.query(
      `INSERT INTO public."SiteMetricsSnapshot" (
         id, "avgConversion", "avgCtr", "avgRating", "calculatedAt", "updatedAt"
       ) VALUES ($1, 0, 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE
         SET "avgConversion" = EXCLUDED."avgConversion",
             "avgCtr" = EXCLUDED."avgCtr",
             "avgRating" = EXCLUDED."avgRating",
             "calculatedAt" = EXCLUDED."calculatedAt",
             "updatedAt" = CURRENT_TIMESTAMP
       RETURNING id`,
      [siteMetricsId],
    );
    assert.deepEqual(metrics.rows, [{ id: siteMetricsId }]);
    await assertDenied(
      runtime,
      'DELETE FROM public."SiteMetricsSnapshot" WHERE id = $1',
      [siteMetricsId],
    );

    await assertDenied(
      runtime,
      'SELECT id FROM public."SellerExactMapConsentEvent" LIMIT 1',
    );
    await assertDenied(
      runtime,
      `INSERT INTO public."SellerExactMapConsentEvent" (
         id, "sellerProfileId", "actorUserId", "eventType", "consentTextVersion",
         "consentTextSha256", "coordinateHash", reason, "createdAt"
       ) VALUES ($1, 'seller', NULL, 'GRANTED', 1, repeat('a', 64), repeat('b', 64), NULL,
                 CURRENT_TIMESTAMP)`,
      [`${suffix}:consent`],
    );

    return Object.freeze({
      siteConfig: ["SELECT"],
      systemAuditLog: ["INSERT", "SELECT"],
      foundingMakerGrant: ["SELECT"],
      metro: ["INSERT", "SELECT", "UPDATE"],
      siteMetricsSnapshot: ["INSERT", "SELECT", "UPDATE"],
      sellerExactMapConsentEvent: [],
    });
  } finally {
    await runtime.end().catch(() => {});
    await ownerClient.query(
      'DELETE FROM public."SystemAuditLog" WHERE id = $1',
      [auditId],
    ).catch(() => {});
    await ownerClient.query(
      'DELETE FROM public."Metro" WHERE id = $1',
      [metroId],
    ).catch(() => {});
    await ownerClient.query(
      'DELETE FROM public."FoundingMakerGrant" WHERE id = $1',
      [foundingGrantId],
    ).catch(() => {});
    await ownerClient.query(
      'DELETE FROM public."FoundingMakerGrant" WHERE id = $1',
      [deniedFoundingGrantId],
    ).catch(() => {});
    await ownerClient.query(
      'DELETE FROM public."SiteConfig" WHERE id = ANY($1::integer[])',
      [[siteConfigId, deniedSiteConfigId]],
    ).catch(() => {});
    await ownerClient.query(
      'DELETE FROM public."SiteMetricsSnapshot" WHERE id = $1',
      [siteMetricsId],
    ).catch(() => {});
  }
}
