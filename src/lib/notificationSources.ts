export const NOTIFICATION_SOURCE_TYPES = {
  BLOG_COMMENT: "blog_comment",
  FOLLOWED_MAKER_NEW_BLOG: "followed_maker_new_blog",
  FOLLOWED_MAKER_NEW_LISTING: "followed_maker_new_listing",
  SELLER_BROADCAST: "seller_broadcast",
} as const;

export type NotificationSourceType =
  (typeof NOTIFICATION_SOURCE_TYPES)[keyof typeof NOTIFICATION_SOURCE_TYPES];

export type NotificationSourceFields =
  | { sourceType: NotificationSourceType; sourceId: string }
  | { sourceType?: never; sourceId?: never };
