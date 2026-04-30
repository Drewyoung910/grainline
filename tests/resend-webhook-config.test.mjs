import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { resolveResendWebhookConfig } = await import("../src/lib/resendWebhookConfig.ts");

describe("Resend webhook configuration", () => {
  it("requires both webhook secret and API key", () => {
    assert.deepEqual(resolveResendWebhookConfig({}), {
      ok: false,
      missing: ["RESEND_WEBHOOK_SECRET", "RESEND_API_KEY"],
    });
    assert.deepEqual(resolveResendWebhookConfig({ RESEND_WEBHOOK_SECRET: "whsec" }), {
      ok: false,
      missing: ["RESEND_API_KEY"],
    });
    assert.deepEqual(resolveResendWebhookConfig({ RESEND_API_KEY: "re_key" }), {
      ok: false,
      missing: ["RESEND_WEBHOOK_SECRET"],
    });
  });

  it("trims configured values", () => {
    assert.deepEqual(
      resolveResendWebhookConfig({
        RESEND_API_KEY: " re_key ",
        RESEND_WEBHOOK_SECRET: " whsec ",
      }),
      {
        ok: true,
        apiKey: "re_key",
        webhookSecret: "whsec",
      },
    );
  });
});
