import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

export type SellerTransactionState = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  chargesEnabled: boolean;
  stripeAccountSupported: boolean;
  ownerAccountActive: boolean;
  vacationMode: boolean;
  acceptingNewOrders: boolean;
  freeShippingOverCents: number | null;
  shippingFlatRateCents: number | null;
  allowLocalPickup: boolean;
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
}>;

const sellerTransactionContextOptions = {
  isolationLevel: "RepeatableRead" as const,
};

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}
function validNullableCents(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0);
}

function validSellerTransactionState(row: SellerTransactionState | undefined): row is SellerTransactionState {
  return Boolean(
    row
    && validId(row.id)
    && validId(row.userId)
    && isTextWithinCodePointRange(row.displayName, 1, 100)
    && typeof row.chargesEnabled === "boolean"
    && typeof row.stripeAccountSupported === "boolean"
    && typeof row.ownerAccountActive === "boolean"
    && typeof row.vacationMode === "boolean"
    && typeof row.acceptingNewOrders === "boolean"
    && validNullableCents(row.freeShippingOverCents)
    && validNullableCents(row.shippingFlatRateCents)
    && typeof row.allowLocalPickup === "boolean"
    && typeof row.offersGiftWrapping === "boolean"
    && validNullableCents(row.giftWrappingPriceCents)
  );
}

export async function readSellerActorListingTransactionState(
  client: Pick<DbUserContextTransactionClient, "$queryRaw">,
  listingId: string,
) {
  if (!validId(listingId)) {
    throw new RangeError("Seller listing transaction-state input is invalid");
  }
  const rows = await client.$queryRaw<SellerTransactionState[]>`
    SELECT *
      FROM public.grainline_seller_actor_listing_transaction_state(
        ${listingId}::text
      )
  `;
  const row = rows[0];
  if (rows.length > 1 || (row && !validSellerTransactionState(row))) {
    throw new TypeError("Seller listing transaction authority returned an invalid result");
  }
  return row ?? null;
}

export async function readSellerActorCartTransactionStates(
  client: Pick<DbUserContextTransactionClient, "$queryRaw">,
  cartId: string,
) {
  if (!validId(cartId)) {
    throw new RangeError("Seller cart transaction-state input is invalid");
  }
  const rows = await client.$queryRaw<SellerTransactionState[]>`
    SELECT *
      FROM public.grainline_seller_actor_cart_transaction_states(
        ${cartId}::text
      )
  `;
  if (
    rows.length > 50
    || rows.some((row) => !validSellerTransactionState(row))
    || new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new TypeError("Seller cart transaction authority returned an invalid result");
  }
  return rows;
}

function attachSellerState<T extends { sellerId: string }>(
  listing: T,
  seller: SellerTransactionState | null,
) {
  if (!seller || seller.id !== listing.sellerId) {
    throw new Error("Seller listing transaction authority omitted the exact seller");
  }
  return { ...listing, seller };
}

export function sellerListingTransactionSource(actorUserId: string, listingId: string) {
  return withDbUserContext(actorUserId, async (client) => {
    const listing = await client.listing.findUnique({
      where: { id: listingId },
      include: { variantGroups: { include: { options: true } } },
    });
    if (!listing) return null;
    const seller = await readSellerActorListingTransactionState(client, listingId);
    return attachSellerState(listing, seller);
  }, sellerTransactionContextOptions);
}

export function sellerSingleCheckoutSource(actorUserId: string, listingId: string) {
  return withDbUserContext(actorUserId, async (client) => {
    const listing = await client.listing.findUnique({
      where: { id: listingId },
      include: {
        photos: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
        variantGroups: { include: { options: true } },
      },
    });
    if (!listing) return null;
    const seller = await readSellerActorListingTransactionState(client, listingId);
    return attachSellerState(listing, seller);
  }, sellerTransactionContextOptions);
}

export function sellerSingleCheckoutResumeSource(actorUserId: string, listingId: string) {
  return withDbUserContext(actorUserId, async (client) => {
    const listing = await client.listing.findUnique({
      where: { id: listingId },
      select: {
        sellerId: true,
        status: true,
        isPrivate: true,
        reservedForUserId: true,
      },
    });
    if (!listing) return null;
    const seller = await readSellerActorListingTransactionState(client, listingId);
    return attachSellerState(listing, seller);
  }, sellerTransactionContextOptions);
}

export function withSellerActorCartTransaction<T>(
  actorUserId: string,
  operation: (
    client: DbUserContextTransactionClient,
    sellerStates: (cartId: string) => Promise<SellerTransactionState[]>,
  ) => Promise<T>,
) {
  return withDbUserContext(
    actorUserId,
    (client) => operation(
      client,
      (cartId) => readSellerActorCartTransactionStates(client, cartId),
    ),
    sellerTransactionContextOptions,
  );
}

export function attachCartSellerStates<
  T extends { listing: { sellerId: string } },
>(items: T[], states: SellerTransactionState[]) {
  const bySellerId = new Map(states.map((state) => [state.id, state]));
  return items.map((item) => {
    const seller = bySellerId.get(item.listing.sellerId);
    if (!seller) {
      throw new Error("Seller cart transaction authority omitted a cart seller");
    }
    return {
      ...item,
      listing: { ...item.listing, seller },
    };
  });
}
