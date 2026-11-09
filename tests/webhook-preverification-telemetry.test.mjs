import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Guardrail: a signed-out flood must not spend Sentry events or Redis commands (X-03).
for (const [path, start, end] of [
  ["src/app/api/stripe/webhook/route.ts", "if (!signature) {", '"Invalid signature"'],
  ["src/app/api/stripe/webhook/connect/route.ts", "if (!signature) {", '"Invalid signature"'],
  ["src/app/api/stripe/webhook/v2/route.ts", "if (!signature) {", '"Invalid signature"'],
  ["src/app/api/resend/webhook/route.ts", "if (!id || !timestamp || !signature) {", '"Invalid webhook signature"'],
]) {
  test(`${path} reports nothing before the signature is proved`, () => {
    const source = readFileSync(path, "utf8");
    const before = source.slice(source.indexOf(start), source.indexOf(end));
    assert.ok(before.length > 0);
    assert.doesNotMatch(before, /Sentry\.capture|recordWebhookFailureSpike/);
  });
}
