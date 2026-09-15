import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DOMAIN = "grainline:clerk-sentinel-receipt:v1\n";
const digest = value => createHash("sha256").update(value).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function mac(secret, value) {
  const bytes = Buffer.from(secret, "utf8");
  try { return createHmac("sha256", bytes).update(DOMAIN).update(JSON.stringify(value)).digest("hex"); }
  finally { bytes.fill(0); }
}
const validSecret = secret => typeof secret === "string" && /^whsec_[A-Za-z0-9+/]{20,1024}={0,2}$/.test(secret);
const synthetic = value => typeof value === "string" && /^user_grainline_webhook_sentinel_[a-f0-9]{32}$/.test(value);
// Exact static user.deleted example read from Clerk's managed Svix schema.
// This identifies a proof candidate, never permission to delete or send. A fresh
// runtime absence check is still mandatory before an operator sends it.
export const CLERK_PROVIDER_EXAMPLE_USER_SHA256 = "9a5d23d9b2e4917a244acd51831e2ceb4d1051dfa6d7cc5503064d101e1c2382";
export const CLERK_PROVIDER_EXAMPLE_PAYLOAD_SHA256 = "96aee0fb9d16f052ecb336457856fb14ab6dd84dac6177cb27346ca5c9997cfe";
export const isClerkReceiptUserId = value => synthetic(value) || (typeof value === "string"
  && /^user_[A-Za-z0-9_-]{8,128}$/.test(value) && digest(value) === CLERK_PROVIDER_EXAMPLE_USER_SHA256);
const sentinel = isClerkReceiptUserId;
export function clerkReceiptCanonicalPayload(id) {
  if (!sentinel(id)) throw new Error("Clerk receipt candidate is not pinned.");
  const data = { deleted: true, id, object: "user" };
  if (synthetic(id)) return { data, object: "event", type: "user.deleted" };
  return { data, event_attributes: { http_request: { client_ip: "0.0.0.0",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" } },
    object: "event", timestamp: 1661861640000, type: "user.deleted" };
}
const canonical = clerkReceiptCanonicalPayload;
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export function isClerkReceiptPayload(value, id) {
  try { return sentinel(id) && JSON.stringify(ordered(value)) === JSON.stringify(canonical(id)); }
  catch { return false; }
}

// Called only after the route's real Svix verification, for the exact custom
// sentinel or pinned provider example. Describes one successful invocation,
// excluding its required ClerkWebhookEvent reservation/processing writes.
export function prepareClerkSentinelReceipt({ body, svixId, svixTimestamp, verifiedEvent, secret }) {
  try {
    if (typeof body !== "string" || Buffer.byteLength(body) > 512 * 1024 || !validSecret(secret)
      || typeof svixId !== "string" || !/^msg_[A-Za-z0-9_-]{8,128}$/.test(svixId)
      || typeof svixTimestamp !== "string" || !/^[1-9][0-9]{9,11}$/.test(svixTimestamp)) return null;
    const event = JSON.parse(body);
    for (const value of [event, verifiedEvent]) {
      if (!isClerkReceiptPayload(value, value?.data?.id)) return null;
    }
    if (event.data.id !== verifiedEvent.data.id) return null;
    const selected = Object.freeze({ schemaVersion: 1, operation: "clerk-sentinel-delivery",
      messageId: svixId, svixTimestamp, rawPayloadSha256: digest(body),
      canonicalPayloadSha256: digest(JSON.stringify(canonical(event.data.id))), sentinelSha256: digest(event.data.id) });
    return (outcome, completedAt = new Date().toISOString()) => {
      if (!["absent-user", "duplicate"].includes(outcome) || typeof completedAt !== "string"
        || !Number.isFinite(Date.parse(completedAt)) || new Date(completedAt).toISOString() !== completedAt) return null;
      const value = { ...selected, outcome, completedAt };
      return Object.freeze({ ...value, mac: mac(secret, value) });
    };
  } catch { return null; }
}

export function verifyClerkSentinelReceipt({ receipt, secret, messageId, sentinelClerkId, outcome, notBefore, notAfter }) {
  try {
    if (!validSecret(secret) || !sentinel(sentinelClerkId)
      || !exact(receipt, ["schemaVersion", "operation", "messageId", "svixTimestamp", "rawPayloadSha256",
        "canonicalPayloadSha256", "sentinelSha256", "outcome", "completedAt", "mac"])) throw 0;
    if (receipt.schemaVersion !== 1 || receipt.operation !== "clerk-sentinel-delivery" || receipt.messageId !== messageId
      || !/^msg_[A-Za-z0-9_-]{8,128}$/.test(messageId) || !/^[1-9][0-9]{9,11}$/.test(receipt.svixTimestamp)
      || !["absent-user", "duplicate"].includes(outcome) || receipt.outcome !== outcome || !hex(receipt.rawPayloadSha256)
      || receipt.canonicalPayloadSha256 !== digest(JSON.stringify(canonical(sentinelClerkId)))
      || receipt.sentinelSha256 !== digest(sentinelClerkId) || !hex(receipt.mac)) throw 0;
    const completed = Date.parse(receipt.completedAt), signed = Number(receipt.svixTimestamp) * 1000;
    if (!Number.isSafeInteger(notBefore) || !Number.isSafeInteger(notAfter) || notBefore > notAfter
      || typeof receipt.completedAt !== "string" || !Number.isFinite(completed)
      || new Date(completed).toISOString() !== receipt.completedAt || completed < notBefore || completed > notAfter
      || Math.abs(completed - signed) > 300_000) throw 0;
    // Reconstruct field order; wire JSON property ordering is not authority.
    const value = { schemaVersion: 1, operation: "clerk-sentinel-delivery", messageId: receipt.messageId,
      svixTimestamp: receipt.svixTimestamp, rawPayloadSha256: receipt.rawPayloadSha256,
      canonicalPayloadSha256: receipt.canonicalPayloadSha256, sentinelSha256: receipt.sentinelSha256,
      outcome: receipt.outcome, completedAt: receipt.completedAt };
    if (!timingSafeEqual(Buffer.from(receipt.mac, "hex"), Buffer.from(mac(secret, value), "hex"))) throw 0;
    return Object.freeze(value);
  } catch { throw new Error("Clerk sentinel receipt rejected; no signature, payload or handler witness accepted."); }
}
