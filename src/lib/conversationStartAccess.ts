import { startActorConversation } from "@/lib/conversationMessageAuthority";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";

type ConversationPairFailure = {
  ok: false;
  error: "invalid_participants" | "unavailable" | "blocked";
};

type ConversationStartResult =
  | { ok: true; conversationId: string; created: boolean }
  | ConversationPairFailure;

export async function startConversationForUser(
  userId: string,
  otherUserId: string,
  requestedListingId: string | null,
): Promise<ConversationStartResult> {
  try {
    const conversation = await startActorConversation(
      userId,
      otherUserId,
      requestedListingId,
    );
    return { ok: true, ...conversation };
  } catch (error) {
    const sqlState = getPrismaRawSqlState(error);
    if (sqlState !== null) {
      if (sqlState === "22023") {
        return { ok: false, error: "invalid_participants" };
      }
      if (sqlState === "42501") {
        return { ok: false, error: "unavailable" };
      }
    }
    throw error;
  }
}
