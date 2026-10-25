import { z } from "zod";
import type { ClaimedEmailOutboxJob } from "./emailOutboxAccess.ts";
import {
  renderBackInStockEmail,
  renderCaseMessageEmail,
  renderCaseOpenedEmail,
  renderCaseResolvedEmail,
  renderFirstListingCongratsEmail,
  renderFirstSaleCongratsEmail,
  renderNewListingFromFollowedMakerEmail,
  renderOrderConfirmedBuyerEmail,
  renderOrderConfirmedSellerEmail,
  renderOrderShippedEmail,
  renderReadyForPickupEmail,
  renderRefundIssuedEmail,
  renderSellerBroadcastEmail,
  renderWelcomeBuyerEmail,
  renderWelcomeSellerEmail,
} from "./email.ts";
import { EMAIL_APP_URL } from "./emailBaseUrl.ts";
import { formatCurrencyCents } from "./money.ts";
import { publicListingPath } from "./publicPaths.ts";
import { codePointLength } from "./textLength.ts";
import { isFirstPartyMediaUrl } from "./urlValidation.ts";
import type { RenderedEmailOutboxPayload } from "./emailOutboxWorker.ts";

const MAX_MONEY_MINOR_UNITS = 9_000_000_000_000;

function boundedText(max: number) {
  return z.string()
    .refine((value) => value === value.trim(), "must be trimmed")
    .refine((value) => codePointLength(value) >= 1, "must not be empty")
    .refine((value) => codePointLength(value) <= max, `must be at most ${max} characters`);
}

const identifier = boundedText(191);
const recipientName = boundedText(200).nullable();
const sellerDisplayName = boundedText(100).nullable();
const currency = z.string().regex(/^[a-z]{3}$/);
const cents = z.number().int().min(0).max(MAX_MONEY_MINOR_UNITS);
const dateValue = boundedText(64)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u, "must be a UTC ISO date")
  .refine((value) => Number.isFinite(Date.parse(value)), "must be a valid date")
  .transform((value) => new Date(value))
  .nullable();
const nullableText = (max: number) => boundedText(max).nullable();
const publicImageUrl = z.string()
  .max(2048)
  .refine(isFirstPartyMediaUrl, "must be an admitted first-party media URL")
  .nullable();
const item = z.object({
  title: boundedText(150),
  quantity: z.number().int().min(1).max(999),
  priceCents: cents,
}).strict();
const items = z.array(item).min(1).max(100);

const orderTotals = {
  itemsSubtotalCents: cents,
  shippingAmountCents: cents,
  taxAmountCents: cents,
  giftWrapping: z.boolean(),
  giftWrappingPriceCents: cents,
  currency,
};

const schemas = {
  welcome: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("BUYER"),
      recipientName,
    }).strict(),
    z.object({
      kind: z.literal("SELLER"),
      recipientName,
      sellerDisplayName,
    }).strict(),
  ]),
  first_listing_congrats: z.object({
    sellerDisplayName,
    listingId: identifier,
    listingTitle: boundedText(150),
    priceCents: cents,
    currency,
  }).strict(),
  order_confirmed_buyer: z.object({
    buyerName: recipientName,
    sellerDisplayName,
    orderId: identifier,
    items,
    ...orderTotals,
    estimatedDeliveryDate: dateValue,
    shipToLine1: nullableText(200),
    shipToCity: nullableText(100),
    shipToState: nullableText(50),
    shipToPostalCode: nullableText(20),
    multiSellerCheckout: z.boolean(),
  }).strict(),
  order_confirmed_seller: z.object({
    sellerDisplayName,
    buyerName: recipientName,
    orderId: identifier,
    items,
    ...orderTotals,
    processingDeadline: dateValue,
  }).strict(),
  first_sale_congrats: z.object({
    sellerDisplayName,
    orderId: identifier,
    ...orderTotals,
  }).strict(),
  back_in_stock: z.object({
    buyerName: recipientName,
    listingId: identifier,
    listingTitle: boundedText(150),
  }).strict(),
  followed_maker_new_listing: z.object({
    makerDisplayName: boundedText(100),
    listingId: identifier,
    listingTitle: boundedText(150),
    priceCents: cents,
    currency,
    imageUrl: publicImageUrl,
  }).strict(),
  seller_broadcast: z.object({
    makerDisplayName: boundedText(100),
    message: boundedText(5000),
    imageUrl: publicImageUrl,
  }).strict(),
  refund_issued: z.object({
    buyerName: recipientName,
    orderId: identifier,
    refundAmountCents: cents,
    currency,
  }).strict(),
  case_opened: z.object({
    sellerDisplayName,
    buyerDisplayName: recipientName,
    orderId: identifier,
    caseId: identifier,
  }).strict(),
  case_message: z.object({
    recipientName,
    senderDisplayName: recipientName,
    caseId: identifier,
    orderId: identifier,
    recipientSide: z.enum(["BUYER", "SELLER"]),
  }).strict(),
  case_resolved: z.object({
    buyerName: recipientName,
    orderId: identifier,
    resolution: z.enum(["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"]),
    refundAmountCents: cents.nullable(),
    currency,
  }).strict().superRefine((payload, context) => {
    const refunding = payload.resolution !== "DISMISSED";
    if (refunding && (payload.refundAmountCents ?? 0) < 1) {
      context.addIssue({
        code: "custom",
        path: ["refundAmountCents"],
        message: "refund resolutions require a positive refund amount",
      });
    }
    if (!refunding && payload.refundAmountCents !== null) {
      context.addIssue({
        code: "custom",
        path: ["refundAmountCents"],
        message: "dismissed resolutions must not include a refund amount",
      });
    }
  }),
  order_shipped: z.object({
    buyerName: recipientName,
    orderId: identifier,
    estimatedDeliveryDate: dateValue,
    carrier: nullableText(100),
    trackingNumber: nullableText(100),
  }).strict(),
  ready_for_pickup: z.object({
    buyerName: recipientName,
    sellerDisplayName,
    orderId: identifier,
  }).strict(),
} as const;

const EXPECTED_LANES = {
  welcome: "OPTIONAL",
  first_listing_congrats: "OPTIONAL",
  order_confirmed_buyer: "TRANSACTIONAL",
  order_confirmed_seller: "TRANSACTIONAL",
  first_sale_congrats: "OPTIONAL",
  back_in_stock: "OPTIONAL",
  followed_maker_new_listing: "OPTIONAL",
  seller_broadcast: "OPTIONAL",
  refund_issued: "TRANSACTIONAL",
  case_opened: "TRANSACTIONAL",
  case_message: "TRANSACTIONAL",
  case_resolved: "TRANSACTIONAL",
  order_shipped: "TRANSACTIONAL",
  ready_for_pickup: "TRANSACTIONAL",
} as const;

function requireSupportedEnvelope(claim: ClaimedEmailOutboxJob) {
  if (
    claim.templateVersion !== 1
    || claim.payloadVersion !== 1
    || claim.payload === null
    || claim.legacySubject !== null
    || claim.legacyHtml !== null
    || !(claim.templateName in schemas)
  ) {
    throw new TypeError("Unsupported structured email envelope");
  }
  const templateName = claim.templateName as keyof typeof schemas;
  if (claim.lane !== EXPECTED_LANES[templateName]) {
    throw new TypeError("Structured email lane does not match its template");
  }
  return templateName;
}

export function renderStructuredEmailOutboxClaim(
  claim: ClaimedEmailOutboxJob,
): RenderedEmailOutboxPayload {
  const templateName = requireSupportedEnvelope(claim);
  const to = claim.recipientEmail;

  switch (templateName) {
    case "welcome": {
      const payload = schemas.welcome.parse(claim.payload);
      return payload.kind === "BUYER"
        ? renderWelcomeBuyerEmail({ user: { name: payload.recipientName, email: to } })
        : renderWelcomeSellerEmail({
            seller: { displayName: payload.sellerDisplayName, email: to },
          });
    }
    case "first_listing_congrats": {
      const payload = schemas.first_listing_congrats.parse(claim.payload);
      return renderFirstListingCongratsEmail({
        seller: { displayName: payload.sellerDisplayName, email: to },
        listing: {
          id: payload.listingId,
          title: payload.listingTitle,
          priceCents: payload.priceCents,
          currency: payload.currency,
        },
      });
    }
    case "order_confirmed_buyer": {
      const payload = schemas.order_confirmed_buyer.parse(claim.payload);
      return renderOrderConfirmedBuyerEmail({
        order: {
          id: payload.orderId,
          itemsSubtotalCents: payload.itemsSubtotalCents,
          shippingAmountCents: payload.shippingAmountCents,
          taxAmountCents: payload.taxAmountCents,
          giftWrapping: payload.giftWrapping,
          giftWrappingPriceCents: payload.giftWrappingPriceCents,
          currency: payload.currency,
          estimatedDeliveryDate: payload.estimatedDeliveryDate,
          shipToLine1: payload.shipToLine1,
          shipToCity: payload.shipToCity,
          shipToState: payload.shipToState,
          shipToPostalCode: payload.shipToPostalCode,
        },
        buyer: { name: payload.buyerName, email: to },
        seller: { displayName: payload.sellerDisplayName },
        items: payload.items,
        multiSellerCheckout: payload.multiSellerCheckout,
      });
    }
    case "order_confirmed_seller": {
      const payload = schemas.order_confirmed_seller.parse(claim.payload);
      return renderOrderConfirmedSellerEmail({
        order: {
          id: payload.orderId,
          itemsSubtotalCents: payload.itemsSubtotalCents,
          shippingAmountCents: payload.shippingAmountCents,
          taxAmountCents: payload.taxAmountCents,
          giftWrapping: payload.giftWrapping,
          giftWrappingPriceCents: payload.giftWrappingPriceCents,
          currency: payload.currency,
          processingDeadline: payload.processingDeadline,
        },
        buyer: { name: payload.buyerName },
        seller: { displayName: payload.sellerDisplayName, email: to },
        items: payload.items,
      });
    }
    case "first_sale_congrats": {
      const payload = schemas.first_sale_congrats.parse(claim.payload);
      return renderFirstSaleCongratsEmail({
        seller: { displayName: payload.sellerDisplayName, email: to },
        order: {
          id: payload.orderId,
          itemsSubtotalCents: payload.itemsSubtotalCents,
          shippingAmountCents: payload.shippingAmountCents,
          taxAmountCents: payload.taxAmountCents,
          giftWrappingPriceCents: payload.giftWrappingPriceCents,
          currency: payload.currency,
        },
      });
    }
    case "back_in_stock": {
      const payload = schemas.back_in_stock.parse(claim.payload);
      return renderBackInStockEmail({
        buyer: { name: payload.buyerName, email: to },
        listingId: payload.listingId,
        listingTitle: payload.listingTitle,
      });
    }
    case "followed_maker_new_listing": {
      const payload = schemas.followed_maker_new_listing.parse(claim.payload);
      return renderNewListingFromFollowedMakerEmail({
        to,
        makerName: payload.makerDisplayName,
        listingTitle: payload.listingTitle,
        listingPrice: formatCurrencyCents(payload.priceCents, payload.currency),
        listingUrl: `${EMAIL_APP_URL}${publicListingPath(payload.listingId, payload.listingTitle)}`,
        listingImageUrl: payload.imageUrl ?? undefined,
      });
    }
    case "seller_broadcast": {
      const payload = schemas.seller_broadcast.parse(claim.payload);
      return renderSellerBroadcastEmail({
        to,
        makerName: payload.makerDisplayName,
        message: payload.message,
        imageUrl: payload.imageUrl,
      });
    }
    case "refund_issued": {
      const payload = schemas.refund_issued.parse(claim.payload);
      return renderRefundIssuedEmail({
        buyer: { name: payload.buyerName, email: to },
        orderId: payload.orderId,
        refundAmountCents: payload.refundAmountCents,
        currency: payload.currency,
      });
    }
    case "case_opened": {
      const payload = schemas.case_opened.parse(claim.payload);
      return renderCaseOpenedEmail({
        orderId: payload.orderId,
        seller: { name: payload.sellerDisplayName, email: to },
        buyer: { name: payload.buyerDisplayName },
        caseDescription: "",
      });
    }
    case "case_message": {
      const payload = schemas.case_message.parse(claim.payload);
      const path = payload.recipientSide === "BUYER"
        ? `/dashboard/orders/${payload.orderId}`
        : `/dashboard/sales/${payload.orderId}`;
      return renderCaseMessageEmail({
        recipientName: payload.recipientName,
        recipientEmail: to,
        senderName: payload.senderDisplayName,
        caseLink: `${EMAIL_APP_URL}${path}`,
        messageSnippet: "",
      });
    }
    case "case_resolved": {
      const payload = schemas.case_resolved.parse(claim.payload);
      return renderCaseResolvedEmail({
        buyer: { name: payload.buyerName, email: to },
        orderId: payload.orderId,
        resolution: payload.resolution,
        refundAmountCents: payload.refundAmountCents,
        currency: payload.currency,
      });
    }
    case "order_shipped": {
      const payload = schemas.order_shipped.parse(claim.payload);
      return renderOrderShippedEmail({
        order: {
          id: payload.orderId,
          estimatedDeliveryDate: payload.estimatedDeliveryDate,
        },
        buyer: { name: payload.buyerName, email: to },
        carrier: payload.carrier,
        trackingNumber: payload.trackingNumber,
      });
    }
    case "ready_for_pickup": {
      const payload = schemas.ready_for_pickup.parse(claim.payload);
      return renderReadyForPickupEmail({
        order: { id: payload.orderId },
        buyer: { name: payload.buyerName, email: to },
        seller: { displayName: payload.sellerDisplayName },
      });
    }
  }
}
