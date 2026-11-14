import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const modulePath = "src/lib/commissionRequestAccess.ts";
const detailPagePath = "src/app/commission/[param]/page.tsx";

function textWithinRange(value, minimum, maximum) {
  return typeof value === "string"
    && [...value].length >= minimum
    && [...value].length <= maximum;
}

function loadSubject(resultRows = []) {
  const state = { contexts: [], queryCount: 0, capturedExceptions: [] };
  const client = {
    $queryRaw: async () => {
      state.queryCount += 1;
      return resultRows;
    },
  };
  const dependencies = {
    "node:crypto": { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    "@sentry/nextjs": {
      captureException: (error, context) => {
        state.capturedExceptions.push({ error, context });
      },
    },
    "@/lib/db": { prisma: client },
    "@/lib/dbUserContext": {
      withDbUserContext: async (userId, operation) => {
        state.contexts.push(userId);
        return operation(client);
      },
    },
    "@/lib/categories": { CATEGORY_VALUES: ["FURNITURE"] },
    "@/lib/textLength": { isTextWithinCodePointRange: textWithinRange },
    "@/lib/notifications": { createNotificationOrThrow: async () => undefined },
    "@/lib/notificationSources": { NOTIFICATION_SOURCE_TYPES: {} },
  };
  const javascript = ts.transpileModule(readFileSync(modulePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    Date,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: modulePath });
  return { exports, state };
}

function ownerExportRow(overrides = {}) {
  return {
    id: "commission-1",
    title: "Dining table",
    description: "A walnut dining table",
    category: "FURNITURE",
    budgetMinCents: 100_00,
    budgetMaxCents: 300_00,
    timeline: null,
    referenceImageUrls: [],
    status: "OPEN",
    interestedCount: 0,
    expiresAt: null,
    isNational: true,
    lat: null,
    lng: null,
    radiusMeters: null,
    createdAt: new Date("2026-11-02T00:00:00.000Z"),
    updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    metroId: null,
    cityMetroId: null,
    ...overrides,
  };
}

test("national commission requests remain exportable with a null radius", async () => {
  const subject = loadSubject([ownerExportRow()]);
  const rows = await subject.exports.ownerCommissionRequestExport("buyer-1");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "commission-1");
  assert.equal(rows[0].radiusMeters, null);
  assert.deepEqual(subject.state.contexts, ["buyer-1"]);
  assert.equal(subject.state.queryCount, 1);
});

test("commission export still rejects malformed non-null radii", async () => {
  const subject = loadSubject([ownerExportRow({ radiusMeters: -1 })]);

  await assert.rejects(
    subject.exports.ownerCommissionRequestExport("buyer-1"),
    /Commission owner export authority returned an invalid count/u,
  );
});

test("malformed commission detail ids resolve as not found without querying", async () => {
  const subject = loadSubject();

  assert.equal(await subject.exports.publicCommissionRequestDetail("buyer-1", "bad/id"), null);
  assert.deepEqual(subject.state.contexts, []);
  assert.equal(subject.state.queryCount, 0);
});

test("terminal commission metadata does not preempt authenticated page access", () => {
  const page = readFileSync(detailPagePath, "utf8");
  const metadataStart = page.indexOf("export async function generateMetadata");
  const metroPageStart = page.indexOf("async function MetroCommissionsPage");
  const metadata = page.slice(metadataStart, metroPageStart);

  assert.match(metadata, /if \(!req\)[\s\S]*robots: \{ index: false, follow: false \}/u);
  assert.doesNotMatch(metadata, /if \(!req\) notFound\(\)/u);
});
