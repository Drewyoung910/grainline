/**
 * Shared boundary for buyer quotes, checkout validation, and webhook parsing.
 * Keep every shipping-rate ingress on the same contract so a rate displayed to
 * the buyer cannot be rejected later solely because its estimate was out of
 * range.
 */
export const SHIPPING_ESTIMATED_DAYS_MAX = 60;
