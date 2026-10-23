import assert from "node:assert/strict";

import { storeProviderSuppressionWithoutWeakeningDirectEvidence } from "../../../src/lib/emailSuppressionWriteState.ts";

export const EMAIL_SUPPRESSION_RECOVERY_MIGRATION =
  "20261023040000_repair_resend_failed_event_suppressions";

export async function seedHistoricalResendFailureSuppressions(database) {
  const now = new Date("2026-10-23T10:00:00.000Z");
  const transientEmail = "full-chain-c715-transient@example.test";
  const hardBounceEmail = "full-chain-c715-hard-bounce@example.test";
  const complaintEmail = "full-chain-c715-complaint@example.test";

  await database.query(
    `INSERT INTO public."EmailSuppression"
      (id, email, reason, source, "eventId", details, "createdAt", "updatedAt")
     VALUES
      ('full_chain_c715_transient', $1, 'BOUNCE', 'resend_transient_failure',
       'evt_full_chain_c715_transient', '{}'::jsonb, $4, $4),
      ('full_chain_c715_hard', $2, 'BOUNCE', 'resend',
       'evt_full_chain_c715_hard', '{}'::jsonb, $4, $4),
      ('full_chain_c715_complaint', $3, 'COMPLAINT', 'resend',
       'evt_full_chain_c715_complaint', '{}'::jsonb, $4, $4)`,
    [transientEmail, hardBounceEmail, complaintEmail, now],
  );
  await database.query(
    `INSERT INTO public."EmailFailureCount"
      (email, count, "firstFailedAt", "lastFailedAt", "lastEventId")
     VALUES
      ($1, 5, $3, $3, 'evt_full_chain_c715_transient'),
      ($2, 2, $3, $3, 'evt_full_chain_c715_unrelated')`,
    [transientEmail, "full-chain-c715-other@example.test", now],
  );

  return Object.freeze({ transientEmail, hardBounceEmail, complaintEmail });
}

export async function proveHistoricalResendFailureSuppressionRepair({
  database,
  fixture,
}) {
  assert.ok(fixture, "C-715 predecessor damage must be seeded before its repair");

  const suppressions = (await database.query(
    `SELECT email, reason::text, source
       FROM public."EmailSuppression"
      WHERE email = ANY($1::text[])
      ORDER BY email`,
    [[fixture.transientEmail, fixture.hardBounceEmail, fixture.complaintEmail]],
  )).rows;

  assert.deepEqual(suppressions, [
    {
      email: fixture.complaintEmail,
      reason: "COMPLAINT",
      source: "resend",
    },
    {
      email: fixture.hardBounceEmail,
      reason: "BOUNCE",
      source: "resend",
    },
  ]);

  const failureCount = Number((await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."EmailFailureCount"`,
  )).rows[0]?.count ?? -1);
  assert.equal(failureCount, 0);
}

function providerSuppressionStorageClient(database) {
  return Object.freeze({
    updateMany: async ({ where, data }) => {
      const result = await database.query(
        `UPDATE public."EmailSuppression"
            SET reason = $2::public."EmailSuppressionReason",
                source = $3,
                "eventId" = $4,
                details = $5::jsonb,
                "updatedAt" = pg_catalog.clock_timestamp()
          WHERE email = $1
            AND (
              source IS NULL
              OR source <> 'resend'
              OR reason NOT IN (
                'BOUNCE'::public."EmailSuppressionReason",
                'COMPLAINT'::public."EmailSuppressionReason"
              )
            )`,
        [
          where.email,
          data.reason,
          data.source,
          data.eventId ?? null,
          JSON.stringify(data.details ?? {}),
        ],
      );
      return { count: result.rowCount };
    },
    findUnique: async ({ where }) => {
      const result = await database.query(
        `SELECT email, reason::text, source, "eventId", details
           FROM public."EmailSuppression"
          WHERE email = $1`,
        [where.email],
      );
      return result.rows[0] ?? null;
    },
    create: async ({ data }) => {
      const result = await database.query(
        `INSERT INTO public."EmailSuppression"
          (id, email, reason, source, "eventId", details, "createdAt", "updatedAt")
         VALUES ($1, $2, $3::public."EmailSuppressionReason", $4, $5, $6::jsonb,
                 pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
         RETURNING email, reason::text, source, "eventId", details`,
        [
          `c715_storage_${data.email.replace(/[^a-z0-9]/giu, "_")}`,
          data.email,
          data.reason,
          data.source,
          data.eventId ?? null,
          JSON.stringify(data.details ?? {}),
        ],
      );
      return result.rows[0];
    },
  });
}

async function storeDirectSuppression(database, { email, reason, eventId }) {
  const result = await database.query(
    `INSERT INTO public."EmailSuppression"
      (id, email, reason, source, "eventId", details, "createdAt", "updatedAt")
     VALUES ($1, $2, $3::public."EmailSuppressionReason", 'resend', $4,
             '{"direct":true}'::jsonb,
             pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
     ON CONFLICT (email) DO UPDATE
       SET reason = EXCLUDED.reason,
           source = EXCLUDED.source,
           "eventId" = EXCLUDED."eventId",
           details = EXCLUDED.details,
           "updatedAt" = pg_catalog.clock_timestamp()
     RETURNING email, reason::text, source, "eventId", details`,
    [
      `c715_direct_${email.replace(/[^a-z0-9]/giu, "_")}`,
      email,
      reason,
      eventId,
    ],
  );
  return result.rows[0];
}

export async function proveStoredResendSuppressionOrdering({ database }) {
  const client = providerSuppressionStorageClient(database);
  const observed = [];

  for (const reason of ["COMPLAINT", "BOUNCE"]) {
    const label = reason.toLowerCase();
    const directFirstEmail = `full-chain-c715-direct-first-${label}@example.test`;
    const directEventId = `evt_c715_direct_first_${label}`;
    await storeDirectSuppression(database, {
      email: directFirstEmail,
      reason,
      eventId: directEventId,
    });
    const preserved = await storeProviderSuppressionWithoutWeakeningDirectEvidence(
      client,
      {
        email: directFirstEmail,
        reason: "BOUNCE",
        source: "resend_provider_suppressed",
        eventId: `evt_c715_generic_after_${label}`,
        details: { direct: false },
      },
    );
    assert.deepEqual(preserved, {
      email: directFirstEmail,
      reason,
      source: "resend",
      eventId: directEventId,
      details: { direct: true },
    });

    const genericFirstEmail = `full-chain-c715-generic-first-${label}@example.test`;
    const generic = await storeProviderSuppressionWithoutWeakeningDirectEvidence(
      client,
      {
        email: genericFirstEmail,
        reason: "BOUNCE",
        source: "resend_provider_suppressed",
        eventId: `evt_c715_generic_first_${label}`,
        details: { direct: false },
      },
    );
    assert.equal(generic.reason, "BOUNCE");
    assert.equal(generic.source, "resend_provider_suppressed");

    const direct = await storeDirectSuppression(database, {
      email: genericFirstEmail,
      reason,
      eventId: `evt_c715_direct_after_${label}`,
    });
    assert.deepEqual(direct, {
      email: genericFirstEmail,
      reason,
      source: "resend",
      eventId: `evt_c715_direct_after_${label}`,
      details: { direct: true },
    });
    observed.push(
      `${label}:direct-preserved-after-generic`,
      `${label}:direct-replaced-generic`,
    );
  }

  return observed;
}
