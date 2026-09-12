export function sourceSnapshot() {
  return {
    seller: {
      id: "seller-1",
      userId: "seller-user",
      displayName: "Proof Shop",
      stripeAccountId: "acct_proof",
      stripeAccountVersion: "v2",
      chargesEnabled: true,
      vacationMode: false,
      acceptingNewOrders: true,
      allowLocalPickup: false,
      offersGiftWrapping: false,
      giftWrappingPriceCents: null,
      defaultPkgWeightGrams: 1000,
      defaultPkgLengthCm: 30,
      defaultPkgWidthCm: 20,
      defaultPkgHeightCm: 10,
      userBanned: false,
      userDeleted: false,
    },
    item: {
      quantity: 1,
      selectedVariantOptionIds: [],
      listing: {
        id: "listing-1",
        sellerId: "seller-1",
        title: "Checkout title",
        description: "Checkout description",
        priceCents: 500,
        priceVersion: 1,
        currency: "usd",
        status: "ACTIVE",
        listingType: "IN_STOCK",
        processingTimeMinDays: null,
        processingTimeMaxDays: null,
        shipsWithinDays: 2,
        category: null,
        tags: ["proof"],
        isPrivate: false,
        reservedForUserId: null,
        packagedWeightGrams: 900,
        packagedLengthCm: 20,
        packagedWidthCm: 10,
        packagedHeightCm: 5,
        imageUrl: "https://cdn.example/proof.jpg",
        imageUrls: ["https://cdn.example/proof.jpg"],
        variantGroups: [],
      },
    },
  };
}

export function provider(overrides = {}) {
  return {
    currency: "usd",
    chargedTotalCents: 650,
    itemsSubtotalCents: 500,
    shippingTitle: "Ground",
    shippingAmountCents: 100,
    taxAmountCents: 50,
    buyerEmail: "buyer@example.com",
    buyerName: "Proof Buyer",
    shipToLine1: "1 Main St",
    shipToLine2: null,
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    shipToCountry: "US",
    stripePaymentIntentId: "pi_proof",
    stripeChargeId: "ch_proof",
    stripeApplicationFeeId: "fee_proof",
    stripeTransferId: "tr_proof",
    shippingCarrier: "USPS",
    shippingService: "Ground Advantage",
    quotedToLine1: "1 Main St",
    quotedToLine2: null,
    quotedToCity: "Austin",
    quotedToState: "TX",
    quotedToPostalCode: "78701",
    quotedToCountry: "US",
    quotedToName: "Proof Buyer",
    quotedToPhone: null,
    quotedShippingAmountCents: 100,
    shippoShipmentId: "ship_proof",
    shippoRateObjectId: "rate_proof",
    giftNote: null,
    giftWrapping: false,
    giftWrappingPriceCents: 0,
    estDays: 3,
    paidItems: [{
      sourceKey: "single:listing-1",
      listingId: "listing-1",
      variantKey: "",
      quantity: 1,
      unitAmountCents: 500,
    }],
    ...overrides,
  };
}

export function paidCheckoutFixtureSql() {
  return `
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TYPE public."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');
      CREATE TYPE public."FulfillmentStatus" AS ENUM (
        'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
      );
      CREATE TYPE public."ListingStatus" AS ENUM (
        'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED'
      );
      CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');

      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES public."User"(id),
        "stripeAccountId" varchar(255),
        "stripeAccountVersion" text,
        "chargesEnabled" boolean NOT NULL,
        "vacationMode" boolean NOT NULL,
        "acceptingNewOrders" boolean NOT NULL
      );
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
        status public."ListingStatus" NOT NULL,
        "listingType" public."ListingType" NOT NULL,
        "stockQuantity" integer,
        "isPrivate" boolean NOT NULL,
        "reservedForUserId" text
      );
      CREATE TABLE public."CartItem" (id text PRIMARY KEY);
      CREATE TABLE public."StripeWebhookEvent" (
        id varchar(255) PRIMARY KEY,
        type varchar(100) NOT NULL,
        "sourceObjectId" varchar(255),
        "claimGeneration" bigint NOT NULL,
        "processingStartedAt" timestamp(3) without time zone,
        "processedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."CheckoutStockReservation" (
        id text PRIMARY KEY,
        "stripeSessionId" varchar(255) UNIQUE,
        status varchar(32) NOT NULL,
        "buyerId" text,
        "sellerId" text,
        "sourceSnapshot" jsonb
      );
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "buyerId" text,
        "sellerProfileId" text,
        "createdAt" timestamp(3) without time zone NOT NULL,
        "paidAt" timestamp(3) without time zone,
        "stripeSessionId" varchar(255) UNIQUE,
        currency varchar(3) NOT NULL,
        "chargedTotalCents" integer,
        "itemsSubtotalCents" integer NOT NULL,
        "shippingTitle" varchar(200),
        "shippingAmountCents" integer NOT NULL,
        "taxAmountCents" integer NOT NULL,
        "buyerEmail" varchar(254), "buyerName" varchar(200),
        "shipToLine1" varchar(200), "shipToLine2" varchar(200),
        "shipToCity" varchar(100), "shipToState" varchar(50),
        "shipToPostalCode" varchar(20), "shipToCountry" varchar(2),
        "stripePaymentIntentId" varchar(255), "stripeChargeId" varchar(255),
        "stripeApplicationFeeId" varchar(255), "stripeTransferId" varchar(255),
        "fulfillmentMethod" public."FulfillmentMethod",
        "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
        "estimatedDeliveryDate" timestamp(3) without time zone,
        "processingDeadline" timestamp(3) without time zone,
        "shippingCarrier" varchar(100), "shippingService" varchar(100),
        "quotedShippingAmountCents" integer,
        "reviewNeeded" boolean NOT NULL, "reviewNote" varchar(10000),
        "quotedToLine1" varchar(200), "quotedToLine2" varchar(200),
        "quotedToCity" varchar(100), "quotedToState" varchar(50),
        "quotedToPostalCode" varchar(20), "quotedToCountry" varchar(2),
        "quotedToName" varchar(200), "quotedToPhone" varchar(30),
        "shippoShipmentId" varchar(255), "shippoRateObjectId" varchar(255),
        "giftNote" varchar(500), "giftWrapping" boolean NOT NULL,
        "giftWrappingPriceCents" integer,
        "buyerDataPurgedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."OrderItem" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL REFERENCES public."Order"(id),
        "listingId" text NOT NULL REFERENCES public."Listing"(id),
        "sellerProfileId" text,
        quantity integer NOT NULL,
        "priceCents" integer NOT NULL,
        "listingSnapshot" jsonb,
        "selectedVariants" jsonb,
        "createdAt" timestamp(3) without time zone NOT NULL
      );
      CREATE TABLE public."SystemAuditLog" (
        id text PRIMARY KEY, "actorType" varchar(40) NOT NULL,
        "actorId" varchar(255), action varchar(100) NOT NULL,
        "targetType" varchar(100) NOT NULL, "targetId" varchar(255) NOT NULL,
        reason varchar(1000), metadata jsonb NOT NULL,
        "createdAt" timestamp(3) without time zone NOT NULL
      );

      CREATE FUNCTION public.grainline_checkout_reservation_complete(
        p_event_id text, p_generation bigint, p_reservation_id text, p_session_id text
      ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
      BEGIN
        IF p_reservation_id = 'reservation-rollback' THEN RETURN 'broken'; END IF;
        UPDATE public."CheckoutStockReservation"
           SET status = 'COMPLETED'
         WHERE id = p_reservation_id
           AND "stripeSessionId" = p_session_id
           AND status = 'RESERVED';
        IF NOT FOUND THEN RETURN 'already_completed'; END IF;
        RETURN 'completed';
      END; $f$;

      INSERT INTO public."User" (id) VALUES ('buyer-1'), ('seller-user');
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "stripeAccountVersion",
        "chargesEnabled", "vacationMode", "acceptingNewOrders"
      ) VALUES ('seller-1', 'seller-user', 'acct_proof', 'v2', true, false, true);
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate"
      ) VALUES ('listing-1', 'seller-1', 'ACTIVE', 'IN_STOCK', 0, false);
      INSERT INTO public."CartItem" (id) VALUES ('unrelated-cart-item');
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_paid_order', 'checkout.session.completed', 'cs_test_proof', 1,
        CURRENT_TIMESTAMP
      );
      INSERT INTO public."CheckoutStockReservation" (
        id, "stripeSessionId", status, "buyerId", "sellerId", "sourceSnapshot"
      ) VALUES (
        'reservation-1', 'cs_test_proof', 'RESERVED', 'buyer-1', 'seller-1',
        '${JSON.stringify(sourceSnapshot()).replaceAll("'", "''")}'::jsonb
      );

      REVOKE ALL ON public."Order", public."OrderItem" FROM grainline_app_runtime;
  `;
}
