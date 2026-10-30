import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

import { runPsqlScript } from "./psql-script.mjs";

export const REVIEW_VOTE_PREPARATION_MIGRATION =
  "20261028030000_prepare_review_vote_authorities";
export const REVIEW_VOTE_RLS_MIGRATION =
  "20261028070000_activate_review_vote_rls";

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
    return result;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function callToggle(database, actorId, reviewId) {
  return rowsOf(await runtimeQuery(
    database,
    actorId,
    "SELECT * FROM public.grainline_review_vote_owner_toggle($1)",
    [reviewId],
  ));
}

async function beginRuntime(client, actorId, lockTimeout = null) {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  if (lockTimeout) await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
  await client.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, true)",
    [actorId ?? ""],
  );
}

async function waitForBackendLock(database, backendPid, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = rowsOf(await database.query(
      `SELECT wait_event_type AS "waitEventType",
              wait_event AS "waitEvent"
         FROM pg_catalog.pg_stat_activity
        WHERE pid = $1`,
      [backendPid],
    ))[0];
    if (state?.waitEventType === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`${label} did not reach its expected database lock wait`);
}

async function proveMixedVersionSerialization({
  connectionString,
  database,
  actorId,
  reviewId,
  reviewerId,
  sellerProfileId,
  sellerUserId,
}) {
  const first = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await Promise.all([first.connect(), second.connect()]);
  try {
    await beginRuntime(first, actorId);
    assert.deepEqual((await first.query(
      "SELECT * FROM public.grainline_review_vote_owner_toggle($1)",
      [reviewId],
    )).rows, [{ resultStatus: "OK", voted: true, helpfulCount: 1 }]);

    await beginRuntime(second, actorId, "250ms");
    await assert.rejects(
      second.query(
        "SELECT * FROM public.grainline_review_vote_owner_toggle($1)",
        [reviewId],
      ),
      (error) => error?.code === "55P03",
      "two fixed toggles must serialize on the actor lock",
    );
    await second.query("ROLLBACK");
    await first.query("COMMIT");
    assert.deepEqual(await callToggle(database, actorId, reviewId), [{
      resultStatus: "OK",
      voted: false,
      helpfulCount: 0,
    }]);

    // Simulate the predecessor route: ReviewVote first, then its own scalar
    // increment. The new operation must wait rather than deadlock or double it.
    await beginRuntime(first, actorId);
    await first.query(
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [reviewId, actorId],
    );
    await first.query(
      `UPDATE public."Review"
          SET "helpfulCount" = "helpfulCount" + 1
        WHERE id = $1`,
      [reviewId],
    );

    await beginRuntime(second, actorId, "250ms");
    await assert.rejects(
      second.query(
        "SELECT * FROM public.grainline_review_vote_owner_toggle($1)",
        [reviewId],
      ),
      (error) => error?.code === "55P03",
      "the fixed operation must wait behind an in-flight predecessor write",
    );
    await second.query("ROLLBACK");
    await first.query("COMMIT");
    assert.deepEqual(await callToggle(database, actorId, reviewId), [{
      resultStatus: "OK",
      voted: false,
      helpfulCount: 0,
    }]);

    // A predecessor insert must re-read reviewer eligibility after waiting on
    // the canonical User locks. Otherwise a concurrent reviewer ban can commit
    // while the trigger waits and the stale insert can still create a vote.
    await first.query("BEGIN");
    await first.query(
      `SELECT 1 FROM public."User" WHERE id = $1 FOR UPDATE`,
      [reviewerId],
    );
    const reviewerRacePid = Number((await second.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0]?.pid);
    await beginRuntime(second, actorId);
    await second.query("SET LOCAL statement_timeout = '5s'");
    const staleReviewerInsert = second.query(
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [reviewId, actorId],
    );
    await waitForBackendLock(
      database,
      reviewerRacePid,
      "predecessor insert behind reviewer account transition",
    );
    await first.query(
      `UPDATE public."User" SET banned = true WHERE id = $1`,
      [reviewerId],
    );
    await first.query(
      `UPDATE public."Review"
          SET "reviewerAccountActive" = false
        WHERE id = $1`,
      [reviewId],
    );
    await first.query("COMMIT");
    await assert.rejects(
      staleReviewerInsert,
      (error) => error?.code === "23503",
      "a predecessor insert must reject reviewer state that changed while it waited",
    );
    await second.query("ROLLBACK");
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS value
         FROM public."ReviewVote"
        WHERE "reviewId" = $1 AND "userId" = $2`,
      [reviewId, actorId],
    ))[0]?.value), 0);
    await database.query(
      `UPDATE public."User" SET banned = false WHERE id = $1`,
      [reviewerId],
    );
    await database.query(
      `UPDATE public."Review"
          SET "reviewerAccountActive" = true
        WHERE id = $1`,
      [reviewId],
    );

    // Account deletion holds the seller User row before it pauses the
    // SellerProfile. A predecessor vote insert must wait on that User without
    // retaining a SellerProfile lock, or the two transactions deadlock.
    await first.query("BEGIN");
    await first.query("SET LOCAL lock_timeout = '750ms'");
    await first.query(
      `SELECT 1 FROM public."User" WHERE id = $1 FOR UPDATE`,
      [sellerUserId],
    );
    const deletionRacePid = Number((await second.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0]?.pid);
    await beginRuntime(second, actorId);
    await second.query("SET LOCAL statement_timeout = '5s'");
    const insertBehindDeletion = second.query(
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [reviewId, actorId],
    );
    await waitForBackendLock(
      database,
      deletionRacePid,
      "predecessor insert behind seller account deletion",
    );
    await first.query(
      `UPDATE public."SellerProfile"
          SET "vacationMode" = "vacationMode"
        WHERE id = $1`,
      [sellerProfileId],
    );
    await first.query("COMMIT");
    await insertBehindDeletion;
    await second.query("ROLLBACK");
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS value
         FROM public."ReviewVote"
        WHERE "reviewId" = $1 AND "userId" = $2`,
      [reviewId, actorId],
    ))[0]?.value), 0);
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
}

async function proveConcurrentOwnerDeleteAll({
  connectionString,
  database,
  firstActorId,
  secondActorId,
  reviewIds,
}) {
  const first = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await Promise.all([first.connect(), second.connect()]);
  try {
    await beginRuntime(first, firstActorId);
    assert.deepEqual((await first.query(
      "SELECT public.grainline_review_vote_owner_delete_all() AS value",
    )).rows, [{ value: 2 }]);

    await beginRuntime(second, secondActorId, "250ms");
    await assert.rejects(
      second.query(
        "SELECT public.grainline_review_vote_owner_delete_all() AS value",
      ),
      (error) => error?.code === "55P03",
      "bulk owner deletion must serialize on sorted affected Review locks",
    );
    await second.query("ROLLBACK");
    await first.query("COMMIT");

    assert.deepEqual(rowsOf(await runtimeQuery(
      database,
      secondActorId,
      "SELECT public.grainline_review_vote_owner_delete_all() AS value",
    )), [{ value: 2 }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT id, "helpfulCount" AS count
         FROM public."Review"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [reviewIds],
    )), reviewIds
      .map((id) => ({ id, count: 0 }))
      .sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
}

async function readReviewVotePosture(database) {
  return rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.array_agg(
                     policy.polname::text || ':' || policy.polcmd::text
                     ORDER BY policy.polname
                   )
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policies,
           (SELECT pg_catalog.array_agg(
                     trigger_state.tgname::text || ':' || trigger_state.tgtype::text
                     ORDER BY trigger_state.tgname
                   )
              FROM pg_catalog.pg_trigger AS trigger_state
             WHERE trigger_state.tgrelid = class.oid
               AND NOT trigger_state.tgisinternal) AS triggers
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'ReviewVote'
       AND class.relkind = 'r'
  `))[0];
}

async function proveReviewVoteRollback({ database, repositoryRoot, actorId, reviewId }) {
  const rollback = readFileSync(
    join(repositoryRoot, "docs/rls-drafts/review-vote-activation-rollback.sql"),
    "utf8",
  );
  await runPsqlScript(database, rollback, {
    runtime_role: "grainline_app_runtime",
    migration_role: "ci",
  });
  assert.deepEqual(await readReviewVotePosture(database), {
    rls_enabled: false,
    rls_forced: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    policies: null,
    triggers: [
      "ReviewVote_insert_guard:7",
      "ReviewVote_update_forbidden:19",
    ],
  });

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    actorId,
    `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
     VALUES ($1, $2, 1)
     RETURNING "reviewId", "userId"`,
    [reviewId, actorId],
  )), [{ reviewId, userId: actorId }]);
  await database.query(
    `UPDATE public."Review"
        SET "helpfulCount" = "helpfulCount" + 1
      WHERE id = $1`,
    [reviewId],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    "unrelated-predecessor-reader",
    `SELECT "reviewId", "userId"
       FROM public."ReviewVote"
      WHERE "reviewId" = $1`,
    [reviewId],
  )), [{ reviewId, userId: actorId }]);
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      `UPDATE public."ReviewVote" SET value = 1
        WHERE "reviewId" = $1 AND "userId" = $2`,
      [reviewId, actorId],
    ),
    (error) => error?.code === "42501",
    "rollback must retain the preparation immutable-row trigger",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    "unrelated-predecessor-writer",
    `DELETE FROM public."ReviewVote"
      WHERE "reviewId" = $1 AND "userId" = $2
      RETURNING "userId"`,
    [reviewId, actorId],
  )), [{ userId: actorId }]);
  await database.query(
    `UPDATE public."Review"
        SET "helpfulCount" = "helpfulCount" - 1
      WHERE id = $1`,
    [reviewId],
  );
}

export async function proveReviewVoteAuthorities({
  connectionString,
  database,
  repositoryRoot,
  seller,
}) {
  const suffix = `review_vote_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const actorId = `${suffix}_actor`;
  const reviewerId = `${suffix}_reviewer`;
  const cascadeActorId = `${suffix}_cascade`;
  const listingId = `${suffix}_listing`;
  const secondListingId = `${suffix}_listing_two`;
  const cascadeListingId = `${suffix}_listing_cascade`;
  const reviewId = `${suffix}_review`;
  const secondReviewId = `${suffix}_review_two`;
  const selfReviewId = `${suffix}_self_review`;
  const cascadeReviewId = `${suffix}_cascade_review`;
  const now = "2026-10-28 12:00:00";

  const catalog = rowsOf(await database.query(`
    SELECT routine.oid::regprocedure::text AS signature,
           routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure('public.grainline_review_vote_owner_toggle(text)'),
       pg_catalog.to_regprocedure('public.grainline_review_vote_owner_export()'),
       pg_catalog.to_regprocedure('public.grainline_review_vote_owner_delete_all()'),
       pg_catalog.to_regprocedure('public.grainline_review_vote_insert_guard()'),
       pg_catalog.to_regprocedure('public.grainline_review_vote_update_forbidden()'),
       pg_catalog.to_regprocedure('public.grainline_review_vote_count_after_delete()')
     )
     ORDER BY signature
  `));
  assert.equal(catalog.length, 6);
  assert.ok(catalog.every((row) => (
    row.securityDefiner === true
    && row.config?.includes("search_path=pg_catalog")
  )));
  assert.ok(catalog.every((row) => (
    row.signature.startsWith("grainline_review_vote_owner_")
      ? row.runtimeExecute === true
      : row.runtimeExecute === false
  )));
  assert.deepEqual(rowsOf(await database.query(`
    SELECT tgname AS name, tgtype AS type
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public."ReviewVote"'::pg_catalog.regclass
       AND NOT tgisinternal
     ORDER BY tgname
  `)), [
    { name: "ReviewVote_count_after_delete", type: 8 },
    { name: "ReviewVote_insert_guard", type: 7 },
    { name: "ReviewVote_update_forbidden", type: 19 },
  ]);
  const activatedPosture = {
    rls_enabled: true,
    rls_forced: true,
    runtime_select: true,
    runtime_insert: false,
    runtime_update: false,
    runtime_delete: false,
    policies: ["review_vote_owner_select:r"],
    triggers: [
      "ReviewVote_count_after_delete:8",
      "ReviewVote_insert_guard:7",
      "ReviewVote_update_forbidden:19",
    ],
  };
  assert.deepEqual(await readReviewVotePosture(database), activatedPosture);
  const constraints = rowsOf(await database.query(`
    SELECT constraint_entry.conname AS name,
           constraint_entry.convalidated AS validated,
           pg_catalog.pg_get_constraintdef(constraint_entry.oid, true) AS definition
      FROM pg_catalog.pg_constraint AS constraint_entry
     WHERE constraint_entry.conname IN (
       'ReviewVote_value_one_chk',
       'Review_helpfulCount_nonnegative_chk'
     )
     ORDER BY constraint_entry.conname
  `));
  assert.deepEqual(constraints.map((entry) => [entry.name, entry.validated]), [
    ["ReviewVote_value_one_chk", true],
    ["Review_helpfulCount_nonnegative_chk", true],
  ]);
  assert.match(
    constraints.find((entry) => entry.name === "ReviewVote_value_one_chk")?.definition ?? "",
    /CHECK \(value = 1\)/,
  );
  assert.match(
    constraints.find((entry) => entry.name === "Review_helpfulCount_nonnegative_chk")?.definition ?? "",
    /CHECK \("helpfulCount" >= 0\)/,
  );
  const ownerIndex = rowsOf(await database.query(`
    SELECT index_entry.indisvalid AS valid,
           index_entry.indisready AS ready,
           pg_catalog.pg_get_indexdef(index_entry.indexrelid) AS definition
      FROM pg_catalog.pg_index AS index_entry
     WHERE index_entry.indexrelid =
       'public."ReviewVote_userId_createdAt_reviewId_idx"'::pg_catalog.regclass
  `));
  assert.equal(ownerIndex.length, 1);
  assert.equal(ownerIndex[0]?.valid, true);
  assert.equal(ownerIndex[0]?.ready, true);
  assert.match(
    ownerIndex[0]?.definition ?? "",
    /\("userId", "createdAt" DESC, "reviewId"\)$/,
  );

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Review vote actor', $10, $10, $10, '2026-01-01', $10),
       ($4, $5, $6, 'Review vote reviewer', $10, $10, $10, '2026-01-01', $10),
       ($7, $8, $9, 'Review vote cascade actor', $10, $10, $10, '2026-01-01', $10)`,
    [
      actorId,
      `clerk_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 254),
      reviewerId,
      `clerk_${reviewerId}`.slice(0, 191),
      `${reviewerId}@example.test`.slice(0, 254),
      cascadeActorId,
      `clerk_${cascadeActorId}`.slice(0, 191),
      `${cascadeActorId}@example.test`.slice(0, 254),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "createdAt", "updatedAt")
     VALUES
       ($1, $3, 'Review vote listing', 'Full-chain review vote fixture', 1000,
        'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $4, $4),
       ($2, $3, 'Review vote listing two', 'Full-chain review vote fixture', 1000,
        'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $4, $4),
       ($5, $3, 'Review vote cascade listing', 'Full-chain review vote fixture', 1000,
        'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $4, $4)`,
    [listingId, secondListingId, seller.sellerProfileId, now, cascadeListingId],
  );
  await database.query(
    `INSERT INTO public."Review"
      (id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2",
       verified, "helpfulCount", "createdAt", "updatedAt")
     VALUES
       ($1, $5, $7, true, 10, true, 0, $9, $9),
       ($2, $6, $7, true, 8, true, 0, $9, $9),
       ($3, $6, $8, true, 8, true, 0, $9, $9),
       ($4, $10, $7, true, 8, true, 0, $9, $9)`,
    [
      reviewId,
      secondReviewId,
      selfReviewId,
      cascadeReviewId,
      listingId,
      secondListingId,
      reviewerId,
      actorId,
      now,
      cascadeListingId,
    ],
  );

  await assert.rejects(
    runtimeQuery(
      database,
      null,
      "SELECT * FROM public.grainline_review_vote_owner_toggle($1)",
      [reviewId],
    ),
    (error) => error?.code === "42501",
  );
  assert.deepEqual(await callToggle(database, actorId, "missing-review"), [{
    resultStatus: "NOT_FOUND",
    voted: false,
    helpfulCount: 0,
  }]);
  assert.deepEqual(await callToggle(database, actorId, selfReviewId), [{
    resultStatus: "SELF",
    voted: false,
    helpfulCount: 0,
  }]);
  assert.deepEqual(await callToggle(database, seller.userId, reviewId), [{
    resultStatus: "OWN_LISTING",
    voted: false,
    helpfulCount: 0,
  }]);
  await assert.rejects(
    database.query(
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [selfReviewId, actorId],
    ),
    (error) => error?.code === "42501",
  );
  await assert.rejects(
    database.query(
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [reviewId, seller.userId],
    ),
    (error) => error?.code === "42501",
  );

  assert.deepEqual(await callToggle(database, actorId, reviewId), [{
    resultStatus: "OK",
    voted: true,
    helpfulCount: 1,
  }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    actorId,
    `SELECT "reviewId", "userId", value
       FROM public."ReviewVote"
      WHERE "reviewId" = $1`,
    [reviewId],
  )), [{ reviewId, userId: actorId, value: 1 }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    reviewerId,
    `SELECT "reviewId", "userId", value
       FROM public."ReviewVote"
      WHERE "reviewId" = $1`,
    [reviewId],
  )), []);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT "reviewId", "userId", value
       FROM public."ReviewVote"
      WHERE "reviewId" = $1`,
    [reviewId],
  )), []);
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [secondReviewId, actorId],
    ),
    (error) => error?.code === "42501",
    "activated ReviewVote must deny direct runtime INSERT",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      `UPDATE public."ReviewVote" SET value = 1
        WHERE "reviewId" = $1 AND "userId" = $2`,
      [reviewId, actorId],
    ),
    (error) => error?.code === "42501",
    "activated ReviewVote must deny direct runtime UPDATE",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      `DELETE FROM public."ReviewVote"
        WHERE "reviewId" = $1 AND "userId" = $2`,
      [reviewId, actorId],
    ),
    (error) => error?.code === "42501",
    "activated ReviewVote must deny direct runtime DELETE",
  );
  assert.deepEqual(await callToggle(database, actorId, reviewId), [{
    resultStatus: "OK",
    voted: false,
    helpfulCount: 0,
  }]);

  await database.query(
    `UPDATE public."Listing" SET "archivedAt" = $2 WHERE id = $1`,
    [listingId, now],
  );
  assert.equal((await callToggle(database, actorId, reviewId))[0]?.resultStatus, "NOT_FOUND");
  await database.query(
    `UPDATE public."Listing" SET "archivedAt" = NULL WHERE id = $1`,
    [listingId],
  );
  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = true,
            "reservedForUserId" = $2
      WHERE id = $1`,
    [listingId, reviewerId],
  );
  assert.equal((await callToggle(database, actorId, reviewId))[0]?.resultStatus, "NOT_FOUND");
  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = false,
            "reservedForUserId" = NULL
      WHERE id = $1`,
    [listingId],
  );
  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [reviewerId],
  );
  assert.equal((await callToggle(database, actorId, reviewId))[0]?.resultStatus, "NOT_FOUND");
  await database.query(
    `UPDATE public."User" SET banned = false WHERE id = $1`,
    [reviewerId],
  );
  await database.query(
    `UPDATE public."SellerProfile" SET "vacationMode" = true WHERE id = $1`,
    [seller.sellerProfileId],
  );
  assert.equal((await callToggle(database, actorId, reviewId))[0]?.resultStatus, "NOT_FOUND");
  await database.query(
    `UPDATE public."SellerProfile" SET "vacationMode" = false WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [actorId],
  );
  await assert.rejects(
    callToggle(database, actorId, reviewId),
    (error) => error?.code === "42501",
  );
  await database.query(
    `UPDATE public."User" SET banned = false, "deletedAt" = $2 WHERE id = $1`,
    [actorId, now],
  );
  await assert.rejects(
    callToggle(database, actorId, reviewId),
    (error) => error?.code === "42501",
  );
  await database.query(
    `UPDATE public."User" SET "deletedAt" = NULL WHERE id = $1`,
    [actorId],
  );

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${suffix}_reviewer_block`, actorId, reviewerId, now],
  );
  assert.deepEqual(await callToggle(database, actorId, reviewId), [{
    resultStatus: "NOT_FOUND",
    voted: false,
    helpfulCount: 0,
  }]);
  await database.query(
    `DELETE FROM public."Block" WHERE id = $1`,
    [`${suffix}_reviewer_block`],
  );
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${suffix}_seller_block`, seller.userId, actorId, now],
  );
  assert.deepEqual(await callToggle(database, actorId, reviewId), [{
    resultStatus: "NOT_FOUND",
    voted: false,
    helpfulCount: 0,
  }]);
  await database.query(
    `DELETE FROM public."Block" WHERE id = $1`,
    [`${suffix}_seller_block`],
  );

  assert.equal((await callToggle(database, actorId, reviewId))[0]?.voted, true);
  assert.equal((await callToggle(database, actorId, secondReviewId))[0]?.voted, true);
  const exported = rowsOf(await runtimeQuery(
    database,
    actorId,
    "SELECT * FROM public.grainline_review_vote_owner_export()",
  ));
  assert.deepEqual(exported.map((row) => row.reviewId).sort(), [reviewId, secondReviewId].sort());
  assert.ok(exported.every((row) => row.value === 1));

  assert.equal((await callToggle(database, cascadeActorId, reviewId))[0]?.voted, true);
  assert.equal((await callToggle(database, cascadeActorId, secondReviewId))[0]?.voted, true);
  await proveConcurrentOwnerDeleteAll({
    connectionString,
    database,
    firstActorId: actorId,
    secondActorId: cascadeActorId,
    reviewIds: [reviewId, secondReviewId],
  });

  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [cascadeActorId],
  );
  await assert.rejects(
    database.query(
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value, "createdAt")
       VALUES ($1, $2, 1, $3)`,
      [cascadeReviewId, cascadeActorId, now],
    ),
    (error) => error?.code === "42501",
  );
  await database.query(
    `UPDATE public."User" SET banned = false WHERE id = $1`,
    [cascadeActorId],
  );

  // The compatible predecessor still updates the scalar itself. Prove the
  // preparation guard does not also update it and therefore cannot double it.
  await database.query(
    `INSERT INTO public."ReviewVote" ("reviewId", "userId", value, "createdAt")
     VALUES ($1, $2, 1, $3)`,
    [cascadeReviewId, cascadeActorId, now],
  );
  assert.equal(Number(rowsOf(await database.query(
    `SELECT "helpfulCount" AS count FROM public."Review" WHERE id = $1`,
    [cascadeReviewId],
  ))[0]?.count), 0);
  await database.query(
    `UPDATE public."Review"
        SET "helpfulCount" = "helpfulCount" + 1
      WHERE id = $1`,
    [cascadeReviewId],
  );
  await assert.rejects(
    database.query(
      `UPDATE public."ReviewVote" SET value = 2
        WHERE "reviewId" = $1 AND "userId" = $2`,
      [cascadeReviewId, cascadeActorId],
    ),
    (error) => error?.code === "42501",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    cascadeActorId,
    "SELECT public.grainline_review_vote_owner_delete_all() AS value",
  )), [{ value: 1 }]);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT "helpfulCount" AS count FROM public."Review" WHERE id = $1`,
    [cascadeReviewId],
  ))[0]?.count), 0);

  assert.deepEqual(await callToggle(database, cascadeActorId, cascadeReviewId), [{
    resultStatus: "OK",
    voted: true,
    helpfulCount: 1,
  }]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [cascadeActorId]);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT "helpfulCount" AS count FROM public."Review" WHERE id = $1`,
    [cascadeReviewId],
  ))[0]?.count), 0);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."ReviewVote"
      WHERE "reviewId" = $1`,
    [cascadeReviewId],
  ))[0]?.count), 0);

  await database.query(
    `INSERT INTO public."ReviewVote" ("reviewId", "userId", value, "createdAt")
     VALUES ($1, $2, 1, $3)`,
    [cascadeReviewId, actorId, now],
  );
  await database.query(
    `UPDATE public."Review"
        SET "helpfulCount" = "helpfulCount" + 1
      WHERE id = $1`,
    [cascadeReviewId],
  );
  await database.query(`DELETE FROM public."Review" WHERE id = $1`, [cascadeReviewId]);

  const drift = rowsOf(await database.query(`
    SELECT review.id
      FROM public."Review" AS review
      LEFT JOIN LATERAL (
        SELECT pg_catalog.count(*)::integer AS value
          FROM public."ReviewVote" AS vote
         WHERE vote."reviewId" = review.id
      ) AS actual ON true
     WHERE review."helpfulCount" <> actual.value
       AND review.id = ANY($1::text[])
  `, [[reviewId, secondReviewId, selfReviewId]]));
  assert.deepEqual(drift, []);

  await proveReviewVoteRollback({
    database,
    repositoryRoot,
    actorId,
    reviewId,
  });
  await proveMixedVersionSerialization({
    connectionString,
    database,
    actorId,
    reviewId,
    reviewerId,
    sellerProfileId: seller.sellerProfileId,
    sellerUserId: seller.userId,
  });
  await runPsqlScript(
    database,
    readFileSync(
      join(
        repositoryRoot,
        "prisma/migrations/20261028070000_activate_review_vote_rls/migration.sql",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(await readReviewVotePosture(database), activatedPosture);
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      `INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
       VALUES ($1, $2, 1)`,
      [reviewId, actorId],
    ),
    (error) => error?.code === "42501",
    "reactivated ReviewVote must deny direct runtime writes",
  );

  await database.query(
    `DELETE FROM public."Review" WHERE id = ANY($1::text[])`,
    [[reviewId, secondReviewId, selfReviewId]],
  );
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[listingId, secondListingId, cascadeListingId]],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[actorId, reviewerId]],
  );
}
