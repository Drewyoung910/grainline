import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assertLocalDiskHeadroom,
  availableKilobytesFromDf,
  MINIMUM_FREE_GIB,
} from "../scripts/guard-local-disk-headroom.mjs";

describe("local disk headroom guard", () => {
  it("parses POSIX df output", () => {
    const output = [
      "Filesystem 1024-blocks Used Available Capacity Mounted on",
      "/dev/disk3s5 239075328 195000000 12582912 95% /System/Volumes/Data",
    ].join("\n");

    assert.equal(availableKilobytesFromDf(output), 12 * 1024 * 1024);
  });

  it("fails below one GiB and passes at the boundary", () => {
    assert.equal(MINIMUM_FREE_GIB, 1);
    assert.throws(
      () => assertLocalDiskHeadroom({ availableKilobytes: 0.5 * 1024 * 1024 }),
      /0\.5 GiB free; 1 GiB required/,
    );
    assert.equal(
      assertLocalDiskHeadroom({ availableKilobytes: 1 * 1024 * 1024 }),
      1,
    );
  });

  it("is a documented explicit local prerequisite", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const contract = readFileSync("CLAUDE.md", "utf8");

    assert.match(
      packageJson,
      /"guard:local-disk-space": "node scripts\/guard-local-disk-headroom\.mjs"/,
    );
    assert.match(contract, /npm run guard:local-disk-space/);
    assert.match(contract, /does not delete anything/);
  });
});
