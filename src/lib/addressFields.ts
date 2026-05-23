import { sanitizeText, sanitizeUserName, truncateText } from "./sanitize.ts";

const ADDRESS_LINE_BREAKS = /[\r\n\u0085\u2028\u2029]+/g;

export function sanitizeAddressField(value: string, maxLength: number) {
  return truncateText(
    sanitizeText(value)
      .replace(ADDRESS_LINE_BREAKS, " ")
      .replace(/\s+/g, " "),
    maxLength,
  ).trim();
}

export function sanitizeOptionalAddressField(
  value: string | null | undefined,
  maxLength: number,
) {
  if (!value) return null;
  return sanitizeAddressField(value, maxLength) || null;
}

export function sanitizeAddressName(value: string, maxLength = 100) {
  return sanitizeUserName(
    sanitizeAddressField(value, maxLength),
    maxLength,
  );
}

export type CheckoutShippingAddressInput = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone?: string | null;
};

export function normalizeCheckoutShippingAddress(address: CheckoutShippingAddressInput) {
  return {
    name: sanitizeAddressName(address.name, 100),
    line1: sanitizeAddressField(address.line1, 200),
    line2: sanitizeOptionalAddressField(address.line2, 200),
    city: sanitizeAddressField(address.city, 100),
    state: sanitizeAddressField(address.state, 2).toUpperCase(),
    postalCode: sanitizeAddressField(address.postalCode, 20),
    phone: sanitizeOptionalAddressField(address.phone, 20),
  };
}
