import assert from "node:assert/strict";
import test from "node:test";

import {
  collectReviewedMigrationTailIssues,
} from "../scripts/assert-reviewed-migration-tail.mjs";

const FIRST = "20261001000000_first";
const RELEASE = "20261002000000_release";
const LATER = "20261003000000_later";

test("accepts one exact reviewed release prefix and later pending suffix", () => {
  assert.deepEqual(collectReviewedMigrationTailIssues({
    directoryNames: [FIRST, RELEASE, LATER],
    releaseMigrations: [RELEASE],
    laterPendingMigrations: [LATER],
  }), []);
});

test("rejects unknown later, missing, duplicate, and out-of-order migrations", () => {
  for (const values of [
    {
      directoryNames: [FIRST, RELEASE, LATER, "20261004000000_unknown"],
      releaseMigrations: [RELEASE],
      laterPendingMigrations: [LATER],
    },
    {
      directoryNames: [FIRST, RELEASE],
      releaseMigrations: [RELEASE],
      laterPendingMigrations: [LATER],
    },
    {
      directoryNames: [FIRST, RELEASE, LATER],
      releaseMigrations: [RELEASE],
      laterPendingMigrations: [RELEASE],
    },
    {
      directoryNames: [FIRST, RELEASE, LATER],
      releaseMigrations: [LATER],
      laterPendingMigrations: [RELEASE],
    },
  ]) {
    assert.notDeepEqual(collectReviewedMigrationTailIssues(values), []);
  }
});
