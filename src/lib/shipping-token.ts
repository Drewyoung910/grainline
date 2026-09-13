import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SHIPPING_RATE_TOKEN_TTL_SECONDS = 30 * 60;
export const SHIPPING_RATE_FUTURE_SKEW_SECONDS = 5 * 60;

// Fail loudly if secret is missing.
// Do NOT silently return unsigned rates or allow
// unsigned verification — missing secret in prod means
// all checkouts fail with a clear error rather than a
// silent security hole.
function getCurrentSecret(): string {
  const secret = process.env.SHIPPING_RATE_SECRET;
  if (!secret) {
    throw new Error(
      "SHIPPING_RATE_SECRET env var is not set. " +
        "Add it to .env and Vercel environment variables.",
    );
  }
  return secret;
}

function getVerificationSecrets(): string[] {
  const current = getCurrentSecret();
  const previous = process.env.SHIPPING_RATE_SECRET_PREVIOUS?.trim();
  return previous && previous !== current ? [current, previous] : [current];
}

function normalizedDestinationField(value: string, casing: "lower" | "upper") {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return casing === "upper" ? normalized.toUpperCase() : normalized.toLowerCase();
}

// Canonical HMAC input string.
// Fields are explicit and ordered. Use a JSON array rather than a separator-
// joined string so third-party display names containing ":" cannot create
// alternate field boundaries that hash to the same canonical text.
// contextId: sellerId for cart, listingId for buy-now.
function legacyCanonicalInput(
  objectId: string,
  amountCents: number,
  currency: string,
  displayName: string,
  carrier: string,
  estDays: number | null,
  contextId: string,
  buyerId: string,
  buyerPostal: string,
  subjectHash: string | null | undefined,
  expiresAt: number,
): string {
  return JSON.stringify([
    objectId,
    amountCents,
    currency.toLowerCase(),
    displayName,
    carrier,
    estDays,
    contextId,
    buyerId,
    buyerPostal,
    subjectHash ?? "",
    expiresAt,
  ]);
}

function canonicalInput(
  fields: SignedRateFields,
  expiresAt: number,
): string {
  return JSON.stringify([
    "shipping-rate-v2",
    fields.objectId,
    fields.amountCents,
    fields.currency.toLowerCase(),
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerId,
    normalizedDestinationField(fields.buyerCity, "lower"),
    normalizedDestinationField(fields.buyerState, "upper"),
    normalizedDestinationField(fields.buyerPostal, "upper"),
    normalizedDestinationField(fields.buyerCountry, "upper"),
    fields.subjectHash ?? "",
    expiresAt,
  ]);
}

export type SignedRateFields = {
  objectId: string;
  amountCents: number;
  currency: string;
  displayName: string;
  carrier: string;
  estDays: number | null;
  contextId: string;
  buyerId: string;
  buyerCity: string;
  buyerState: string;
  buyerPostal: string;
  buyerCountry: string;
  subjectHash?: string | null;
};

export function shippingRateSubjectHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 32);
}

export function signRate(
  fields: SignedRateFields,
  ttlSeconds = SHIPPING_RATE_TOKEN_TTL_SECONDS,
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const input = canonicalInput(fields, expiresAt);
  const token = createHmac("sha256", getCurrentSecret()).update(input).digest("hex");
  return { token, expiresAt };
}

export function shippingRateExpiresAtIsTooFarFuture(
  expiresAt: number,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  return expiresAt > nowSeconds + SHIPPING_RATE_TOKEN_TTL_SECONDS + SHIPPING_RATE_FUTURE_SKEW_SECONDS;
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
  if (shippingRateExpiresAtIsTooFarFuture(expiresAt, now)) {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }

  const legacyExpected = legacyCanonicalInput(
    fields.objectId,
    fields.amountCents,
    fields.currency,
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerId,
    fields.buyerPostal,
    fields.subjectHash,
    expiresAt,
  );
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }
  const actualBuf = Buffer.from(token, "hex");
  const canonicalInputs = [canonicalInput(fields, expiresAt), legacyExpected];
  let matched = false;
  for (const secret of getVerificationSecrets()) {
    for (const input of canonicalInputs) {
      const expectedBuf = createHmac("sha256", secret).update(input).digest();
      // Every candidate is a fixed-length SHA-256 digest. Evaluate all
      // current/previous and v2/legacy candidates so the accepted key/version
      // is not exposed by an early comparison exit.
      matched = timingSafeEqual(expectedBuf, actualBuf) || matched;
    }
  }

  if (!matched) {
    return {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    };
  }

  return { ok: true };
}
