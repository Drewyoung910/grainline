import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.SHIPPING_RATE_SECRET;

// Fail loudly if secret is missing.
// Do NOT silently return unsigned rates or allow
// unsigned verification — missing secret in prod means
// all checkouts fail with a clear error rather than a
// silent security hole.
function getSecret(): string {
  if (!SECRET) {
    throw new Error(
      "SHIPPING_RATE_SECRET env var is not set. " +
        "Add it to .env and Vercel environment variables.",
    );
  }
  return SECRET;
}

// Canonical HMAC input string.
// Fields are explicit and ordered — do NOT use
// JSON.stringify (key ordering is not guaranteed stable
// across refactors that add/reorder fields).
// contextId: sellerId for cart, listingId for buy-now.
function canonicalInput(
  objectId: string,
  amountCents: number,
  displayName: string,
  carrier: string,
  estDays: number | null,
  contextId: string,
  buyerPostal: string,
  expiresAt: number,
): string {
  return [
    objectId,
    String(amountCents),
    displayName,
    carrier,
    estDays != null ? String(estDays) : "null",
    contextId,
    buyerPostal,
    String(expiresAt),
  ].join(":");
}

export type SignedRateFields = {
  objectId: string;
  amountCents: number;
  displayName: string;
  carrier: string;
  estDays: number | null;
  contextId: string;
  buyerPostal: string;
};

export function signRate(
  fields: SignedRateFields,
  ttlSeconds = 1800, // 30 minutes
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const input = canonicalInput(
    fields.objectId,
    fields.amountCents,
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerPostal,
    expiresAt,
  );
  const token = createHmac("sha256", getSecret()).update(input).digest("hex");
  return { token, expiresAt };
}

export type VerifyRateResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 422 };

export function verifyRate(
  fields: SignedRateFields,
  token: string,
  expiresAt: number,
): VerifyRateResult {
  // Check expiry BEFORE computing HMAC — avoids unnecessary
  // crypto on expired tokens and gives clearer error messages.
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresAt) {
    return {
      ok: false,
      error:
        "Shipping rates have expired. Please go back " +
        "and re-select a shipping option.",
      status: 422,
    };
  }

  const expected = canonicalInput(
    fields.objectId,
    fields.amountCents,
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerPostal,
    expiresAt,
  );
  const expectedHmac = createHmac("sha256", getSecret())
    .update(expected)
    .digest("hex");

  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHmac, "hex");
    actualBuf = Buffer.from(token, "hex");
  } catch {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }

  // Length check required before timingSafeEqual.
  if (expectedBuf.length !== actualBuf.length) {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }

  // timingSafeEqual prevents timing attacks —
  // do NOT use string === comparison on HMACs.
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }

  return { ok: true };
}
