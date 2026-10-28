// Display state for rows in the admin Users list.
//
// The staff directory authority (grainline_user_staff_directory_page) does not
// return deletedAt, so deleted accounts are recognised from the fixed values the
// database writes when it deletes them:
// - grainline_user_account_deletion_finalize rewrites the email to
//   `deleted+<id>@deleted.thegrainline.local` and bans the row;
// - grainline_user_provider_deleted_defer bans a Clerk-deleted account whose
//   local cleanup is waiting on blockers, with the exact ban reason below (the
//   seller-pause authority matches on the same text).
// Unban and Email always fail or do harm on these rows, so the list hides them.

export const DELETED_ACCOUNT_EMAIL_DOMAIN = "@deleted.thegrainline.local";

export const PROVIDER_DELETED_PENDING_BAN_REASON =
  "Clerk account deleted before Grainline deletion blockers cleared; support review required";

export type UserStaffDirectoryAccountState =
  | "active"
  | "banned"
  | "deleted"
  | "deletion_pending";

export function userStaffDirectoryAccountState(row: {
  id: string;
  email: string;
  banned: boolean;
  banReason: string | null;
}): UserStaffDirectoryAccountState {
  if (!row.banned) return "active";
  if (row.email === `deleted+${row.id.toLowerCase()}${DELETED_ACCOUNT_EMAIL_DOMAIN}`) return "deleted";
  if (row.banReason === PROVIDER_DELETED_PENDING_BAN_REASON) return "deletion_pending";
  return "banned";
}

export function isDeletedStaffDirectoryAccount(state: UserStaffDirectoryAccountState) {
  return state === "deleted" || state === "deletion_pending";
}
