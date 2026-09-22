// Temporary primary-endpoint signing-secret overlap for an incident cutover.
// Verification yields the same event regardless of which reviewed secret
// matched; callers must never log the secret or disclose the match.

/**
 * @template T
 * @param {{body: string, signature: string, primarySecret: string,
 *   nextSecret?: string | undefined,
 *   constructEvent: (body: string, signature: string, secret: string) => T}} input
 * @returns {T}
 */
export function constructPrimaryStripeWebhookEvent({ body, signature, primarySecret,
  nextSecret, constructEvent }) {
  if (typeof primarySecret !== "string" || primarySecret.length === 0
    || (nextSecret !== undefined && (typeof nextSecret !== "string"
      || nextSecret.length === 0 || nextSecret === primarySecret))) {
    throw new Error("Stripe primary webhook signing-secret configuration is invalid");
  }
  for (const secret of nextSecret ? [primarySecret, nextSecret] : [primarySecret]) {
    try { return constructEvent(body, signature, secret); }
    catch { /* Another reviewed signing secret may match during the overlap. */ }
  }
  throw new Error("Stripe primary webhook signature is invalid");
}
