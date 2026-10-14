import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;

function databaseUrl() {
  const value = process.env.ACCOUNT_DELETION_POST_RETIREMENT_PROOF_DATABASE_URL;
  if (!value) {
    throw new Error(
      "ACCOUNT_DELETION_POST_RETIREMENT_PROOF_DATABASE_URL is required",
    );
  }
  return value;
}

async function proveDeletion(client, fixture) {
  const { userId, sideEffectId, sellerProfileId } = fixture;

  await client.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, "shippingName", "shippingLine1",
       "shippingCity", "shippingState", "shippingPostalCode", "shippingPhone"
     ) VALUES ($1, $2, $3, $4, $4, '1 Proof Lane', 'Austin', 'TX', '78701', '+15125550101')`,
    [userId, `clerk_${userId}`, `${userId}@example.test`, fixture.name],
  );

  if (sellerProfileId) {
    await client.query(
      `INSERT INTO public."SellerProfile" (
         id, "userId", "displayName", "displayNameNormalized", city, state,
         tagline
       ) VALUES ($1, $2, $3, $4, 'Austin', 'TX', 'Proof seller tagline')`,
      [sellerProfileId, userId, `${fixture.name} Shop`, `${fixture.name.toLowerCase()} shop`],
    );
    const privateUpdate = await client.query(
      `UPDATE public."SellerProfilePrivate"
          SET "shipFromName" = $2,
              "shipFromLine1" = '2 Proof Seller Lane',
              "shipFromCity" = 'Austin',
              "shipFromState" = 'TX',
              "shipFromPostal" = '78702',
              "shipFromCountry" = 'US',
              "shipFromPhone" = '+15125550102',
              "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
        WHERE "sellerProfileId" = $1`,
      [sellerProfileId, fixture.name],
    );
    assert.equal(privateUpdate.rowCount, 1, "seller private initializer must create one row");
  }

  await client.query(
    `INSERT INTO public."AccountDeletionSideEffect" (
       id, "userId", kind, "dedupKey", payload, status
     ) VALUES ($1, $2, 'LOCAL_ANONYMIZE', $3, '{}'::jsonb, 'PENDING')`,
    [sideEffectId, userId, `account-delete:local:${userId}`],
  );

  const claim = await client.query(
    "SELECT * FROM public.grainline_account_deletion_side_effect_claim($1)",
    [sideEffectId],
  );
  assert.equal(claim.rows.length, 1);
  assert.equal(claim.rows[0].action, "process");
  assert.equal(claim.rows[0].side_effect_id, sideEffectId);
  assert.equal(claim.rows[0].user_id, userId);
  assert.equal(claim.rows[0].effect_kind, "LOCAL_ANONYMIZE");
  const generation = claim.rows[0].claim_generation;
  const token = claim.rows[0].claim_token;
  assert.ok(generation);
  assert.match(token, /^[0-9a-f-]{36}$/u);

  const preflight = await client.query(
    `SELECT * FROM public.grainline_user_account_deletion_preflight(
       $1, $2::bigint, $3::uuid
     )`,
    [sideEffectId, generation, token],
  );
  assert.equal(preflight.rows.length, 1);
  assert.equal(preflight.rows[0].userId, userId);
  assert.equal(preflight.rows[0].sellerProfileId, sellerProfileId ?? null);

  const snapshot = await client.query(
    `SELECT * FROM public.grainline_user_account_deletion_snapshot(
       $1, $2::bigint, $3::uuid
     )`,
    [sideEffectId, generation, token],
  );
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].userId, userId);
  assert.equal(snapshot.rows[0].sellerProfileId, sellerProfileId ?? null);

  await client.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [userId]);

  const caseRedaction = await client.query(
    `SELECT * FROM public.grainline_case_account_deletion_redact(
       $1, $2::bigint, $3::uuid
     )`,
    [sideEffectId, generation, token],
  );
  assert.equal(caseRedaction.rows.length, 1);

  const messageRedaction = await client.query(
    `SELECT * FROM public.grainline_message_redact_for_account_deletion(
       $1, $2, $3::bigint, $4::uuid
     )`,
    [sideEffectId, userId, generation, token],
  );
  assert.equal(messageRedaction.rows.length, 1);

  const orderScrub = await client.query(
    `SELECT * FROM public.grainline_order_account_deletion_scrub(
       $1, $2, $3::bigint, $4::uuid, ARRAY[]::text[]
     )`,
    [sideEffectId, userId, generation, token],
  );
  assert.equal(orderScrub.rows.length, 1);
  assert.equal(Number(orderScrub.rows[0].buyer_orders_scrubbed), 0);
  assert.equal(Number(orderScrub.rows[0].seller_orders_scrubbed), 0);

  const finalized = await client.query(
    `SELECT * FROM public.grainline_user_account_deletion_finalize(
       $1, $2::bigint, $3::uuid
     )`,
    [sideEffectId, generation, token],
  );
  assert.equal(finalized.rows.length, 1);
  assert.equal(finalized.rows[0].userId, userId);
  assert.ok(finalized.rows[0].deletedAt);

  const completed = await client.query(
    `SELECT public.grainline_account_deletion_side_effect_complete(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [sideEffectId, generation, token],
  );
  assert.equal(completed.rows[0].result, "completed");

  const stored = await client.query(
    `SELECT account_user."deletedAt", account_user.email,
            effect.status, effect.payload
       FROM public."User" AS account_user
       JOIN public."AccountDeletionSideEffect" AS effect
         ON effect."userId" = account_user.id
      WHERE account_user.id = $1 AND effect.id = $2`,
    [userId, sideEffectId],
  );
  assert.equal(stored.rows.length, 1);
  assert.ok(stored.rows[0].deletedAt);
  assert.match(stored.rows[0].email, /^deleted\+/u);
  assert.equal(stored.rows[0].status, "DONE");
  assert.deepEqual(stored.rows[0].payload, {});
}

const pool = new Pool({ connectionString: databaseUrl(), max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await proveDeletion(client, {
    userId: "ci-post-retirement-buyer",
    sideEffectId: "ci-post-retirement-buyer-effect",
    sellerProfileId: null,
    name: "CI Buyer",
  });
  await client.query("ROLLBACK");

  await client.query("BEGIN");
  await proveDeletion(client, {
    userId: "ci-post-retirement-seller",
    sideEffectId: "ci-post-retirement-seller-effect",
    sellerProfileId: "ci-post-retirement-seller-profile",
    name: "CI Seller",
  });
  await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}

process.stdout.write("Account deletion post-retirement buyer/seller proof passed\n");
