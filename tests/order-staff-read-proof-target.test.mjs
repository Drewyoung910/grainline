import assert from "node:assert/strict";
import test from "node:test";
import { validateStaffReadProofTarget, staffProofChildEnvironment } from "../scripts/lib/order-staff-read-proof-target.mjs";

const target = "postgresql://ci:ci@127.0.0.1:5432/grainline_ci";
test("staff proof admits only the fixed disposable CI database", () => {
  assert.equal(validateStaffReadProofTarget(target), target);
  assert.equal(validateStaffReadProofTarget(`${target}?sslmode=disable`), `${target}?sslmode=disable`);
  for (const value of [
    "", "invalid", target.replace("127.0.0.1", "production.neon.tech"),
    target.replace("127.0.0.1", "127.0.0.1.example.com"),
    target.replace("grainline_ci", "neondb"), target.replace("ci:ci", "neondb_owner:ci"),
    target.replace(":5432", ":6543"), `${target}?host=production.neon.tech`,
    `${target}?service=production`, `${target}?sslmode=disable&host=remote`,
    `${target}#fragment`, target.replace("ci:ci", "ci:secret"),
  ]) assert.throws(() => validateStaffReadProofTarget(value), /exact disposable loopback CI target/u);
});

test("psql proof inherits no ambient database settings or provider secrets", () => {
  assert.deepEqual(staffProofChildEnvironment({
    PATH: "/usr/bin", PGHOST: "production", PGSERVICE: "production",
    PGOPTIONS: "-c role=owner", DATABASE_URL: "secret", STRIPE_SECRET_KEY: "secret",
  }), { PATH: "/usr/bin", LC_ALL: "C", PSQLRC: "/dev/null" });
});
