import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.SHIPPING_RATE_SECRET;
export const SHIPPING_RATE_TOKEN_TTL_SECONDS = 30 * 60;
export const SHIPPING_RATE_FUTURE_SKEW_SECONDS = 5 * 60;

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
// Fields are explicit and ordered. Use a JSON array rather than a separator-
// joined string so third-party display names containing ":" cannot create
// alternate field boundaries that hash to the same canonical text.
// contextId: sellerId for cart, listingId for buy-now.
function canonicalInput(
  objectId: string,
  amountCents: number,
  displayName: string,
  carrier: string,
  estDays: number | null,
  contextId: string,
  buyerId: string,
  buyerPostal: string,
  expiresAt: number,
): string {
  return JSON.stringify([
    objectId,
    amountCents,
    displayName,
    carrier,
    estDays,
    contextId,
    buyerId,
    buyerPostal,
    expiresAt,
  ]);
}

export type SignedRateFields = {
  objectId: string;
  amountCents: number;
  displayName: string;
  carrier: string;
  estDays: number | null;
  contextId: string;
  buyerId: string;
  buyerPostal: string;
};

export function signRate(
  fields: SignedRateFields,
  ttlSeconds = SHIPPING_RATE_TOKEN_TTL_SECONDS,
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const input = canonicalInput(
    fields.objectId,
    fields.amountCents,
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerId,
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
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyRateResult {
  // Check expiry BEFORE computing HMAC — avoids unnecessary
  // crypto on expired tokens and gives clearer error messages.
  const now = nowSeconds;
  if (now > expiresAt) {
    return {
      ok: false,
      error:
        "Shipping rates have expired. Please go back " +
        "and re-select a shipping option.",
      status: 422,
    };
  }
  if (expiresAt > now + SHIPPING_RATE_TOKEN_TTL_SECONDS + SHIPPING_RATE_FUTURE_SKEW_SECONDS) {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }

  const expected = canonicalInput(
    fields.objectId,
    fields.amountCents,
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerId,
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
