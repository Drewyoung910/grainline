BEGIN;

-- The deployed application uses seller-detail v5 and recent-sales v2, whose
-- result types omit buyer email. Keep the older functions for v5/v2's
-- owner-executed implementation chain and rollback inspection, but remove
-- ordinary runtime authority to call the email-bearing projections directly.
REVOKE EXECUTE ON FUNCTION public.grainline_order_seller_detail_v2(text, text)
  FROM grainline_app_runtime;
REVOKE EXECUTE ON FUNCTION public.grainline_order_seller_detail_v3(text, text)
  FROM grainline_app_runtime;
REVOKE EXECUTE ON FUNCTION public.grainline_order_seller_detail_v4(text, text)
  FROM grainline_app_runtime;
REVOKE EXECUTE ON FUNCTION public.grainline_order_seller_recent_sales(text)
  FROM grainline_app_runtime;

COMMIT;
