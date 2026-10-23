import assert from "node:assert/strict";

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
