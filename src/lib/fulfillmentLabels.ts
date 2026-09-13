import type { FulfillmentStatus } from "@prisma/client";

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  PENDING: "Pending",
  READY_FOR_PICKUP: "Ready for Pickup",
  PICKED_UP: "Picked Up",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
};

export function fulfillmentStatusLabel(status: FulfillmentStatus | null | undefined): string {
  return FULFILLMENT_STATUS_LABELS[status ?? "PENDING"];
}
