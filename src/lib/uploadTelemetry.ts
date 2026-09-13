import { createHash } from "crypto";

export function uploadTelemetryKeyHash(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
