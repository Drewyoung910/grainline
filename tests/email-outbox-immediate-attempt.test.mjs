import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = "src/lib/emailOutbox.ts";

// The real outbox module with its ports stubbed.
function fixture({ claim = async () => ({ preferenceKey: null, recipientEmail: "a@example.com", createdAt: new Date(1) }), unsubscribeUrl = "https://example.test/u" } = {}) {
  const state = { sentry: [], workerDeps: null, enqueued: null };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@sentry/nextjs": { captureException: (error, context) => state.sentry.push({ error, context }) },
    "@/lib/emailOutboxAccess": {
      claimEmailOutboxJob: claim,
      enqueueLegacyEmailOutbox: async (row) => {
        state.enqueued = row;
        return { jobId: "job", created: true };
      },
    },
    "@/lib/emailOutboxWorker": {
      processClaimedEmailOutboxJob: async (_claim, deps) => {
        state.workerDeps = deps;
        return "sent";
      },
    },
    "@/lib/email": { isEmailProviderConfigured: () => true },
    "@/lib/unsubscribeToken": { buildUnsubscribeUrl: () => unsubscribeUrl },
    "@/lib/emailPreferencePolicy": {
      isOptionalEmailPreferenceKey: (key) => key === "EMAIL_NEW_MESSAGE",
    },
    "@/lib/notificationPreferenceKeys": { isValidEmailPreferenceKey: () => true },
    "@/lib/emailSuppression": { normalizeEmailAddress: (email) => email },
    "@/lib/emailOutboxState": { emailOutboxDedupKey: (key) => key },
    "@/lib/sanitize": { truncateText: (text, max) => Array.from(text).slice(0, max).join("") },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Date, console, process,
    require: (name) => dependencies[name] ?? (name === "node:crypto" ? require(name) : stub()),
  }, { filename: path });
  return { state, exports };
}

test("a database failure after commit does not look like a failed refund or label", async () => {
  const subject = fixture({
    claim: async () => {
      throw new Error("connection reset");
    },
  });
  assert.equal(await subject.exports.processEmailOutboxJobById("job"), "failed");
  assert.equal(subject.state.sentry.length, 1);
});

test("optional mail waits, before any provider work, when no unsubscribe link can be built", async () => {
  const subject = fixture({
    unsubscribeUrl: null,
    claim: async () => ({ preferenceKey: "EMAIL_NEW_MESSAGE", recipientEmail: "a@example.com", createdAt: new Date(1) }),
  });
  await subject.exports.processEmailOutboxJobById("job");
  assert.equal(subject.state.workerDeps.providerConfigured, false);
});

test("transactional mail does not need an unsubscribe link", async () => {
  const subject = fixture({ unsubscribeUrl: null });
  await subject.exports.processEmailOutboxJobById("job");
  assert.equal(subject.state.workerDeps.providerConfigured, true);
});

