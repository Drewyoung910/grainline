import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCaseMessagePreflightProofConfig,
} from "../scripts/case-message-preflight-authority-postgres-proof.mjs";

const key = "CASE_MESSAGE_PREFLIGHT_PROOF_DATABASE_URL";

test("Case-message preflight proof requires an explicit URL", () => {
  assert.throws(
    () => parseCaseMessagePreflightProofConfig({}),
    new RegExp(`${key} is required`),
  );
});

test("Case-message preflight proof refuses non-loopback databases", () => {
  assert.throws(
    () =>
      parseCaseMessagePreflightProofConfig({
        [key]: "postgresql://user:secret@db.example.com:5432/grainline_ci",
      }),
    /refuses a non-loopback database/,
  );
});

test("Case-message preflight proof requires the disposable CI database", () => {
  assert.throws(
    () =>
      parseCaseMessagePreflightProofConfig({
        [key]: "postgresql://user:secret@localhost:5432/production",
      }),
    /requires the grainline_ci database/,
  );
});

test("Case-message preflight proof accepts loopback grainline_ci", () => {
  assert.equal(
    parseCaseMessagePreflightProofConfig({
      [key]: "postgresql://user:secret@127.0.0.1:5432/grainline_ci",
    }).databaseUrl,
    "postgresql://user:secret@127.0.0.1:5432/grainline_ci",
  );
});
