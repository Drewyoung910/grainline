type ResendWebhookEnv = Record<string, string | null | undefined>;
type ResendWebhookEnvKey = "RESEND_API_KEY" | "RESEND_WEBHOOK_SECRET";

export type ResendWebhookConfig =
  | {
      ok: true;
      apiKey: string;
      webhookSecret: string;
    }
  | {
      ok: false;
      missing: ResendWebhookEnvKey[];
    };

export function resolveResendWebhookConfig(env: ResendWebhookEnv = process.env): ResendWebhookConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  const webhookSecret = env.RESEND_WEBHOOK_SECRET?.trim();
  const missing: ResendWebhookEnvKey[] = [];

  if (!webhookSecret) missing.push("RESEND_WEBHOOK_SECRET");
  if (!apiKey) missing.push("RESEND_API_KEY");

  if (!webhookSecret || !apiKey) {
    return { ok: false, missing };
  }

  return { ok: true, apiKey, webhookSecret };
}
