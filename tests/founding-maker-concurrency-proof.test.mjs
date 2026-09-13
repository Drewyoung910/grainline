import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildEvidencePayload,
  parseConfig,
} from "../scripts/founding-maker-concurrency-proof.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Founding Maker concurrency proof harness", () => {
  it("is wired as an explicit staging/local write-delete evidence command", () => {
    const pkg = JSON.parse(source("package.json"));
    const script = source("scripts/founding-maker-concurrency-proof.mjs");

    assert.equal(
      pkg.scripts["audit:founding-maker"],
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/founding-maker-concurrency-proof.mjs",
    );
    assert.match(script, /const CONFIRMATION_VALUE = "staging-or-local-write-delete"/);
    assert.match(script, /FOUNDING_MAKER_PROOF_CONFIRM=\$\{CONFIRMATION_VALUE\} is required/);
    assert.match(script, /FOUNDING_MAKER_PROOF_EVIDENCE_PATH/);
    assert.match(script, /DATABASE_URL/);
    assert.match(script, /PrismaPg/);
    assert.match(script, /new PrismaClient\(\{ adapter \}\)/);
  });

  it("requires confirmation, DATABASE_URL, bounded concurrency, and in-repo evidence paths", () => {
    assert.throws(
      () => parseConfig({ DATABASE_URL: "postgres://user:pass@example/db", FOUNDING_MAKER_PROOF_EVIDENCE_PATH: "founding.json" }),
      /FOUNDING_MAKER_PROOF_CONFIRM=staging-or-local-write-delete is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          FOUNDING_MAKER_PROOF_CONFIRM: "staging-or-local-write-delete",
          FOUNDING_MAKER_PROOF_EVIDENCE_PATH: "founding.json",
        }),
      /DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          FOUNDING_MAKER_PROOF_CONFIRM: "staging-or-local-write-delete",
          FOUNDING_MAKER_PROOF_EVIDENCE_PATH: "../founding.json",
          DATABASE_URL: "postgres://user:pass@example/db",
        }),
      /must stay inside the repository/,
    );
    assert.throws(
      () =>
        parseConfig({
          FOUNDING_MAKER_PROOF_CONFIRM: "staging-or-local-write-delete",
          FOUNDING_MAKER_PROOF_EVIDENCE_PATH: "founding.json",
          DATABASE_URL: "postgres://user:pass@example/db",
          FOUNDING_MAKER_PROOF_SYNTHETIC_SELLERS: "1",
        }),
      /FOUNDING_MAKER_PROOF_SYNTHETIC_SELLERS must be between 2 and 32/,
    );

    const config = parseConfig({
      FOUNDING_MAKER_PROOF_CONFIRM: "staging-or-local-write-delete",
      FOUNDING_MAKER_PROOF_EVIDENCE_PATH: "founding.json",
      DATABASE_URL: "postgres://user:pass@example/db",
      FOUNDING_MAKER_PROOF_SYNTHETIC_SELLERS: "4",
      FOUNDING_MAKER_PROOF_REPEAT_CALLS: "2",
    });

    assert.equal(config.syntheticSellerCount, 4);
    assert.equal(config.repeatCalls, 2);
    assert.equal(config.evidencePath, resolve(REPOSITORY_ROOT, "founding.json"));
    assert.equal(typeof config.databaseHostHash, "string");
  });

  it("exercises the production allocator core instead of a forked algorithm", () => {
    const script = source("scripts/founding-maker-concurrency-proof.mjs");
    const core = source("src/lib/foundingMakerCore.ts");
    const production = source("src/lib/foundingMaker.ts");

    assert.match(script, /maybeGrantFoundingMakerWithClient/);
    assert.match(production, /maybeGrantFoundingMakerWithClient\(prisma, sellerProfileId\)/);
    assert.match(core, /FoundingMakerGrant is the durable source of issued numbers/);
    assert.match(core, /foundingMakerGrant\.aggregate/);
    assert.match(core, /foundingMakerGrant\.create/);
    assert.doesNotMatch(core, /sellerProfile\.aggregate/);
  });

  it("proves concurrency, ledger permanence, cap behavior, and cleanup surfaces", () => {
    const script = source("scripts/founding-maker-concurrency-proof.mjs");

    for (const token of [
      "Promise.all",
      "flatMap",
      "repeatCalls",
      "currentLedgerConsistency",
      "Founding Maker profile/grant ledger drift",
      "deleteSyntheticSellerProfile",
      "Durable grant ledger should not reuse",
      "createCapSentinelGrant",
      "Founding Maker grant should fail closed when the durable ledger is at the cap",
      "cleanupSyntheticRows",
      "prisma.listing.deleteMany",
      "prisma.foundingMakerGrant.deleteMany",
      "prisma.sellerProfile.deleteMany",
      "prisma.user.deleteMany",
    ]) {
      assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps retained evidence sanitized and identifier-bounded", () => {
    const script = source("scripts/founding-maker-concurrency-proof.mjs");
    const payload = buildEvidencePayload({
      config: { databaseHostHash: "db-host-hash" },
      result: {
        actionableFindingCount: 1,
        reports: [],
        proof: {
          sampleGrantedSellers: [{ sellerIdHash: "hash", grantIdHash: "hash2", foundingMakerNumber: 1 }],
        },
        cleanup: { deletedUsers: 1 },
      },
      status: "failed",
      startedAt: "2026-07-11T00:00:00.000Z",
      completedAt: "2026-07-11T00:00:01.000Z",
      issues: [
        'DATABASE_URL="postgres://user:secret@example/db"',
        "Authorization: Bearer secret-token-value",
      ],
    });
    const serialized = JSON.stringify(payload);

    assert.match(script, /sellerIdHash: hashValue/);
    assert.match(script, /grantIdHash: row\.foundingMakerGrant\?\.id \? hashValue/);
    assert.doesNotMatch(script, /sellerId: row\.id/);
    assert.match(serialized, /\[redacted-founding-maker-proof-env\]/);
    assert.match(serialized, /Bearer \[redacted-token\]/);
    assert.doesNotMatch(serialized, /postgres:\/\/user:secret/);
    assert.doesNotMatch(serialized, /secret-token-value/);
  });

  it("keeps launch docs tied to the retained proof artifact", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(launch, /npm run audit:founding-maker/);
    assert.match(runbook, /npm run audit:founding-maker/);
    assert.match(backlog, /`npm run audit:founding-maker`/);
    assert.match(claude, /Do not close Founding Maker concurrency or permanence from source review alone/);
  });
});
