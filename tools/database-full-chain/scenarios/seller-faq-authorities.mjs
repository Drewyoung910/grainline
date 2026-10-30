import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

export const SELLER_FAQ_PREPARATION_MIGRATION =
  "20261029010000_prepare_seller_faq_authorities";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function runtimeQuery(database, actorId, sql, params = []) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [actorId ?? ""],
    );
    const result = await database.query(sql, params);
    await database.query("COMMIT");
    return rowsOf(result);
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function runtimeQueryOnConnection(connectionString, actorId, sql, params) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await runtimeQuery(client, actorId, sql, params);
  } finally {
    await client.end();
  }
}

export async function proveSellerFaqPreparedAuthorities({
  database,
  connectionString,
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const ownerId = `seller_faq_owner_${suffix}`;
  const ownerSellerId = `seller_faq_owner_shop_${suffix}`;
  const otherId = `seller_faq_other_${suffix}`;
  const otherSellerId = `seller_faq_other_shop_${suffix}`;
  const now = "2026-10-29 12:00:00";

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'SellerFaq owner', 'USER', false, $7, $7),
       ($4, $5, $6, 'SellerFaq other', 'USER', false, $7, $7)`,
    [
      ownerId,
      `clerk_${ownerId}`,
      `${ownerId}@example.test`,
      otherId,
      `clerk_${otherId}`,
      `${otherId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
       (id, "userId", "ownerAccountActive", "displayName",
        "displayNameNormalized", "createdAt", "updatedAt", "chargesEnabled",
        "stripeAccountSupported", "vacationMode")
     VALUES
       ($1, $2, true, 'SellerFaq Owner Shop', 'sellerfaq owner shop',
        $5, $5, true, true, false),
       ($3, $4, true, 'SellerFaq Other Shop', 'sellerfaq other shop',
        $5, $5, true, true, false)`,
    [ownerSellerId, ownerId, otherSellerId, otherId, now],
  );

  const firstId = randomUUID();
  const twoHundredCodePoints = "🙂".repeat(200);
  assert.deepEqual(
    await runtimeQuery(
      database,
      ownerId,
      `SELECT "resultStatus", id, "sortOrder", created
         FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [firstId, twoHundredCodePoints, "A safe first answer"],
    ),
    [{ resultStatus: "OK", id: firstId, sortOrder: 1, created: true }],
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      ownerId,
      `SELECT "resultStatus", id, "sortOrder", created
         FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [firstId, twoHundredCodePoints, "A safe first answer"],
    ),
    [{ resultStatus: "OK", id: firstId, sortOrder: 1, created: false }],
    "same-id replay must return the original row without duplicating it",
  );

  await assert.rejects(
    runtimeQuery(
      database,
      ownerId,
      `SELECT * FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [randomUUID(), "x".repeat(201), "answer"],
    ),
    (error) => error?.code === "22023",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      `SELECT * FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [randomUUID(), "question", "answer"],
    ),
    (error) => error?.code === "42501",
  );

  assert.deepEqual(
    await runtimeQuery(
      database,
      otherId,
      "SELECT public.grainline_seller_faq_owner_remove($1) AS value",
      [firstId],
    ),
    [{ value: 0 }],
    "another owner cannot remove the row",
  );

  const removableId = randomUUID();
  assert.equal(rowsOf(await runtimeQuery(
    database,
    ownerId,
    `SELECT * FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
    [removableId, "Temporary question", "Temporary answer"],
  ))[0]?.created, true);
  assert.deepEqual(
    await runtimeQuery(
      database,
      ownerId,
      "SELECT public.grainline_seller_faq_owner_remove($1) AS value",
      [removableId],
    ),
    [{ value: 1 }],
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      ownerId,
      "SELECT public.grainline_seller_faq_owner_remove($1) AS value",
      [removableId],
    ),
    [{ value: 0 }],
    "remove replay must be idempotent",
  );

  const secondId = randomUUID();
  await runtimeQuery(
    database,
    ownerId,
    `SELECT * FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
    [secondId, "Second question", "Second answer"],
  );
  for (let index = 0; index < 17; index += 1) {
    await database.query(
      `INSERT INTO public."SellerFaq"
         (id, "sellerProfileId", question, answer, "sortOrder", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        ownerSellerId,
        `Seed question ${index}`,
        `Seed answer ${index}`,
        index + 3,
        now,
      ],
    );
  }

  const concurrent = await Promise.all([
    runtimeQueryOnConnection(
      connectionString,
      ownerId,
      `SELECT "resultStatus", id, "sortOrder", created
         FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [randomUUID(), "Concurrent A", "Concurrent answer A"],
    ),
    runtimeQueryOnConnection(
      connectionString,
      ownerId,
      `SELECT "resultStatus", id, "sortOrder", created
         FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [randomUUID(), "Concurrent B", "Concurrent answer B"],
    ),
  ]);
  assert.deepEqual(
    concurrent.flat().map((row) => row.resultStatus).sort(),
    ["LIMIT_REACHED", "OK"],
    "the parent-row lock must admit exactly one concurrent twentieth row",
  );
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS value
       FROM public."SellerFaq"
      WHERE "sellerProfileId" = $1`,
    [ownerSellerId],
  ))[0]?.value), 20);

  const exportRows = await runtimeQuery(
    database,
    ownerId,
    `SELECT id, question, answer, "sortOrder", "createdAt"
       FROM public.grainline_seller_faq_owner_export()`,
  );
  assert.equal(exportRows.length, 20);
  assert.equal(exportRows[0].id, firstId);
  assert.equal(exportRows[0].question, twoHundredCodePoints);
  assert.ok(exportRows.every((row, index) => (
    index === 0 || row.sortOrder >= exportRows[index - 1].sortOrder
  )));
  assert.deepEqual(
    await runtimeQuery(
      database,
      otherId,
      `SELECT id FROM public.grainline_seller_faq_owner_export()`,
    ),
    [],
  );

  const publicRows = await runtimeQuery(
    database,
    null,
    `SELECT faqs FROM public.grainline_seller_public_profile($1)`,
    [ownerSellerId],
  );
  assert.equal(publicRows.length, 1);
  assert.equal(publicRows[0].faqs.length, 20);
  const ownerEditorRows = await runtimeQuery(
    database,
    ownerId,
    `SELECT state FROM public.grainline_seller_owner_profile_editor_state($1)`,
    [ownerSellerId],
  );
  assert.equal(ownerEditorRows.length, 1);
  assert.equal(ownerEditorRows[0].state.faqs.length, 20);

  await database.query(
    `UPDATE public."User" SET banned = true, "updatedAt" = $2 WHERE id = $1`,
    [otherId, now],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      otherId,
      `SELECT * FROM public.grainline_seller_faq_owner_create($1,$2,$3)`,
      [randomUUID(), "Banned question", "Banned answer"],
    ),
    (error) => error?.code === "42501",
  );

  const otherFaqId = randomUUID();
  await database.query(
    `INSERT INTO public."SellerFaq"
       (id, "sellerProfileId", question, answer, "sortOrder", "createdAt")
     VALUES ($1, $2, 'Other question', 'Other answer', 1, $3)`,
    [otherFaqId, otherSellerId, now],
  );
  const sideEffectId = `seller_faq_delete_${suffix}`;
  const claimToken = randomUUID();
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status, attempts,
        "claimGeneration", "claimToken", "processingStartedAt", "nextAttemptAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2::varchar(191), 'LOCAL_ANONYMIZE',
             'account-delete:local:' || $2::text,
             '{}'::jsonb, 'PROCESSING', 1, 1, $3::uuid, $4, NULL, $4, $4)`,
    [sideEffectId, ownerId, claimToken, now],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      otherId,
      `SELECT public.grainline_seller_faq_account_deletion_cleanup($1,$2,1,$3::uuid)`,
      [sideEffectId, ownerId, claimToken],
    ),
    (error) => error?.code === "42501",
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      ownerId,
      `SELECT public.grainline_seller_faq_account_deletion_cleanup(
         $1,$2,1,$3::uuid
       ) AS value`,
      [sideEffectId, ownerId, claimToken],
    ),
    [{ value: 20 }],
  );
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS value
       FROM public."SellerFaq"
      WHERE "sellerProfileId" = $1`,
    [ownerSellerId],
  ))[0]?.value), 0);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS value
       FROM public."SellerFaq"
      WHERE id = $1`,
    [otherFaqId],
  ))[0]?.value), 1, "claimed cleanup must not touch another seller's row");

  const posture = rowsOf(await database.query(`
    SELECT relation.relrowsecurity,
           relation.relforcerowsecurity,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'DELETE'
           ) AS runtime_delete
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."SellerFaq"'::pg_catalog.regclass
  `));
  assert.deepEqual(posture, [{
    relrowsecurity: false,
    relforcerowsecurity: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_delete: true,
  }], "compatible preparation must preserve predecessor direct access");
}
