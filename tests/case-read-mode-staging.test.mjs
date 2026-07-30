import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CASE_READ_MODE_DRAFT,
  CASE_READ_MODE_DRAFT_SHA256,
  CASE_READ_MODE_MIGRATION,
  CASE_READ_MODE_STAGING_ACK,
  buildCaseReadModeCandidate,
} from "../scripts/stage-case-read-mode-migration.mjs";

test("Case read-mode candidate is byte-pinned and boundary-limited", () => {
  const candidate = buildCaseReadModeCandidate();
  assert.doesNotMatch(candidate.migration, /DRAFT ONLY/);
  assert.doesNotMatch(
    candidate.migration,
    /(?:ENABLE|FORCE) ROW LEVEL SECURITY|CREATE POLICY/i,
  );
  assert.doesNotMatch(
    candidate.migration,
    /(?:GRANT|REVOKE)[\s\S]{0,160}\bON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
  );
  assert.doesNotMatch(
    candidate.migration,
    /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/im,
  );
  assert.deepEqual(
    [
      ...candidate.migration.matchAll(
        /^ALTER FUNCTION public\.(grainline_[a-z0-9_]+)\(/gm,
      ),
    ].map((match) => match[1]),
    [
      "grainline_case_get",
      "grainline_case_get_by_order",
      "grainline_case_staff_active_count",
      "grainline_case_export_page",
    ],
  );
  assert.equal(CASE_READ_MODE_DRAFT_SHA256.length, 64);
  assert.equal(fs.existsSync(CASE_READ_MODE_DRAFT), true);
});

test("Case read-mode staging is loopback-only and refuses drifted removal", () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "grainline-case-read-mode-stage-"),
  );
  fs.mkdirSync(path.join(temporaryRoot, "docs", "rls-drafts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(temporaryRoot, "prisma", "migrations"), {
    recursive: true,
  });
  fs.copyFileSync(
    CASE_READ_MODE_DRAFT,
    path.join(temporaryRoot, CASE_READ_MODE_DRAFT),
  );
  const script = path.resolve("scripts/stage-case-read-mode-migration.mjs");
  const baseEnv = {
    ...process.env,
    CASE_READ_MODE_STAGING_ACK,
  };

  const persistent = spawnSync(
    process.execPath,
    [script, "--stage"],
    {
      cwd: temporaryRoot,
      env: {
        ...baseEnv,
        DIRECT_URL:
          "postgresql://owner:secret@production.example.com/grainline",
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(persistent.status, 0);
  assert.match(persistent.stderr, /only for loopback grainline_ci/);

  const disposableEnv = {
    ...baseEnv,
    DIRECT_URL:
      "postgresql://owner:secret@127.0.0.1:5432/grainline_ci",
  };
  const staged = spawnSync(
    process.execPath,
    [script, "--stage"],
    {
      cwd: temporaryRoot,
      env: disposableEnv,
      encoding: "utf8",
    },
  );
  assert.equal(staged.status, 0, staged.stderr);
  const migrationPath = path.join(
    temporaryRoot,
    "prisma",
    "migrations",
    CASE_READ_MODE_MIGRATION,
    "migration.sql",
  );
  assert.equal(
    fs.readFileSync(migrationPath, "utf8"),
    buildCaseReadModeCandidate().migration,
  );

  fs.appendFileSync(migrationPath, "\n-- drift\n");
  const refused = spawnSync(
    process.execPath,
    [script, "--unstage"],
    {
      cwd: temporaryRoot,
      env: disposableEnv,
      encoding: "utf8",
    },
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /refusing to remove drifted/);
});
