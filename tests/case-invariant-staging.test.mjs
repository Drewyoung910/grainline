import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CASE_INVARIANT_DRAFT,
  CASE_INVARIANT_DRAFT_SHA256,
  CASE_INVARIANT_MIGRATION,
  buildCaseInvariantCandidate,
} from "../scripts/stage-case-invariant-migration.mjs";

const migrationPath = path.join(
  "prisma",
  "migrations",
  CASE_INVARIANT_MIGRATION,
  "migration.sql",
);

test("Case invariant candidate is byte-derived from the pinned draft", () => {
  const candidate = buildCaseInvariantCandidate();
  const draft = fs.readFileSync(CASE_INVARIANT_DRAFT, "utf8");
  assert.equal(CASE_INVARIANT_DRAFT_SHA256.length, 64);
  assert.equal(
    candidate.migration,
    draft.replace(
      "-- DRAFT ONLY. Do not apply to any persistent database.",
      [
        "-- Durable Case, CaseMessage and CaseMessageAttachment invariants.",
        "-- RLS, policies and table-grant changes remain intentionally absent.",
      ].join("\n"),
    ),
  );
  assert.doesNotMatch(candidate.migration, /DRAFT ONLY/);
  assert.doesNotMatch(
    candidate.migration,
    /(?:ENABLE|FORCE) ROW LEVEL SECURITY|CREATE POLICY/i,
  );
});

test("staged Case invariant migration equals the reviewed candidate", () => {
  const candidate = buildCaseInvariantCandidate();
  assert.equal(fs.existsSync(migrationPath), true);
  assert.equal(
    fs.readFileSync(migrationPath, "utf8"),
    candidate.migration,
  );
});

test("Case invariant staging fails closed without exact disposable authority", () => {
  const script = fs.readFileSync(
    "scripts/stage-case-invariant-migration.mjs",
    "utf8",
  );
  assert.match(script, /I_ACKNOWLEDGE_LOOPBACK_CASE_INVARIANT_STAGING/);
  assert.match(script, /localhost.*127\.0\.0\.1.*::1/s);
  assert.match(script, /parsed\.pathname !== "\/grainline_ci"/);
  assert.match(script, /flag: "wx"/);
  assert.match(script, /refusing to remove drifted Case invariant migration/);
});
