type Env = Record<string, string | undefined>;

export function normalizeAppBaseUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function resolveAppBaseUrl(env: Env = process.env) {
  const configured = env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim()) return normalizeAppBaseUrl(configured);

  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL env var is required in production.");
  }

  return "http://localhost:3000";
}

export const APP_BASE_URL = resolveAppBaseUrl();
