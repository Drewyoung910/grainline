const SHIPPO_ERROR_BODY_MAX_CHARS = 1200;
const SHIPPO_ADDRESS_REDACTION = "[redacted]";
const SHIPPO_ADDRESS_OBJECT_REDACTION = "[redacted-address]";
const SHIPPO_PII_KEYS = new Set([
  "name",
  "company",
  "street1",
  "street2",
  "city",
  "state",
  "zip",
  "postal",
  "postal_code",
  "phone",
  "email",
]);
const SHIPPO_ADDRESS_OBJECT_KEYS = new Set([
  "address_from",
  "address_to",
  "address",
]);

function sanitizeShippoErrorText(value: string) {
  return value
    .replace(/\b(name|company|street1|street2|city|state|zip|postal(?:_code)?|phone|email)\b\s*[:=]\s*("[^"]*"|[^,;\n}]+)/gi, `$1: ${SHIPPO_ADDRESS_REDACTION}`)
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Trail|Trl|Parkway|Pkwy|Way)\b/gi, SHIPPO_ADDRESS_REDACTION)
    .replace(/\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, SHIPPO_ADDRESS_REDACTION)
    .replace(/\b\d{5}(?:-\d{4})?\b/g, SHIPPO_ADDRESS_REDACTION)
    .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, SHIPPO_ADDRESS_REDACTION);
}

function scrubShippoJson(value: unknown, key = ""): unknown {
  const normalizedKey = key.toLowerCase();
  if (SHIPPO_ADDRESS_OBJECT_KEYS.has(normalizedKey)) return SHIPPO_ADDRESS_OBJECT_REDACTION;
  if (SHIPPO_PII_KEYS.has(normalizedKey)) return SHIPPO_ADDRESS_REDACTION;

  if (typeof value === "string") return sanitizeShippoErrorText(value);
  if (Array.isArray(value)) return value.map((item) => scrubShippoJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        scrubShippoJson(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export function sanitizeShippoProviderErrorBody(text: string) {
  const trimmed = text.trim().slice(0, SHIPPO_ERROR_BODY_MAX_CHARS);
  if (!trimmed) return "";

  try {
    return JSON.stringify(scrubShippoJson(JSON.parse(trimmed)));
  } catch {
    return sanitizeShippoErrorText(trimmed);
  }
}

export function shippoProviderErrorMessage(prefix: string, status: number, statusText: string | null | undefined, body: string) {
  const sanitizedBody = sanitizeShippoProviderErrorBody(body);
  const statusLabel = [status, statusText].filter(Boolean).join(" ");
  return sanitizedBody ? `${prefix}: ${statusLabel}: ${sanitizedBody}` : `${prefix}: ${statusLabel}`;
}
