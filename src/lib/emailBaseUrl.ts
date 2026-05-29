import { normalizeAppBaseUrl } from "./appBaseUrl.ts";

type Env = Record<string, string | undefined>;

export function resolveEmailAppUrl(env: Env = process.env) {
  const configured = env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim()) return normalizeAppBaseUrl(configured);

  if (env.RESEND_API_KEY && env.EMAIL_FROM?.trim()) {
    throw new Error("NEXT_PUBLIC_APP_URL env var is required when live email sending is enabled.");
  }

  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL env var is required in production.");
  }

  return "http://localhost:3000";
}

export const EMAIL_APP_URL = resolveEmailAppUrl();
