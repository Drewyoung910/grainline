BEGIN;

-- Order and shipping application paths use fixed SECURITY DEFINER authority
-- functions. Keep the two successor tables outside the Core Order RLS release,
-- but remove unused ordinary-runtime table authority so a leaked runtime login
-- cannot read or rewrite retained item snapshots or persisted label quotes.
REVOKE ALL ON TABLE
  public."OrderItem",
  public."OrderShippingRateQuote"
FROM PUBLIC, grainline_app_runtime;

COMMIT;
