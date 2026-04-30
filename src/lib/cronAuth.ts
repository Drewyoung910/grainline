import { createHash, timingSafeEqual } from "crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function secretMatches(bearer: string, secret: string | undefined): boolean {
  if (!secret) return false;
  return timingSafeEqual(digest(bearer), digest(secret));
}

export function verifyCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return (
    secretMatches(bearer, cronSecret) ||
    secretMatches(bearer, process.env.CRON_SECRET_PREVIOUS)
  );
}
