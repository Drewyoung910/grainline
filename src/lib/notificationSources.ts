export const NOTIFICATION_SOURCE_TYPES = {
  BLOG_COMMENT: "blog_comment",
  CASE: "case",
  CASE_MESSAGE: "case_message",
  CASE_RESOLUTION_MARK: "case_resolution_mark",
  CASE_SYSTEM_ACTION: "case_system_action",
  COMMISSION_INTEREST: "commission_interest",
  COMMISSION_REQUEST: "commission_request",
  FAVORITE: "favorite",
  FOLLOWED_MAKER_NEW_BLOG: "followed_maker_new_blog",
  FOLLOWED_MAKER_NEW_LISTING: "followed_maker_new_listing",
  FOLLOW: "follow",
  MESSAGE: "message",
  REVIEW: "review",
  SELLER_BROADCAST: "seller_broadcast",
} as const;

export type NotificationSourceType =
  (typeof NOTIFICATION_SOURCE_TYPES)[keyof typeof NOTIFICATION_SOURCE_TYPES];

export type NotificationSourceFields =
  | { sourceType: NotificationSourceType; sourceId: string }
  | { sourceType?: never; sourceId?: never };

// The user whose identity or user-authored content is represented in a
// notification sent to somebody else. This is distinct from the recipient and
// from the domain source object. Account deletion uses it for exact cleanup
// instead of searching notification title/body text.
export type NotificationRelatedUserFields = {
  relatedUserId?: string;
};
