import type { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";

type UserFollowerClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type UserFollowerNotificationRow = {
  followId: string;
  followerId: string;
};

export type UserBroadcastFollowerRow = UserFollowerNotificationRow & {
  notificationPreferences: Record<string, unknown>;
};

type UserListingFavoriteCountRow = {
  listingId: string;
  favoriteCount: bigint;
};

const MAX_FOLLOWER_PAGE_SIZE = 1000;
const MAX_BROADCAST_AUDIENCE = 10000;
const MAX_LISTING_FAVORITE_BATCH = 200;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

function validPreferences(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pageLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_FOLLOWER_PAGE_SIZE) {
    throw new Error("User follower page limit is invalid");
  }
  return value;
}

export async function userFollowerNotificationPage(
  client: UserFollowerClient,
  input: {
    sellerProfileId: string;
    afterFollowId?: string | null;
    limit?: number;
  },
) {
  const limit = pageLimit(input.limit ?? MAX_FOLLOWER_PAGE_SIZE);
  const rows = await client.$queryRaw<UserFollowerNotificationRow[]>`
    SELECT * FROM public.grainline_user_follower_notification_page(
      ${input.sellerProfileId}::text,
      ${input.afterFollowId ?? null}::text,
      ${limit}::integer
    )
  `;
  if (rows.some((row) => !validId(row.followId) || !validId(row.followerId))) {
    throw new Error("User follower notification authority returned an invalid result");
  }
  return rows;
}

export function userOwnerBroadcastFollowers(
  userId: string,
  input: {
    sellerProfileId: string;
    sellersOnly: boolean;
  },
) {
  return withDbUserContext(userId, async (client) => {
    const followers: UserBroadcastFollowerRow[] = [];
    let afterFollowId: string | null = null;

    while (followers.length < MAX_BROADCAST_AUDIENCE) {
      const limit = Math.min(
        MAX_FOLLOWER_PAGE_SIZE,
        MAX_BROADCAST_AUDIENCE - followers.length,
      );
      const rows: UserBroadcastFollowerRow[] = await client.$queryRaw<UserBroadcastFollowerRow[]>`
        SELECT * FROM public.grainline_user_owner_broadcast_follower_page(
          ${input.sellerProfileId}::text,
          ${afterFollowId}::text,
          ${limit}::integer,
          ${input.sellersOnly}::boolean
        )
      `;
      if (rows.some((row) => (
        !validId(row.followId)
        || !validId(row.followerId)
        || !validPreferences(row.notificationPreferences)
      ))) {
        throw new Error("User owner broadcast follower authority returned an invalid result");
      }
      followers.push(...rows);
      if (rows.length < limit) break;
      afterFollowId = rows.at(-1)?.followId ?? null;
      if (!afterFollowId) {
        throw new Error("User owner broadcast follower authority lost its cursor");
      }
    }
    return followers;
  });
}

export async function userPublicListingFavoriteCounts(
  client: UserFollowerClient,
  listingIds: string[],
) {
  const uniqueListingIds = [...new Set(listingIds)];
  if (
    uniqueListingIds.length !== listingIds.length
    || uniqueListingIds.length < 1
    || uniqueListingIds.length > MAX_LISTING_FAVORITE_BATCH
    || uniqueListingIds.some((id) => !validId(id))
  ) {
    throw new Error("User public listing favorite count input is invalid");
  }
  const rows = await client.$queryRaw<UserListingFavoriteCountRow[]>`
    SELECT * FROM public.grainline_user_public_listing_favorite_counts(
      ${uniqueListingIds}::text[]
    )
  `;
  if (rows.some((row) => (
    !validId(row.listingId)
    || typeof row.favoriteCount !== "bigint"
    || row.favoriteCount < 0n
  ))) {
    throw new Error("User public listing favorite count authority returned an invalid result");
  }
  return new Map(rows.map((row) => [row.listingId, row.favoriteCount]));
}
