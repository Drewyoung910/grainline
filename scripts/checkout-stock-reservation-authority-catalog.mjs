export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS = Object.freeze([
  { name: "grainline_stripe_webhook_bind_source", argumentTypes: "text, text, bigint, text", runtimeExecute: false, volatility: "v", parallelSafety: "u" },
  { name: "grainline_stripe_webhook_begin", argumentTypes: "text, text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_items_valid", argumentTypes: "jsonb, text, text", runtimeExecute: false, volatility: "i", parallelSafety: "s" },
  { name: "grainline_checkout_reservation_normalize_write", argumentTypes: "", runtimeExecute: false, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_restore_items", argumentTypes: "jsonb", runtimeExecute: false, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_create_cart", argumentTypes: "text, text, text, text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_create_single", argumentTypes: "text, text, integer, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_bind_session", argumentTypes: "text, text, text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_complete", argumentTypes: "text, bigint, text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_checkout_abort", argumentTypes: "text, text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_webhook_restore", argumentTypes: "text, bigint, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_buyer_expired_restore", argumentTypes: "text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_seller_expired_restore", argumentTypes: "text, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_repair_claim_batch", argumentTypes: "integer", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_account_claim_batch", argumentTypes: "text, integer", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_repair_finalize", argumentTypes: "text, bigint, text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_prune_batch", argumentTypes: "integer", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_resume", argumentTypes: "text, text", runtimeExecute: true, volatility: "s", parallelSafety: "s" },
  { name: "grainline_checkout_reservation_export", argumentTypes: "text", runtimeExecute: true, volatility: "s", parallelSafety: "s" },
  { name: "grainline_checkout_reservation_account_scrub", argumentTypes: "text", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
]);

export const CHECKOUT_STOCK_RESERVATION_PRIVATE_FUNCTION_NAMES = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS
    .filter((entry) => !entry.runtimeExecute)
    .map((entry) => entry.name),
);

export const CHECKOUT_STOCK_RESERVATION_RUNTIME_FUNCTION_SIGNATURES = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS
    .filter((entry) => entry.runtimeExecute)
    .map((entry) => `public."${entry.name}"(${entry.argumentTypes})`),
);
