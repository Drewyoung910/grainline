"use client";

type Step = {
  label: string;
  date?: string | Date | null;
  detail?: string | null;
  completed: boolean;
  current: boolean;
  isRefund?: boolean;
};

type Props = {
  placedAt: string | Date;
  shippedAt?: string | Date | null;
  deliveredAt?: string | Date | null;
  pickupReadyAt?: string | Date | null;
  pickedUpAt?: string | Date | null;
  fulfillmentMethod: string;
  fulfillmentStatus: string;
  trackingNumber?: string | null;
  trackingCarrier?: string | null;
  refundedAt?: string | Date | null;
  refundAmountCents?: number | null;
};

function carrierTrackingUrl(
  carrier: string | null | undefined,
  number: string
): string | null {
  const c = (carrier ?? "").toUpperCase();
  if (c.includes("UPS"))
    return `https://www.ups.com/track?tracknum=${number}`;
  if (c.includes("USPS"))
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (c.includes("FEDEX") || c.includes("FED EX"))
    return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  if (c.includes("DHL"))
    return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${number}`;
  return null;
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function buildSteps(props: Props): Step[] {
  const {
    placedAt,
    shippedAt,
    deliveredAt,
    pickupReadyAt,
    pickedUpAt,
    fulfillmentMethod,
    fulfillmentStatus,
    refundedAt,
    refundAmountCents,
  } = props;

  const isPickup = fulfillmentMethod === "PICKUP";

  const orderPlaced: Step = {
    label: "Order placed",
    date: placedAt,
    completed: true,
    current: false,
  };

  let steps: Step[];

  if (isPickup) {
    const readyCompleted =
      fulfillmentStatus === "READY_FOR_PICKUP" ||
      fulfillmentStatus === "PICKED_UP" ||
      !!pickupReadyAt;
    const pickedUpCompleted = fulfillmentStatus === "PICKED_UP" || !!pickedUpAt;

    const readyStep: Step = {
      label: "Ready for pickup",
      date: pickupReadyAt,
      completed: readyCompleted,
      current: !readyCompleted && fulfillmentStatus === "PENDING",
    };

    const pickedUpStep: Step = {
      label: "Picked up",
      date: pickedUpAt,
      completed: pickedUpCompleted,
      current: readyCompleted && !pickedUpCompleted,
    };

    steps = [orderPlaced, readyStep, pickedUpStep];
  } else {
    // SHIPPING
    const shippedCompleted =
      fulfillmentStatus === "SHIPPED" ||
      fulfillmentStatus === "DELIVERED" ||
      !!shippedAt;
    const deliveredCompleted = fulfillmentStatus === "DELIVERED" || !!deliveredAt;

    const shippedStep: Step = {
      label: "Shipped",
      date: shippedAt,
      completed: shippedCompleted,
      current: !shippedCompleted && fulfillmentStatus === "PENDING",
    };

    const deliveredStep: Step = {
      label: "Delivered",
      date: deliveredAt,
      completed: deliveredCompleted,
      current: shippedCompleted && !deliveredCompleted,
    };

    steps = [orderPlaced, shippedStep, deliveredStep];
  }

  // Add refund step if a refund was issued
  if (refundAmountCents != null || refundedAt) {
    const refundStep: Step = {
      label: "Refund issued",
      date: null,
      detail: refundAmountCents != null ? fmtMoney(refundAmountCents) : null,
      completed: true,
      current: false,
      isRefund: true,
    };
    steps.push(refundStep);
  }

  return steps;
}

export default function OrderTimeline(props: Props) {
  const steps = buildSteps(props);
  const { trackingNumber, trackingCarrier } = props;

  const trackUrl =
    trackingNumber ? carrierTrackingUrl(trackingCarrier, trackingNumber) : null;

  return (
    <div className="card-section p-4 sm:p-5">
      <div className="font-medium text-neutral-800 mb-4">Order progress</div>

      <div className="relative">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;

          // Dot colors
          let dotClass: string;
          if (step.isRefund) {
            dotClass = "bg-red-500 border-red-500";
          } else if (step.completed) {
            dotClass = "bg-green-500 border-green-500";
          } else if (step.current) {
            dotClass = "bg-amber-400 border-amber-400";
          } else {
            dotClass = "bg-neutral-200 border-neutral-200";
          }

          // Line color (between this dot and the next)
          let lineClass = "bg-neutral-200";
          if (step.completed && !isLast) {
            const next = steps[i + 1];
            if (next.completed || next.current) {
              lineClass = "bg-green-500";
            }
          }

          return (
            <div key={step.label} className="flex items-start gap-3">
              {/* Dot + connecting line column */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${dotClass}`}
                />
                {!isLast && (
                  <div
                    className={`w-0.5 h-8 ${lineClass}`}
                  />
                )}
              </div>

              {/* Label + date */}
              <div className={`-mt-0.5 pb-2 ${isLast ? "" : "pb-4"}`}>
                <div
                  className={`text-sm font-medium ${
                    step.isRefund
                      ? "text-red-700"
                      : step.completed
                      ? "text-neutral-900"
                      : step.current
                      ? "text-amber-700"
                      : "text-neutral-500"
                  }`}
                >
                  {step.label}
                </div>
                {step.date && (
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {fmtDate(step.date)}
                  </div>
                )}
                {step.detail && (
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {step.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Track package button */}
      {trackingNumber && trackUrl && (
        <div className="mt-3 pt-3 border-t">
          <a
            href={trackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 3v5h-7V8z" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
            Track package
          </a>
        </div>
      )}

      {/* Tracking number without carrier URL */}
      {trackingNumber && !trackUrl && (
        <div className="mt-3 pt-3 border-t text-xs text-neutral-500">
          Tracking: {trackingCarrier && <span>{trackingCarrier} &middot; </span>}
          <span className="font-mono">{trackingNumber}</span>
        </div>
      )}
    </div>
  );
}
