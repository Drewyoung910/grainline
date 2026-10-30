import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const USER_REPORT_PREPARATION_MIGRATION =
  "20261028060000_prepare_user_report_authorities";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function setActor(database, userId) {
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [userId ?? ""],
  );
}

export async function seedUserReportPredecessorFixture({ database, seller }) {
  const suffix = `user_report_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const reporterId = `${suffix}_reporter`;
  const reviewAuthorId = `${suffix}_review_author`;
  const staffId = `${suffix}_staff`;
  const listingId = `${suffix}_listing`;
  const reviewId = `${suffix}_review`;
  const now = new Date("2026-10-28T14:00:00.000Z");

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Report author', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($4, $5, $6, 'Review author', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($7, $8, $9, 'Report staff', 'EMPLOYEE', $10, $10, $10, '2026-01-01', $10)`,
    [
      reporterId,
      `user_${reporterId}`.slice(0, 191),
      `${reporterId}@example.test`.slice(0, 191),
      reviewAuthorId,
      `user_${reviewAuthorId}`.slice(0, 191),
      `${reviewAuthorId}@example.test`.slice(0, 191),
      staffId,
      `user_${staffId}`.slice(0, 191),
      `${staffId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'User report authority listing', 'UserReport full-chain proof',
        8500, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Review"
      (id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2",
       verified, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, 10, true, $4, $4)`,
    [reviewId, listingId, reviewAuthorId, now],
  );

  await setActor(database, reporterId);
  await database.query("SET ROLE grainline_app_runtime");
  let sellerMisattributionAccepted;
  try {
    sellerMisattributionAccepted = rowsOf(await database.query(
      `SELECT public.grainline_seller_actor_report_resource_target(
         'REVIEW', $1, $2
       ) AS value`,
      [reviewId, seller.userId],
    ))[0]?.value;
  } finally {
    await database.query("RESET ROLE");
    await setActor(database, null);
  }
  assert.equal(
    sellerMisattributionAccepted,
    true,
    "predecessor must reproduce review attribution to the seller",
  );

  return Object.freeze({
    suffix,
    reporterId,
    reviewAuthorId,
    staffId,
    reviewId,
    sellerUserId: seller.userId,
    predecessor: Object.freeze({ sellerMisattributionAccepted }),
  });
}

export async function proveUserReportPreparedAuthorities({ database, fixture }) {
  assert.deepEqual(fixture.predecessor, { sellerMisattributionAccepted: true });

  assert.deepEqual(rowsOf(await database.query(`
    SELECT class.relrowsecurity AS enabled,
           class.relforcerowsecurity AS forced,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'SELECT') AS "runtimeSelect",
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'INSERT') AS "runtimeInsert",
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'UPDATE') AS "runtimeUpdate",
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS "runtimeDelete"
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."UserReport"'::pg_catalog.regclass
  `))[0], {
    enabled: false,
    forced: false,
    runtimeSelect: true,
    runtimeInsert: true,
    runtimeUpdate: true,
    runtimeDelete: true,
  });

  const functionRows = rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
           routine.proconfig AS config,
           pg_catalog.has_function_privilege('grainline_app_runtime', routine.oid, 'EXECUTE') AS "runtimeExecute",
           pg_catalog.has_function_privilege('grainline_staff_read_runtime', routine.oid, 'EXECUTE') AS "staffExecute",
           EXISTS (
             SELECT 1 FROM pg_catalog.aclexplode(
               COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
             ) AS acl
              WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.proname LIKE 'grainline_user_report_%'
     ORDER BY routine.proname
  `));
  assert.equal(functionRows.length, 8);
  for (const row of functionRows) {
    const staffOperation = row.name.startsWith("grainline_user_report_staff_");
    assert.equal(row.securityDefiner, true, row.name);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.name);
    assert.equal(row.runtimeExecute, !staffOperation, row.name);
    assert.equal(row.staffExecute, staffOperation, row.name);
    assert.equal(row.publicExecute, false, row.name);
  }

  await database.query("SET ROLE grainline_app_runtime");
  let firstReport;
  let secondReport;
  try {
    await setActor(database, null);
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_user_report_submit(
           $1, $2, 'OTHER', NULL, NULL, NULL
         )`,
        [`${fixture.suffix}_no_actor`, fixture.reviewAuthorId],
      ),
      (error) => error?.code === "22023",
    );

    await setActor(database, fixture.reporterId);
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_user_report_submit(
           $1, $2, 'INAPPROPRIATE', 'Wrong attribution', 'REVIEW', $3
         )`,
        [`${fixture.suffix}_wrong_review`, fixture.sellerUserId, fixture.reviewId],
      ),
      (error) => error?.code === "22023",
    );
    firstReport = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_submit(
         $1, $2, 'INAPPROPRIATE', 'Participant-visible report details',
         'REVIEW', $3
       )`,
      [`${fixture.suffix}_review_report`, fixture.reviewAuthorId, fixture.reviewId],
    ))[0];
    secondReport = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_submit(
         $1, $2, 'OTHER', NULL, NULL, NULL
       )`,
      [`${fixture.suffix}_generic_report`, fixture.reviewAuthorId],
    ))[0];
    assert.equal(firstReport.reportedId, fixture.reviewAuthorId);
    assert.equal(secondReport.targetType, null);

    const submitted = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_owner_submitted_export()`,
    ));
    assert.deepEqual(
      new Set(submitted.map((row) => row.id)),
      new Set([firstReport.reportId, secondReport.reportId]),
    );
    assert.equal(submitted.find((row) => row.id === firstReport.reportId).details,
      "Participant-visible report details");
    await assert.rejects(
      database.query(
        `SELECT public.grainline_user_report_staff_open_count($1) AS value`,
        [fixture.staffId],
      ),
      /permission denied/u,
    );
  } finally {
    await setActor(database, null);
    await database.query("RESET ROLE");
  }

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    assert.equal(Number(rowsOf(await database.query(
      `SELECT public.grainline_user_report_staff_open_count($1) AS value`,
      [fixture.staffId],
    ))[0].value), 2);
    const firstPage = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_staff_open_page($1, NULL, NULL, 1)`,
      [fixture.staffId],
    ));
    const secondPage = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_staff_open_page($1, $2, $3, 1)`,
      [fixture.staffId, firstPage[0].createdAt, firstPage[0].id],
    ));
    assert.equal(firstPage.length, 1);
    assert.equal(secondPage.length, 1);
    assert.notEqual(secondPage[0].id, firstPage[0].id);
    const topReporters = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_staff_top_reporters(
         $1, '2026-01-01 00:00:00'::timestamp, 5
       )`,
      [fixture.staffId],
    ));
    assert.deepEqual(topReporters.map((row) => ({
      reporterId: row.reporterId,
      value: Number(row.value),
    })), [{ reporterId: fixture.reporterId, value: 2 }]);
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_user_report_staff_resolve(
         $1, $2, 'Reviewed and closed for both participants.',
         'Internal staff-only evidence reference GL-42.'
       ) AS value`,
      [fixture.staffId, firstReport.reportId],
    ))[0].value, "UPDATED");
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_user_report_staff_resolve(
         $1, $2, 'Duplicate resolution attempt.', NULL
       ) AS value`,
      [fixture.staffId, firstReport.reportId],
    ))[0].value, "UNCHANGED");
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "resolutionNote", "internalResolutionNote"
       FROM public."UserReport" WHERE id = $1`,
    [firstReport.reportId],
  ))[0], {
    resolutionNote: "Reviewed and closed for both participants.",
    internalResolutionNote: "Internal staff-only evidence reference GL-42.",
  });
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."AdminAuditLog"
      WHERE action = 'RESOLVE_REPORT'
        AND "targetType" = 'UserReport'
        AND "targetId" = $1`,
    [firstReport.reportId],
  ))[0].count), 1);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await setActor(database, fixture.reviewAuthorId);
    const received = rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_owner_received_export()`,
    ));
    const resolved = received.find((row) => row.id === firstReport.reportId);
    assert.equal(resolved.resolutionNote,
      "Reviewed and closed for both participants.");
    assert.equal(Object.hasOwn(resolved, "details"), false);
    assert.equal(Object.hasOwn(resolved, "internalResolutionNote"), false);
  } finally {
    await setActor(database, null);
    await database.query("RESET ROLE");
  }

  const deletionSideEffectId = `${fixture.suffix}_deletion`;
  const deletionClaimToken = randomUUID();
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect" (
       id, "userId", kind, "dedupKey", payload, status, attempts,
       "claimGeneration", "claimToken", "processingStartedAt",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'LOCAL_ANONYMIZE', $3, '{}'::jsonb, 'PROCESSING', 1,
       1, $4::uuid, pg_catalog.clock_timestamp(),
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [
      deletionSideEffectId,
      fixture.reviewAuthorId,
      `account-delete:local:${fixture.reviewAuthorId}`,
      deletionClaimToken,
    ],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await setActor(database, fixture.reviewAuthorId);
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_user_report_account_deletion_redact(
           $1, 2, $2::uuid
         )`,
        [deletionSideEffectId, deletionClaimToken],
      ),
      /claim is not authorized/u,
      "a stale deletion generation must not redact report evidence",
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_user_report_account_deletion_redact(
         $1, 1, $2::uuid
       )`,
      [deletionSideEffectId, deletionClaimToken],
    )), [{
      userId: fixture.reviewAuthorId,
      detailsRedacted: 1,
      resolvedNotesRedacted: 1,
      reportsAutoResolved: 1,
    }]);
  } finally {
    await setActor(database, null);
    await database.query("RESET ROLE");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, details, resolved, "resolutionNote", "internalResolutionNote"
       FROM public."UserReport"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [[firstReport.reportId, secondReport.reportId]],
  )), [
    {
      id: secondReport.reportId,
      details: null,
      resolved: true,
      resolutionNote: "Auto-resolved after the reported account was deleted.",
      internalResolutionNote: null,
    },
    {
      id: firstReport.reportId,
      details: null,
      resolved: true,
      resolutionNote: "Resolution note removed after an involved account was deleted.",
      internalResolutionNote: null,
    },
  ].sort((left, right) => left.id.localeCompare(right.id)));

  await database.query(
    `DELETE FROM public."AccountDeletionSideEffect" WHERE id = $1`,
    [deletionSideEffectId],
  );
}
