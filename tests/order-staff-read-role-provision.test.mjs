import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(
  "scripts/provision-order-staff-read-role.sql",
  "utf8",
);

test("staff-read role convergence is credential-free and fail closed", () => {
  assert.match(script, /This script never creates a role or sets a password/u);
  assert.doesNotMatch(script, /\b(?:CREATE|ALTER) ROLE\b/u);
  assert.doesNotMatch(script, /\bPASSWORD\b/u);
  assert.match(script, /\\set ON_ERROR_STOP on/u);
  assert.match(script, /current_user <> :'migration_role'/u);
  assert.match(script, /session_user <> :'migration_role'/u);
  assert.match(script, /roles must be pairwise distinct/u);
});

test("staff-read role convergence requires the restricted login posture", () => {
  for (const attribute of [
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolinherit",
    "rolcanlogin",
    "rolreplication",
    "rolbypassrls",
  ]) {
    assert.match(script, new RegExp(`\\b${attribute}\\b`, "u"));
  }
  assert.match(script, /parent_memberships/u);
  assert.match(script, /direct_member_edges/u);
  assert.match(script, /grantor_role = 'cloud_admin'/u);
  assert.match(script, /NOT inherit_option/u);
  assert.match(script, /NOT set_option/u);
});

test("staff-read role receives exactly the corrected projections and no tables", () => {
  assert.match(
    script,
    /GRANT EXECUTE ON FUNCTION\s+public\.grainline_order_staff_page_v2\(text, text, integer, integer\)/u,
  );
  assert.match(
    script,
    /GRANT EXECUTE ON FUNCTION\s+public\.grainline_order_staff_detail_v2\(text, text\)/u,
  );
  assert.doesNotMatch(script, /GRANT EXECUTE ON FUNCTION[\s\S]*grainline_order_staff_page\(text/u);
  assert.match(script, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public/u);
  assert.match(script, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public/u);
  assert.match(script, /REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public/u);
  assert.match(script, /aclexplode\(attribute\.attacl\)/u);
  assert.match(script, /has_column_privilege/u);
  assert.match(script, /pg_default_acl/u);
  assert.match(script, /unexpected_definer_authority/u);
  assert.match(script, /runtime_execute OR public_execute/u);
});
