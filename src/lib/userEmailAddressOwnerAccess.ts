import { withDbUserContext } from "@/lib/dbUserContext";
import { userAccountEmailAddressState } from "@/lib/userEmailAddresses";

export function ownerUserAccountEmailAddressState(
  userId: string,
  currentEmail?: string | null,
) {
  return withDbUserContext(
    userId,
    (tx) => userAccountEmailAddressState(tx, { currentEmail }),
  );
}
