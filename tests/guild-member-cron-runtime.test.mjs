import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const path = "src/app/api/cron/guild-member-check/route.ts";

async function runCron(revocation) {
  const state = { messages: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@sentry/nextjs": {
      captureMessage: (message, context) => state.messages.push({ message, context }),
      captureException: (error) => {
        throw error;
      },
    },
    "@/lib/cronAuth": { verifyCronRequest: () => true },
    "@/lib/cronRun": {
      beginCronRun: async () => ({ acquired: true }),
      completeCronRun: async () => {},
      failCronRun: async () => {},
    },
    "@/lib/cronMonitor": { withSentryCronMonitor: (_name, _schedule, run) => run() },
    "@/lib/cronBatchState": {
      runCronCursorPages: async ({ processPage }) => processPage([{ id: "seller" }]),
    },
    "@/lib/sellerGuildPrivateAccess": {
      applySellerGuildMemberRevocation: async () => revocation,
      sellerGuildMemberCronBatch: async () => [],
    },
    "@/lib/httpStatus": { HTTP_STATUS },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const response = await exports.GET(new Request("https://example.test/api/cron/guild-member-check"));
  return { state, response };
}

test("a guard that fired without revoking anything leaves a trace", async () => {
  const { state, response } = await runCron({
    applied: false, auditId: null, reason: null, sellerUserId: "user", guardKind: "listing_threshold",
  });
  assert.equal(response.status, 200);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].context.extra.guardKind, "listing_threshold");
});

test("a member in good standing leaves none", async () => {
  const { state } = await runCron({
    applied: false, auditId: null, reason: null, sellerUserId: "user", guardKind: null,
  });
  assert.equal(state.messages.length, 0);
});
