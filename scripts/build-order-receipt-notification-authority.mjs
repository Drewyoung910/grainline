import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const predecessorPath =
  "prisma/migrations/20260825010000_prepare_blocked_checkout_refund_delivery/migration.sql";
const migrationDirectory =
  "prisma/migrations/20260901120000_prepare_order_receipt_notification_authority";
const migrationPath = path.join(migrationDirectory, "migration.sql");

const fulfillmentBranch = `  ELSIF p_source_type = 'order_fulfillment' THEN
    SELECT
      CASE
        WHEN source_audit."actorId" = source_order."buyerId"
          THEN '/dashboard/sales/' || source_order.id
        ELSE '/dashboard/orders/' || source_order.id
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN 'Your piece is on its way!'
        WHEN 'ready_for_pickup' THEN 'Ready for pickup!'
        WHEN 'delivered' THEN 'Buyer confirmed delivery'
        WHEN 'picked_up' THEN 'Buyer confirmed pickup'
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN CASE
          WHEN COALESCE(source_audit.metadata ->> 'trackingCarrier', '') <> ''
            THEN 'Shipped via ' || (source_audit.metadata ->> 'trackingCarrier')
          ELSE 'Your order has been shipped'
        END
        WHEN 'ready_for_pickup' THEN 'Your order is ready for pickup.'
        WHEN 'delivered' THEN 'The buyer confirmed delivery.'
        WHEN 'picked_up' THEN 'The buyer confirmed pickup.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Order" AS source_order
        ON source_order.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_order."sellerProfileId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'ORDER_FULFILLMENT_TRANSITION'
       AND source_audit."actorType" = 'user'
       AND source_audit."targetType" = 'ORDER'
       AND source_order."paidAt" IS NOT NULL
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentOpenDisputeBlocked" = false
       AND (
         (
           source_audit."actorId" = source_seller."userId"
           AND source_order."buyerId" = p_user_id
           AND p_related_user_id = source_seller."userId"
           AND source_audit.metadata ->> 'action' IN ('shipped', 'ready_for_pickup')
           AND source_audit.metadata ->> 'previousStatus' = 'PENDING'
           AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'shipped' THEN 'SHIPPED'
             WHEN 'ready_for_pickup' THEN 'READY_FOR_PICKUP'
           END
           AND p_type = 'ORDER_SHIPPED'::public."NotificationType"
         )
         OR
         (
           source_audit."actorId" = source_order."buyerId"
           AND source_seller."userId" = p_user_id
           AND p_related_user_id = source_order."buyerId"
           AND source_audit.metadata ->> 'action' IN ('delivered', 'picked_up')
           AND source_audit.metadata ->> 'fulfillmentMethod' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'SHIPPING'
             WHEN 'picked_up' THEN 'PICKUP'
           END
           AND source_audit.metadata ->> 'previousStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'SHIPPED'
             WHEN 'picked_up' THEN 'READY_FOR_PICKUP'
           END
           AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'DELIVERED'
             WHEN 'picked_up' THEN 'PICKED_UP'
           END
           AND source_order."fulfillmentMethod"::text = source_audit.metadata ->> 'fulfillmentMethod'
           AND source_order."fulfillmentStatus"::text = source_audit.metadata ->> 'newStatus'
           AND (
             (source_audit.metadata ->> 'action' = 'delivered' AND source_order."deliveredAt" IS NOT NULL)
             OR
             (source_audit.metadata ->> 'action' = 'picked_up' AND source_order."pickedUpAt" IS NOT NULL)
           )
           AND p_type = 'ORDER_DELIVERED'::public."NotificationType"
         )
       )
     FOR SHARE OF source_audit, source_order, source_seller;
`;

function extractFunction(sql, functionName, dollarTag) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}(`);
  const endMarker = `${dollarTag};`;
  const end = sql.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not extract ${functionName} from ${predecessorPath}`);
  }
  return `${sql.slice(start, end + endMarker.length)}\n`;
}

function buildMigration() {
  const predecessor = fs.readFileSync(predecessorPath, "utf8");
  const original = extractFunction(
    predecessor,
    "grainline_notification_create_core",
    "$grainline_notification_create_core$",
  );
  const branchStart = original.indexOf("  ELSIF p_source_type = 'order_fulfillment' THEN");
  const branchEnd = original.indexOf("  ELSIF p_source_type = 'order_payment' THEN", branchStart);
  if (branchStart < 0 || branchEnd < 0) {
    throw new Error("The sealed predecessor order-fulfillment branch was not found");
  }
  const corrected = `${original.slice(0, branchStart)}${fulfillmentBranch}${original.slice(branchEnd)}`;
  return `-- Compatible Notification authority for buyer-confirmed Order receipt.
--
-- This successor preserves the complete promoted Notification core and changes
-- only the order_fulfillment source branch. Seller shipping/readiness remains
-- buyer-directed; buyer delivery/pickup confirmation becomes seller-directed.
-- Durable Order.sellerProfileId replaces mutable Listing ownership for both
-- directions. Notification RLS/FORCE posture and table grants are unchanged.

${corrected}
REVOKE ALL ON FUNCTION public.grainline_notification_create_core(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
`;
}

const candidate = buildMigration();
const digest = crypto.createHash("sha256").update(candidate).digest("hex");
const mode = process.argv[2] ?? "--verify";

if (mode === "--write") {
  fs.mkdirSync(migrationDirectory, { recursive: true });
  fs.writeFileSync(migrationPath, candidate);
} else if (mode === "--verify") {
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`${migrationPath} is missing`);
  }
  const current = fs.readFileSync(migrationPath, "utf8");
  if (current !== candidate) {
    throw new Error(`${migrationPath} drifted from its sealed predecessor builder`);
  }
} else {
  throw new Error("Use --write or --verify");
}

process.stdout.write(`${JSON.stringify({ mode, migrationPath, sha256: digest }, null, 2)}\n`);
