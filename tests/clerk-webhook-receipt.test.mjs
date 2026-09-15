import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as receipts from "../src/lib/clerkWebhookReceipt.mjs";

const require = createRequire(import.meta.url), ts = require("typescript"), { Webhook } = require("svix");
const SECRET = "whsec_" + Buffer.alloc(32, 17).toString("base64");
const OTHER = "whsec_" + Buffer.alloc(32, 18).toString("base64");
const ID = "msg_synthetic_receipt_message", SENTINEL = "user_grainline_webhook_sentinel_" + "1".repeat(32);
const payload = () => ({ data: { deleted: true, id: SENTINEL, object: "user" }, object: "event", type: "user.deleted" });
const sha = v => createHash("sha256").update(v).digest("hex");
const bodyModule = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(readFileSync("src/lib/requestBody.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => {
  assert.equal(name, "./httpStatus.ts"); return require("../src/lib/httpStatus.ts");
}, bodyModule, bodyModule.exports);
function route(controls = {}) {
  const counts = { reserve: 0, mark: 0, anonymize: 0, unexpected: 0 };
  let incomingHeaders;
  const unexpected = () => { counts.unexpected++; throw new Error("Unexpected business side effect"); };
  const prisma = { clerkWebhookEvent: {
    async create() { counts.reserve++; if (controls.reservationFailure) throw new Error("database unavailable");
      if (controls.duplicate || controls.inProgress) throw { code: "P2002" }; },
    async findUnique() { return { processedAt: controls.duplicate ? new Date() : null, processingStartedAt: new Date() }; },
    async update() { counts.mark++; if (controls.markFailure) throw new Error("mark unavailable"); },
    async updateMany() { return { count: 0 }; },
  } };
  const dependencies = {
    svix: { Webhook }, "next/headers": { headers: async () => incomingHeaders },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/db": { prisma }, "@/lib/clerkWebhookReceipt.mjs": receipts,
    "@/lib/accountDeletion": { anonymizeUserAccountByClerkId: async id => {
      counts.anonymize++; assert.equal(id, controls.ordinary ? "user_ordinary" : SENTINEL);
      return controls.anonymized ?? { ok: true, alreadyDeleted: true, userAbsent: true };
    } },
    "@/lib/requestBody": { ...bodyModule.exports, readBoundedWebhookText: async (req, limit) => {
      if (controls.bodyFailure) throw new Error("bad stream"); return bodyModule.exports.readBoundedWebhookText(req, limit);
    } },
    "@/lib/httpStatus": { HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, SERVICE_UNAVAILABLE: 503, PAYLOAD_TOO_LARGE: 413 } },
    "@sentry/nextjs": { captureException() {}, captureMessage() {} },
    "@/lib/webhookFailureSpike": { recordWebhookFailureSpike: async () => {} },
    "@/lib/emailOutboxSanitize": { sanitizeEmailOutboxError: () => "sanitized" },
  };
  for (const name of ["ensureUser", "email", "emailOutbox", "clerkWebhookEmail", "clerkSessionSecurity", "clerkUserLifecycle", "emailSuppression", "sanitize"]) {
    dependencies[`@/lib/${name}`] = new Proxy({}, { get: () => unexpected });
  }
  const compiled = ts.transpileModule(readFileSync("src/app/api/clerk/webhook/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", compiled.outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, mod, mod.exports, { env: { CLERK_WEBHOOK_SECRET: controls.noSecret ? undefined : SECRET } });
  return { counts, async run(body = JSON.stringify(payload())) {
    const at = new Date(), signingTime = controls.stale ? new Date(at.getTime() - 600_000) : at;
    incomingHeaders = new Headers({ "svix-id": ID, "svix-timestamp": String(Math.floor(signingTime.getTime() / 1000)),
      "svix-signature": new Webhook(controls.wrongKey ? OTHER : SECRET).sign(ID, signingTime,
        controls.tampered ? body + " " : controls.stripBomSignature ? body.slice(1) : body) });
    if (controls.missingHeaders) incomingHeaders.delete("svix-signature");
    const response = await mod.exports.POST(new Request("https://thegrainline.com/api/clerk/webhook", { method: "POST", body }));
    return { status: response.status, body: await response.json(), at };
  } };
}
function verify(receipt, extra = {}) { return receipts.verifyClerkSentinelReceipt({ receipt, secret: SECRET,
  messageId: ID, sentinelClerkId: SENTINEL, outcome: "absent-user", notBefore: Date.now() - 60_000, notAfter: Date.now() + 1000, ...extra }); }

test("real Svix verification produces a keyed exact-raw-payload receipt only after absent-user completion", async () => {
  const f = route(), body = JSON.stringify(payload(), null, 2), result = await f.run(body);
  assert.equal(result.status, 200); const receipt = verify(result.body.receipt);
  assert.equal(receipt.rawPayloadSha256, sha(body)); assert.notEqual(receipt.rawPayloadSha256, sha(JSON.stringify(payload())));
  assert.equal(receipt.canonicalPayloadSha256, sha(JSON.stringify(payload())));
  assert.deepEqual(f.counts, { reserve: 1, mark: 1, anonymize: 1, unexpected: 0 });
  assert.equal(JSON.stringify(result.body).includes(SECRET), false); assert.equal(JSON.stringify(result.body).includes(SENTINEL), false);
});
test("a signed duplicate receives a distinct receipt and does not repeat business handling", async () => {
  const f = route({ duplicate: true }), result = await f.run();
  assert.equal(result.status, 200); verify(result.body.receipt, { outcome: "duplicate" });
  assert.throws(() => verify(result.body.receipt));
  assert.deepEqual(f.counts, { reserve: 1, mark: 0, anonymize: 0, unexpected: 0 });
});
for (const mode of ["wrongKey", "tampered", "stale", "missingHeaders", "bodyFailure", "noSecret"]) {
  test(`${mode} never emits a receipt or accesses a reservation`, async () => {
    const f = route({ [mode]: true }), result = await f.run();
    assert.equal(result.status, mode === "noSecret" ? 500 : 400); assert.equal(result.body.receipt, undefined);
    assert.equal(f.counts.reserve, 0); assert.equal(f.counts.anonymize, 0);
  });
}
for (const controls of [{ inProgress: true }, { reservationFailure: true }, { markFailure: true },
  { anonymized: { inProgress: true } }, { anonymized: { ok: true, alreadyDeleted: true } },
  { anonymized: { ok: false, blocked: true } }]) {
  test(`unfinished or non-absent handling has no receipt: ${JSON.stringify(controls)}`, async () => {
    if (controls.markFailure) { await assert.rejects(route(controls).run(), /mark unavailable/); return; }
    const result = await route(controls).run(); assert.equal(result.body.receipt, undefined);
  });
}
test("ordinary signed deletion keeps its original response shape", async () => {
  const event = payload(); event.data.id = "user_ordinary";
  const f = route({ ordinary: true }), result = await f.run(JSON.stringify(event));
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true }); assert.equal(f.counts.anonymize, 1);
});
test("strict webhook decoding preserves signed bytes and rejects invalid UTF-8 without changing ordinary text reads", async () => {
  const { readBoundedWebhookText, readBoundedText } = bodyModule.exports;
  const input = bytes => new Request("https://example.com", { method: "POST", body: bytes });
  const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
  assert.deepEqual(Buffer.from(await readBoundedWebhookText(input(bom), 20)), bom);
  assert.equal(await readBoundedText(input(bom), 20), "{}");
  await assert.rejects(readBoundedWebhookText(input(Buffer.from([0xc0, 0xaf])), 20));
  await assert.rejects(readBoundedWebhookText(input(Buffer.alloc(21)), 20), /exceeds/i);
  const unicode = Buffer.from('{"value":"é 🧵"}');
  assert.deepEqual(Buffer.from(await readBoundedWebhookText(input(unicode), 100)), unicode);
});
test("an unsigned BOM cannot be removed to make an altered request pass signature verification", async () => {
  const f = route({ stripBomSignature: true }), result = await f.run("\ufeff" + JSON.stringify(payload()));
  // The signature covers the original JSON; transport bytes include an extra
  // BOM. The strict decoder retains it and the real SDK rejects the signature.
  assert.equal(result.status, 400); assert.equal(result.body.receipt, undefined); assert.equal(f.counts.reserve, 0);
});
test("unsigned extra fields and malformed sentinel payloads cannot be turned into receipts", () => {
  for (const change of [v => { v.data.id = "user_ordinary"; }, v => { v.extra = true; },
    v => { v.data.deleted = false; }, v => { v.data.extra = true; }, v => { v.type = "user.created"; }]) {
    const event = payload(); change(event);
    assert.equal(receipts.prepareClerkSentinelReceipt({ body: JSON.stringify(event), verifiedEvent: event,
      svixId: ID, svixTimestamp: String(Math.floor(Date.now() / 1000)), secret: SECRET }), null);
  }
});
test("receipt authentication refuses changed identity, content, time, outcome, secret and extra fields", async () => {
  const receipt = (await route().run()).body.receipt;
  for (const [key, value] of Object.entries({ messageId: "msg_other_receipt", rawPayloadSha256: "0".repeat(64),
    canonicalPayloadSha256: "0".repeat(64), sentinelSha256: "0".repeat(64), outcome: "duplicate",
    completedAt: "2020-01-01T00:00:00.000Z", svixTimestamp: "1000000000", mac: "0".repeat(64), extra: true })) {
    assert.throws(() => verify({ ...receipt, [key]: value }), /receipt rejected/);
  }
  assert.throws(() => verify(receipt, { secret: OTHER }), /receipt rejected/);
  assert.throws(() => verify(receipt, { notBefore: Date.now() + 60_000 }), /receipt rejected/);
  assert.throws(() => verify(receipt, { notAfter: Date.now() - 60_000 }), /receipt rejected/);
  verify(Object.fromEntries(Object.entries(receipt).reverse()));
});
test("the actual deletion helper distinguishes absent and already deleted users without business writes", async () => {
  const compiled = ts.transpileModule(readFileSync("src/lib/accountDeletion.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  for (const user of [null, { id: "synthetic_user", deletedAt: new Date() }]) {
    let reads = 0; const mod = { exports: {} };
    const prisma = { user: { findUnique: async () => { reads++; return user; } } };
    new Function("require", "module", "exports", compiled.outputText)(name => {
      if (name === "@/lib/db") return { prisma };
      if (name === "node:crypto" || name === "crypto") return require(name);
      return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : () => { throw new Error(`Unexpected dependency: ${name}`); } });
    }, mod, mod.exports);
    const result = await mod.exports.anonymizeUserAccountByClerkId(SENTINEL);
    assert.equal(result.userAbsent, user === null ? true : undefined); assert.equal(reads, 1);
  }
});
