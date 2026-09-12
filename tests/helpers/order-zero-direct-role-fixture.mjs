export function zeroDirectRoleFixture(mode = "production", staff = false) {
  const owner = mode === "production" ? "neondb_owner" : "ci";
  const restricted = ["grainline_app_runtime", "grainline_direct_upload_cleanup_v2",
    ...(staff ? ["grainline_staff_read_runtime"] : [])];
  return {
    roles: [owner, ...restricted].map(name => ({ name, superuser: name === "ci",
      create_database: name === owner, create_role: name === owner, inherit: name === owner,
      login: true, replication: name === owner, bypass_rls: name === owner })),
    edges: mode === "production" ? [
      ...restricted.map(role => ({ role, member: owner, grantor: "cloud_admin", admin: true, inherit: false, set: false })),
      { role: "neon_superuser", member: owner, grantor: "cloud_admin", admin: false, inherit: true, set: true },
    ] : [],
  };
}
