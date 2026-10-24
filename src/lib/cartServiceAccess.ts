import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";

type CartServiceClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

function validId(value: string) {
  return /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

async function deleteListingCartItems(
  client: CartServiceClient,
  functionName:
    | "grainline_cart_item_admin_listing_cleanup"
    | "grainline_cart_item_seller_listing_cleanup",
  listingId: string,
) {
  if (!validId(listingId))
    throw new RangeError("Cart listing cleanup input is invalid");
  const rows =
    functionName === "grainline_cart_item_admin_listing_cleanup"
      ? await client.$queryRaw<Array<{ deleted_count: number }>>`
        SELECT deleted_count
          FROM public.grainline_cart_item_admin_listing_cleanup(${listingId}::text)
      `
      : await client.$queryRaw<Array<{ deleted_count: number }>>`
        SELECT deleted_count
          FROM public.grainline_cart_item_seller_listing_cleanup(${listingId}::text)
      `;
  const count = rows[0]?.deleted_count;
  if (rows.length !== 1 || !Number.isInteger(count) || Number(count) < 0) {
    throw new TypeError(
      "Cart listing cleanup authority returned an invalid result",
    );
  }
  return Number(count);
}

export function deleteCartItemsForAdminListing(
  client: CartServiceClient,
  listingId: string,
) {
  return deleteListingCartItems(
    client,
    "grainline_cart_item_admin_listing_cleanup",
    listingId,
  );
}

export function deleteCartItemsForSellerListing(
  client: CartServiceClient,
  listingId: string,
) {
  return deleteListingCartItems(
    client,
    "grainline_cart_item_seller_listing_cleanup",
    listingId,
  );
}
