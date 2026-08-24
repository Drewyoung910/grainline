export const ACCOUNT_PAYMENT_HISTORY_WHERE = {
  eventType: "REFUND",
} as const;

// Buyer portability needs the financial outcome, not provider or internal
// reconciliation identifiers. Disputes are exported through the participant
// Case record instead of exposing the private service ledger.
export const BUYER_ACCOUNT_PAYMENT_HISTORY_SELECT = {
  eventType: true,
  amountCents: true,
  currency: true,
  status: true,
  createdAt: true,
} as const;

// Sellers additionally receive the bounded refund reason used for their
// accounting record. Internal descriptions and metadata remain excluded.
export const SELLER_ACCOUNT_PAYMENT_HISTORY_SELECT = {
  eventType: true,
  amountCents: true,
  currency: true,
  status: true,
  reason: true,
  createdAt: true,
} as const;
