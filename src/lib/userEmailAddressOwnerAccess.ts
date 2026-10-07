import { withDbUserContext } from "@/lib/dbUserContext";
import {
  accountEmailFallbackEmailsForUser,
  userAccountEmailAddressState,
} from "@/lib/userEmailAddresses";

export function ownerUserAccountEmailAddressState(
  userId: string,
  currentEmail?: string | null,
) {
  return withDbUserContext(
    userId,
    (tx) => userAccountEmailAddressState(tx, { currentEmail }),
  );
}

export function ownerAccountEmailFallbackEmails(userId: string) {
  return withDbUserContext(
    userId,
    (tx) => accountEmailFallbackEmailsForUser(tx),
  );
}
