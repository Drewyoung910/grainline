// Read-only role-graph component. It neither provisions nor converges roles.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { DIRECT_UPLOAD_CLEANUP_ROLE, DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE } from "./direct-upload-activation-catalog.mjs";

const RUNTIME = "grainline_app_runtime";
const STAFF = "grainline_staff_read_runtime";
const RESTRICTED = [RUNTIME, DIRECT_UPLOAD_CLEANUP_ROLE, STAFF];
const attributes = (name, privileged, superuser = false) => ({ name, superuser,
  create_database: privileged, create_role: privileged, inherit: privileged,
  login: true, replication: privileged, bypass_rls: privileged });

export function assertZeroDirectRoles(snapshot, mode) {
  assert.ok(mode === "production" || mode === "disposable", "unknown role identity mode");
  assert.ok(Array.isArray(snapshot?.roles) && Array.isArray(snapshot?.edges), "missing role graph");
  const owner = mode === "production" ? "neondb_owner" : "ci";
  const staffPresent = snapshot.roles.some(row => row.name === STAFF);
  const expected = [attributes(owner, true, mode === "disposable"),
    ...RESTRICTED.filter(name => name !== STAFF || staffPresent).map(name => attributes(name, false))];
  assert.equal(snapshot.roles.length, expected.length, "required role inventory drifted");
  for (const row of expected) {
    const matches = snapshot.roles.filter(actual => actual.name === row.name);
    assert.ok(matches.length === 1 && isDeepStrictEqual(matches[0], row), "owner or restricted role attributes drifted");
  }
  // Inspect the complete membership graph in memory. No outbound membership
  // from a restricted login is allowed, so every transitive outbound path is
  // excluded at its first edge. The only admitted inbound path is the exact
  // non-effective provider bootstrap edge; recursive members are checked too.
  const relevant = snapshot.edges.filter(edge => edge.member === owner
    || RESTRICTED.includes(edge.member) || RESTRICTED.includes(edge.role));
  if (mode === "disposable") {
    assert.equal(relevant.length, 0, "disposable roles must have no membership edges");
  } else {
    const allowed = RESTRICTED.filter(name => name !== STAFF || staffPresent).map(role => ({
      role, member: owner, grantor: DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE.grantor_role,
      admin: true, inherit: false, set: false,
    }));
    const provider = relevant.filter(edge => edge.member === owner && edge.role === "neon_superuser");
    assert.ok(provider.length === 1 && provider[0].admin === false && provider[0].inherit === true
      && provider[0].set === true, "provider owner membership drifted");
    const bootstrap = relevant.filter(edge => edge !== provider[0]);
    assert.equal(bootstrap.length, allowed.length, "unexpected role membership path");
    for (const edge of allowed) assert.equal(bootstrap.filter(actual => isDeepStrictEqual(actual, edge)).length, 1,
      "restricted bootstrap edge drifted");
  }
  for (const role of RESTRICTED) {
    const seen = new Set([role]); const queue = [role];
    while (queue.length) {
      const parent = queue.shift();
      for (const edge of snapshot.edges.filter(row => row.role === parent)) {
        assert.ok(mode === "production" && edge.member === owner && parent === role,
          "unreviewed transitive restricted-role member");
        if (!seen.has(edge.member)) { seen.add(edge.member); queue.push(edge.member); }
      }
    }
  }
  return { staffPresent, roleAttributesVerified: true, restrictedMembershipGraphVerified: true };
}

export async function readZeroDirectRoles(client, owner) {
  const roles = (await client.query(`SELECT rolname AS name, rolsuper AS superuser,
      rolcreatedb AS create_database, rolcreaterole AS create_role, rolinherit AS inherit,
      rolcanlogin AS login, rolreplication AS replication, rolbypassrls AS bypass_rls
    FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`, [[owner, ...RESTRICTED]])).rows;
  const edges = (await client.query(`SELECT parent.rolname AS role, child.rolname AS member,
      grantor.rolname AS grantor, edge.admin_option AS admin,
      edge.inherit_option AS inherit, edge.set_option AS set
    FROM pg_catalog.pg_auth_members edge
    JOIN pg_catalog.pg_roles parent ON parent.oid=edge.roleid
    JOIN pg_catalog.pg_roles child ON child.oid=edge.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=edge.grantor
    ORDER BY parent.rolname,child.rolname,grantor.rolname`)).rows;
  return { roles, edges };
}
