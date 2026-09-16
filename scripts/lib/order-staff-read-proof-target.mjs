import assert from "node:assert/strict";

// This is a disposable CI harness, never a production connection reader.
export function validateStaffReadProofTarget(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new Error("Staff proof requires the exact disposable loopback CI target");
  }
  assert.ok(
    url.protocol === "postgresql:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.port === "5432" && url.pathname === "/grainline_ci" &&
    url.username === "ci" && url.password === "ci" &&
    ["", "?sslmode=disable"].includes(url.search) && !url.hash,
    "Staff proof requires the exact disposable loopback CI target",
  );
  return url.toString();
}

export function staffProofChildEnvironment(env) {
  // Do not inherit PGHOST, PGSERVICE, startup configuration or provider secrets.
  return { PATH: env.PATH, LC_ALL: "C", PSQLRC: "/dev/null" };
}
