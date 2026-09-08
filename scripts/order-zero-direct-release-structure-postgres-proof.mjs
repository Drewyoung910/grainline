// Disposable PostgreSQL 16 only. Negative DDL/role probes are each rolled back;
// the production reader itself remains engine-read-only and mutation-free.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseZeroDirectScopeProofConfig, proveZeroDirectReleaseScope } from "./order-zero-direct-release-scope-postgres-proof.mjs";
import { assertZeroDirectSchema, readZeroDirectSchema } from "./order-zero-direct-release-schema.mjs";
import { assertZeroDirectRoles, readZeroDirectRoles } from "./order-zero-direct-release-roles.mjs";
import { verifyInputRuntimeIdentity } from "./order-input-correction-runtime-postgres-proof.mjs";
import { verifyRepairProofRole } from "./checkout-repair-outcome-runtime-postgres-proof.mjs";

export async function runZeroDirectStructureProof(env = process.env) {
  const { databaseUrl } = parseZeroDirectScopeProofConfig(env);
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "order-zero-direct-structure-proof" });
  await client.connect();
  try {
    await verifyInputRuntimeIdentity(client, "grainline_ci", "ci", env.GITHUB_ACTIONS === "true");
    await verifyRepairProofRole(client, true);
    await proveZeroDirectReleaseScope(client);
    const schema = await readZeroDirectSchema(client, "ci");
    const roles = await readZeroDirectRoles(client, "ci");
    const changes = [
      ['ALTER TABLE public."Order" DROP CONSTRAINT "Order_provider_claim_mutual_exclusion_check"', "schema"],
      ['ALTER TABLE public."Order" ADD COLUMN "zeroDirectUnexpectedProofColumn" text', "outside-scope"],
      ['ALTER TABLE public."OrderStaffCapability" ADD COLUMN unexpected text', "schema"],
      ['ALTER TABLE public."OrderStaffCapability" ALTER COLUMN "createdAt" DROP DEFAULT', "schema"],
      ['DROP INDEX public."Order_sellerProfileId_sellerDeauthorizedAt_idx"', "schema"],
      ['ALTER TABLE public."SellerDeauthorizationApplication" DISABLE TRIGGER "SellerDeauthorizationApplication_immutable"', "schema"],
      ['ALTER TABLE public."CheckoutStockReservation" DROP CONSTRAINT "CheckoutStockReservation_sourceSnapshot_check"', "schema"],
      ['ALTER ROLE grainline_app_runtime BYPASSRLS', "roles"],
      ['ALTER ROLE grainline_direct_upload_cleanup_v2 INHERIT', "roles"],
      ['GRANT pg_read_all_data TO grainline_app_runtime WITH INHERIT FALSE, SET FALSE', "roles"],
      ['GRANT grainline_app_runtime TO grainline_direct_upload_cleanup_v2 WITH INHERIT FALSE, SET FALSE', "roles"],
    ];
    let denials = 0;
    for (const [sql, kind] of changes) {
      await client.query("BEGIN");
      try {
        await client.query(sql);
        if (kind === "roles") {
          const drift = await readZeroDirectRoles(client, "ci");
          assert.throws(() => assertZeroDirectRoles(drift, "disposable"));
          denials += 1;
        } else {
          const drift = await readZeroDirectSchema(client, "ci");
          if (kind === "schema") { assert.throws(() => assertZeroDirectSchema(drift, 17)); denials += 1; }
          else assertZeroDirectSchema(drift, 17); // Explicitly not a full Order-column inventory.
        }
      } finally { await client.query("ROLLBACK"); }
      assert.deepEqual(await readZeroDirectSchema(client, "ci"), schema, "schema probe left residue");
      assert.deepEqual(await readZeroDirectRoles(client, "ci"), roles, "role probe left residue");
    }
    await proveZeroDirectReleaseScope(client);
    return { status: "passed", nativeDenials: denials, outOfScopeControl: 1,
      schemaRecords: schema.length, rolledBack: true, productionChanged: false,
      productionExecutionAuthorized: false };
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(await runZeroDirectStructureProof())}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable zero-direct structure proof failed closed [${code}].\n`);
    process.exitCode = 1;
  }
}
