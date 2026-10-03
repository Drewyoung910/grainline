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

test("User direct-access inventory is pinned to the audited baseline", () => {
  assert.equal(report.count, 144);
  assert.equal(report.files, 90);
  assert.deepEqual(report.byMethod, {
    count: 3,
    create: 2,
    findFirst: 1,
    findMany: 5,
    findUnique: 122,
    update: 7,
    updateMany: 4,
  });

  const fullRowReads = report.calls.filter(
    (call) =>
      ["findFirst", "findMany", "findUnique"].includes(call.method) &&
      call.select.length === 0 &&
      call.include.length === 0,
  );
  assert.equal(fullRowReads.length, 13);

  const writes = report.calls.filter((call) =>
    ["create", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(
      call.method,
    ),
  );
  assert.equal(writes.length, 13);
  assert.deepEqual(
    [...new Set(writes.map((call) => call.file))].sort(),
    [
      "src/app/api/account/accept-terms/route.ts",
      "src/app/api/account/shipping-address/route.ts",
      "src/app/api/clerk/webhook/route.ts",
      "src/lib/accountDeletion.ts",
      "src/lib/audit.ts",
      "src/lib/ban.ts",
      "src/lib/ensureUser.ts",
      "src/lib/unsubscribe.ts",
    ],
  );
});
