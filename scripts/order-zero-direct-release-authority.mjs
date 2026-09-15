// Dormant, read-only composition. No credentials, provider calls or mutations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { auditLiveDatabase, deriveGrantInventory, runtimePrivateFunctionNames } from "./audit-runtime-db-grants.mjs";
import { DIRECT_UPLOAD_CLEANUP_ROLE } from "./direct-upload-activation-catalog.mjs";

const PRIVATE_INTRODUCTIONS = [["OrderStaffCapability", 10], ["SellerDeauthorizationApplication", 12]];
const CONFIG_ROLES = ["grainline_app_runtime", DIRECT_UPLOAD_CLEANUP_ROLE, "grainline_staff_read_runtime"];
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createZeroDirectAuthorityInventory(manifest) {
  assert.equal(manifest?.base?.length, 234);
  assert.equal(manifest?.members?.length, 17);
  assert.equal(manifest?.states?.length, 18);
  const full = deriveGrantInventory();
  const targets = new Set(manifest.targetNames);
  assert.equal(targets.size, 36);
  assert.ok([...targets].every(name => full.functions.includes(name)), "target missing from global source inventory");
  const states = manifest.states.map((functions, n) => {
    const present = new Set(functions.map(fn => fn.name));
    const absentTables = new Set(PRIVATE_INTRODUCTIONS.filter(([, introduced]) => n < introduced).map(([name]) => name));
    const inventory = structuredClone(full);
    inventory.functions = inventory.functions.filter(name => !targets.has(name) || present.has(name));
    for (const key of ["tables", "rlsPolicyTables", "rlsEnableTables", "rlsForceTables"])
      inventory[key] = inventory[key].filter(name => !absentTables.has(name));
    const privateFunctions = new Set(runtimePrivateFunctionNames(inventory));
    for (const fn of functions) assert.equal(!privateFunctions.has(fn.name), fn.runtimeExecute,
      "prefix and global function authority disagree");
    return freeze({ prefixLength: n, sha256: digest(inventory), inventory });
  });
  assert.equal(states[17].sha256, digest(full), "complete prefix must use the unchanged full global inventory");
  return freeze(states);
}

// No runtime role/database overrides are declared by the reviewed provisioning
// sources. Unknown overrides require inspection, not automatic normalization or
// removal. Read only counts: a custom GUC may contain a secret, so its value is
// never returned in the snapshot, exception or evidence.
export async function readZeroDirectConfiguration(client, owner) {
  const { rows } = await client.query(`SELECT
      (SELECT count(*)::integer FROM pg_catalog.pg_db_role_setting s
        WHERE (s.setrole=0 OR s.setrole IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])))
          AND (s.setdatabase=0 OR s.setdatabase=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))
          AND COALESCE(pg_catalog.cardinality(s.setconfig),0)>0) AS override_rows,
      pg_catalog.current_setting('row_security')='on' AS row_security_on,
      pg_catalog.current_setting('session_replication_role')='origin' AS origin_replication,
      pg_catalog.current_schemas(true)=ARRAY['pg_catalog','public']::name[] AS safe_search_path,
      pg_catalog.current_setting('standard_conforming_strings')='on' AS standard_strings,
      pg_catalog.current_setting('transaction_read_only')='on' AS read_only,
      pg_catalog.current_setting('transaction_isolation')='repeatable read' AS repeatable_read`,
  [[owner, ...CONFIG_ROLES]]);
  assert.equal(rows.length, 1, "missing configuration attestation");
  return rows[0];
}

export function assertZeroDirectConfiguration(row) {
  assert.deepEqual(row, { override_rows: 0, row_security_on: true, origin_replication: true,
    safe_search_path: true, standard_strings: true,
    read_only: true, repeatable_read: true }, "unreviewed role/database configuration or transaction posture");
}

export async function auditZeroDirectAuthority(client, inventoryState, owner) {
  const configuration = await readZeroDirectConfiguration(client, owner);
  assertZeroDirectConfiguration(configuration);
  const issues = await auditLiveDatabase({ client, runtimeRole: "grainline_app_runtime",
    migrationRole: owner, inventory: inventoryState.inventory });
  // No raw audit diagnostics or database identifiers enter portable evidence.
  assert.ok(Array.isArray(issues) && issues.length === 0, "global authority audit rejected the exact prefix");
  return { prefixLength: inventoryState.prefixLength, inventorySha256: inventoryState.sha256,
    issueCount: 0, configuration, productionExecutionAuthorized: false };
}
