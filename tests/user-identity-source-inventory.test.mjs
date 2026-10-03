import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const report = JSON.parse(
  execFileSync(
    process.execPath,
    ["scripts/audit-user-direct-calls.mjs", "--json"],
    { encoding: "utf8" },
  ),
);

test("User direct-access inventory records the first Clerk identity conversion", () => {
  assert.equal(report.count, 136);
  assert.equal(report.files, 87);
  assert.deepEqual(report.byMethod, {
    count: 3,
    findFirst: 1,
    findMany: 5,
    findUnique: 118,
    update: 5,
    updateMany: 4,
  });

  const fullRowReads = report.calls.filter(
    (call) =>
      ["findFirst", "findMany", "findUnique"].includes(call.method) &&
      call.select.length === 0 &&
      call.include.length === 0,
  );
  assert.equal(fullRowReads.length, 10);

  const writes = report.calls.filter((call) =>
    ["create", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(
      call.method,
    ),
  );
  assert.equal(writes.length, 9);
  assert.deepEqual(
    [...new Set(writes.map((call) => call.file))].sort(),
    [
      "src/app/api/account/accept-terms/route.ts",
      "src/app/api/account/shipping-address/route.ts",
      "src/app/api/clerk/webhook/route.ts",
      "src/lib/accountDeletion.ts",
      "src/lib/audit.ts",
      "src/lib/ban.ts",
      "src/lib/unsubscribe.ts",
    ],
  );
});
