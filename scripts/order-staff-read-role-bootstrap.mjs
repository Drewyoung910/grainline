// Dormant bootstrap core. No CLI, environment reader, or provider adapter.
// The release adapter must validate exact-main/CI/target provenance, hold an
// exclusive private-journal lock, and persist each state with mode-0600 + fsync.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { buildScramSha256Verifier } from "./saved-search-phase-b-owner-rotation.mjs";

export const STAFF_BOOTSTRAP_ROLE = "grainline_staff_read_runtime";
const STAGES = ["prepared", "create-pending", "role-verified"];
const KEYS = ["version", "attemptId", "releaseCommit", "ciRunId", "role", "stage", "password", "verifier"].sort();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VERIFIER = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/u;

function assertBinding(binding) {
  assert.ok(typeof binding?.releaseCommit === "string" && typeof binding?.ciRunId === "string" &&
    /^[0-9a-f]{40}$/u.test(binding.releaseCommit) &&
    /^[1-9][0-9]{0,19}$/u.test(binding?.ciRunId ?? ""), "staff bootstrap release binding is invalid");
}

export function newStaffBootstrapState(binding) {
  assertBinding(binding);
  const password = randomBytes(32).toString("hex");
  return Object.freeze({
    version: 1, attemptId: randomUUID(), releaseCommit: binding.releaseCommit,
    ciRunId: binding.ciRunId, role: STAFF_BOOTSTRAP_ROLE, stage: "prepared",
    password, verifier: buildScramSha256Verifier(password),
  });
}

export function validateStaffBootstrapState(state, binding) {
  assertBinding(binding);
  assert.ok(state && typeof state === "object" && !Array.isArray(state) &&
    JSON.stringify(Object.keys(state).sort()) === JSON.stringify(KEYS) &&
    state.version === 1 && UUID.test(state.attemptId) &&
    state.releaseCommit === binding.releaseCommit && state.ciRunId === binding.ciRunId &&
    state.role === STAFF_BOOTSTRAP_ROLE && STAGES.includes(state.stage) &&
    typeof state.password === "string" && /^[0-9a-f]{64}$/u.test(state.password) &&
    typeof state.verifier === "string" && VERIFIER.test(state.verifier),
  "staff bootstrap private state is invalid or belongs to another release");
  const salt = Buffer.from(state.verifier.split(":")[1].split("$")[0], "base64");
  assert.ok(buildScramSha256Verifier(state.password, salt) === state.verifier,
    "staff bootstrap credential and verifier do not agree");
  return Object.freeze({ ...state });
}

export function staffBootstrapMarker(state) {
  return `grainline:staff-read-bootstrap:${state.attemptId}:${state.releaseCommit}`;
}

// One catalog definition is used both before committing creation and through
// the independently authenticated login. It reads no application rows.
export const STAFF_BOOTSTRAP_SNAPSHOT_SQL = `SELECT
  current_user::text AS current_user_name, session_user::text AS session_user_name,
  current_database()::text AS database_name,
  pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
  pg_catalog.shobj_description(candidate.oid, 'pg_authid') AS marker,
  NOT (candidate.rolsuper OR candidate.rolcreatedb OR candidate.rolcreaterole OR
    candidate.rolinherit OR NOT candidate.rolcanlogin OR candidate.rolreplication OR candidate.rolbypassrls) AS attributes_valid,
  NOT (EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = candidate.oid) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = edge.grantor
    WHERE edge.roleid = candidate.oid AND NOT (
      member.rolname = 'neondb_owner' AND grantor.rolname = 'cloud_admin'
      AND edge.admin_option AND NOT edge.inherit_option AND NOT edge.set_option
    )
  ) OR EXISTS (
    WITH RECURSIVE members(oid) AS (
      SELECT member FROM pg_catalog.pg_auth_members WHERE roleid = candidate.oid
      UNION
      SELECT edge.member FROM members
      JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = members.oid
    ) SELECT 1 FROM members JOIN pg_catalog.pg_roles AS role ON role.oid = members.oid
      WHERE role.rolname <> 'neondb_owner'
  )) AS memberships_valid,
  NOT (EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend
    WHERE refclassid = 'pg_catalog.pg_authid'::regclass AND refobjid = candidate.oid AND deptype = 'o'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl AS defaults,
      LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl WHERE acl.grantee = candidate.oid
  )) AS ownership_valid,
  (pg_catalog.has_schema_privilege(candidate.oid, 'public', 'CREATE') OR
   pg_catalog.has_database_privilege(candidate.oid, current_database(), 'CREATE') OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND CASE
      WHEN relation.relkind = 'S' THEN pg_catalog.has_sequence_privilege(candidate.oid, relation.oid, 'USAGE,SELECT,UPDATE')
      WHEN relation.relkind IN ('r','p','v','m','f') THEN
        pg_catalog.has_table_privilege(candidate.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE') OR
        pg_catalog.has_any_column_privilege(candidate.oid, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      ELSE false END
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public' AND routine.prosecdef
      AND pg_catalog.has_function_privilege(candidate.oid, routine.oid, 'EXECUTE')
  )) AS has_application_authority
  FROM pg_catalog.pg_roles AS candidate WHERE candidate.rolname = '${STAFF_BOOTSTRAP_ROLE}'`;

export async function readStaffBootstrapLoginSnapshot(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await client.query(STAFF_BOOTSTRAP_SNAPSHOT_SQL);
    assert.equal(result.rows.length, 1, "staff bootstrap role is absent");
    const row = result.rows[0];
    assert.equal(row.read_only, true, "staff bootstrap catalog proof must be engine-read-only");
    return Object.freeze({ currentUser: row.current_user_name, sessionUser: row.session_user_name,
      database: row.database_name, marker: row.marker,
      restrictedRole: row.attributes_valid === true && row.memberships_valid === true && row.ownership_valid === true,
      hasApplicationAuthority: row.has_application_authority });
  } finally { await client.query("ROLLBACK"); }
}

export function buildStaffBootstrapSql(state, binding) {
  validateStaffBootstrapState(state, binding);
  // Only validated UUID, hex and SCRAM alphabets enter SQL literals. The raw
  // password never enters SQL, argv, evidence or a provider error message.
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(182735, 60906);
DO $staff_bootstrap$
DECLARE existing_role record; proof_snapshot record; marker text;
BEGIN
  IF current_user <> 'neondb_owner' OR session_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'staff bootstrap requires the direct migration-owner session';
  END IF;
  SELECT * INTO existing_role FROM pg_catalog.pg_roles WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}';
  IF existing_role IS NULL THEN
    CREATE ROLE ${STAFF_BOOTSTRAP_ROLE}
      LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
      PASSWORD '${state.verifier}';
    COMMENT ON ROLE ${STAFF_BOOTSTRAP_ROLE} IS '${staffBootstrapMarker(state)}';
  ELSE
    SELECT pg_catalog.shobj_description(existing_role.oid, 'pg_authid') INTO marker;
    IF marker IS DISTINCT FROM '${staffBootstrapMarker(state)}' THEN
      RAISE EXCEPTION 'staff bootstrap refuses an existing unbound role';
    END IF;
  END IF;
  SELECT * INTO proof_snapshot FROM (${STAFF_BOOTSTRAP_SNAPSHOT_SQL}) AS proof;
  IF proof_snapshot IS NULL OR proof_snapshot.attributes_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staff bootstrap role attributes drifted';
  END IF;
  IF proof_snapshot.memberships_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staff bootstrap role membership drifted'; END IF;
  IF proof_snapshot.ownership_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staff bootstrap role owns objects or default grants'; END IF;
  IF proof_snapshot.has_application_authority IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'staff bootstrap role retains application authority'; END IF;
END $staff_bootstrap$;
COMMIT;`;
}

export function assertStaffBootstrapLogin(snapshot, marker) {
  assert.ok(snapshot?.currentUser === STAFF_BOOTSTRAP_ROLE &&
    snapshot.sessionUser === STAFF_BOOTSTRAP_ROLE && snapshot.database === "neondb" &&
    snapshot.marker === marker && snapshot.restrictedRole === true && snapshot.hasApplicationAuthority === false,
  "staff bootstrap separate-login proof failed");
}

export async function runStaffBootstrapCore({ state: rawState, binding, operations }) {
  let state = validateStaffBootstrapState(rawState, binding);
  for (const name of ["persistPrivateState", "executeOwnerTransaction", "proveSeparateLogin"]) {
    assert.equal(typeof operations?.[name], "function", "staff bootstrap adapter is incomplete");
  }
  let phase = "intent-persistence";
  try {
    if (state.stage !== "role-verified") {
      state = Object.freeze({ ...state, stage: "create-pending" });
      // Must resolve only after the exact credential/intent is durably saved.
      await operations.persistPrivateState(state);
      phase = "owner-transaction";
      await operations.executeOwnerTransaction(buildStaffBootstrapSql(state, binding));
    }
    // A committed role or lost response is not proof of possession. Never
    // replace its password on retry, and never skip fresh authentication.
    phase = "separate-login";
    assertStaffBootstrapLogin(await operations.proveSeparateLogin(state.password), staffBootstrapMarker(state));
    state = Object.freeze({ ...state, stage: "role-verified" });
    phase = "completion-persistence";
    await operations.persistPrivateState(state);
    return Object.freeze({ status: "role-verified", role: STAFF_BOOTSTRAP_ROLE,
      releaseCommit: state.releaseCommit, ciRunId: state.ciRunId,
      grantsApplied: false, secretInstalled: false, productionDeploymentChanged: false });
  } catch {
    // Do not attach provider causes: they can contain a URL/password/SQL.
    throw new Error(`staff bootstrap stopped during ${phase}; preserve the private journal and inspect the exact attempt`);
  }
}
