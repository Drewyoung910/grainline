export const CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS = Object.freeze([
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

export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_FUNCTIONS = Object.freeze([
  { name: "grainline_checkout_reservation_seller_witness", argumentTypes: "text", runtimeExecute: false, volatility: "s", parallelSafety: "r", language: "sql" },
  { name: "grainline_checkout_reservation_listing_witness", argumentTypes: "text", runtimeExecute: false, volatility: "s", parallelSafety: "r", language: "sql" },
  { name: "grainline_checkout_reservation_variant_source_valid", argumentTypes: "text, text[], integer", runtimeExecute: false, volatility: "s", parallelSafety: "r", language: "sql" },
  { name: "grainline_checkout_reservation_create_cart_consistent", argumentTypes: "text, text, text, text, text, jsonb", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
  { name: "grainline_checkout_reservation_create_single_consistent", argumentTypes: "text, text, integer, text[], text, jsonb", runtimeExecute: true, volatility: "v", parallelSafety: "u" },
]);

export const CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS = Object.freeze([
  ...CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS,
  ...CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_FUNCTIONS,
]);

// The production grant inventory remains on the compatible, applied catalog.
// Candidate-only functions stay outside that inventory until their migration
// is sealed and reviewed.
export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS =
  CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS;

export const CHECKOUT_STOCK_RESERVATION_PRIVATE_FUNCTION_NAMES = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS
    .filter((entry) => !entry.runtimeExecute)
    .map((entry) => entry.name),
);

export const CHECKOUT_STOCK_RESERVATION_RUNTIME_FUNCTION_SIGNATURES = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS
    .filter((entry) => entry.runtimeExecute)
    .map((entry) => `public."${entry.name}"(${entry.argumentTypes})`),
);
