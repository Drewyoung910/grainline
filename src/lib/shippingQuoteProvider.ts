export type ShippingQuoteProviderAddressFrom = {
  name?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal: string;
  country: string;
};

export type ShippingQuoteProviderAddressTo = {
  city: string;
  state: string;
  postal: string;
  country: string;
};

export type ShippingQuoteProviderParcel = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
};

/**
 * Builds the exact minimized Shippo shipment used for buyer-visible quotes.
 *
 * Checkout does not send the buyer's name or street address to Shippo before
 * the buyer commits to a rate. The later seller-label flow must re-quote with
 * the retained full Order address before it purchases a label, so the rate
 * identity produced here is deliberately marked quote-only elsewhere.
 */
export function buildShippoCheckoutQuoteShipment(input: {
  from: ShippingQuoteProviderAddressFrom;
  to: ShippingQuoteProviderAddressTo;
  parcel: ShippingQuoteProviderParcel;
}) {
  return {
    address_from: {
      name: input.from.name || undefined,
      street1: input.from.line1,
      street2: input.from.line2 || undefined,
      city: input.from.city,
      state: input.from.state,
      zip: input.from.postal,
      country: input.from.country,
    },
    address_to: {
      street1: "Rate quote only",
      city: input.to.city,
      state: input.to.state,
      zip: input.to.postal,
      country: input.to.country,
    },
    parcels: [
      {
        length: input.parcel.lengthCm,
        width: input.parcel.widthCm,
        height: input.parcel.heightCm,
        distance_unit: "cm",
        weight: input.parcel.weightGrams,
        mass_unit: "g",
      },
    ],
    async: false,
  } as const;
}
