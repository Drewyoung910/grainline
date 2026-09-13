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

export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS = Object.freeze([
  ...CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS,
  ...CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_FUNCTIONS,
]);

// Historical release verifiers still use the candidate name for the exact
// pre-production package. It now aliases the applied source-consistent catalog.
export const CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS =
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS;

// Production authority now includes the applied source-consistency successor.
export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS =
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS;

export const CHECKOUT_STOCK_RESERVATION_RETIRED_CREATION_FUNCTION_NAMES =
  Object.freeze([
    "grainline_checkout_reservation_create_cart",
    "grainline_checkout_reservation_create_single",
  ]);

const RETIRED_CREATION_FUNCTION_NAME_SET = new Set(
  CHECKOUT_STOCK_RESERVATION_RETIRED_CREATION_FUNCTION_NAMES,
);

// Phase A runs only after every predecessor deployment has drained. The two
// original creation functions remain installed for reversible compatibility,
// but their runtime EXECUTE grants are retired so callers cannot bypass the
// source-consistent one-statement successors.
export const CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS.map((entry) => (
    RETIRED_CREATION_FUNCTION_NAME_SET.has(entry.name)
      ? Object.freeze({ ...entry, runtimeExecute: false })
      : entry
  )),
);

export const CHECKOUT_STOCK_RESERVATION_PRIVATE_FUNCTION_NAMES = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS
    .filter((entry) => !entry.runtimeExecute)
    .map((entry) => entry.name),
);

export const CHECKOUT_STOCK_RESERVATION_RUNTIME_FUNCTION_SIGNATURES = Object.freeze(
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENT_FUNCTIONS
    .filter((entry) => entry.runtimeExecute)
    .map((entry) => `public."${entry.name}"(${entry.argumentTypes})`),
);

export const CHECKOUT_STOCK_RESERVATION_ACTIVATED_PRIVATE_FUNCTION_NAMES =
  Object.freeze(
    CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
      .filter((entry) => !entry.runtimeExecute)
      .map((entry) => entry.name),
  );

export const CHECKOUT_STOCK_RESERVATION_ACTIVATED_RUNTIME_FUNCTION_SIGNATURES =
  Object.freeze(
    CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
      .filter((entry) => entry.runtimeExecute)
      .map((entry) => `public."${entry.name}"(${entry.argumentTypes})`),
  );
