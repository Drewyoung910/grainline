import pg from "pg";

const { Pool } = pg;

const droppedColumns = [
  "stripeAccountId",
  "stripeAccountVersion",
  "stripeControllerType",
  "manualStripeReconciliationNeeded",
  "manualStripeReconciliationNote",
  "shipFromName",
  "shipFromLine1",
  "shipFromLine2",
  "shipFromCity",
  "shipFromState",
  "shipFromPostal",
  "shipFromCountry",
  "shipFromPhone",
  "defaultPkgWeightGrams",
  "defaultPkgLengthCm",
  "defaultPkgWidthCm",
  "defaultPkgHeightCm",
  "useCalculatedShipping",
  "preferredCarriers",
  "onboardingStep",
  "onboardingComplete",
  "guildMemberApprovedAt",
  "guildMasterApprovedAt",
  "guildMasterAppliedAt",
  "guildMasterReviewNotes",
  "consecutiveMetricFailures",
  "lastMetricCheckAt",
  "metricWarningSentAt",
  "listingsBelowThresholdSince",
  "profileViews",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function retiredReferences(definition) {
  const problems = [];
  const rowTypes = [
    ...definition.matchAll(
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+public\."SellerProfile"%ROWTYPE/gu,
    ),
  ].map((match) => match[1]);
  const aliases = [
    ...definition.matchAll(
      /\b(?:FROM|JOIN|UPDATE)\s+public\."SellerProfile"(?:\s+AS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu,
    ),
  ].map((match) => match[1]);

  for (const source of new Set([...rowTypes, ...aliases])) {
    for (const column of droppedColumns) {
      const reference = new RegExp(
        `\\b${escapeRegExp(source)}\\."${escapeRegExp(column)}"`,
        "u",
      );
      if (reference.test(definition)) {
        problems.push(`${source}.${column}`);
      }
    }
  }

  const writesSellerProfile = /\b(?:INSERT\s+INTO|UPDATE)\s+public\."SellerProfile"\b/iu
    .test(definition);
  if (writesSellerProfile) {
    for (const column of droppedColumns) {
      const columnReference = new RegExp(`"${escapeRegExp(column)}"`, "u");
      if (columnReference.test(definition)) {
        problems.push(`SellerProfile.${column}`);
      }
    }
  }
  return [...new Set(problems)].sort();
}

export function inspectFunctionDefinitions(rows) {
  return rows.flatMap((row) => {
    const references = retiredReferences(row.definition);
    return references.length === 0
      ? []
      : [{ identity: row.identity, references }];
  });
}

async function main() {
  const connectionString =
    process.env.SELLER_PROFILE_RETIRED_FUNCTION_PROOF_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SELLER_PROFILE_RETIRED_FUNCTION_PROOF_DATABASE_URL is required",
    );
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query(`
      SELECT procedure.oid::regprocedure::text AS identity,
             pg_catalog.pg_get_functiondef(procedure.oid) AS definition
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        JOIN pg_catalog.pg_language AS language
          ON language.oid = procedure.prolang
       WHERE namespace.nspname = 'public'
         AND language.lanname = 'plpgsql'
       ORDER BY identity
    `);
    const offenders = inspectFunctionDefinitions(result.rows);
    if (offenders.length > 0) {
      throw new Error(
        `Retired SellerProfile function references remain: ${JSON.stringify(offenders)}`,
      );
    }
    process.stdout.write(
      `SellerProfile retired-column scan passed for ${result.rows.length} function signatures\n`,
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
