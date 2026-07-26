import { Prisma } from "@prisma/client";
import {
  sendActorCustomOrderRequest,
} from "@/lib/conversationMessageAuthority";

type CreateCustomOrderRequestInput = {
  buyerUserId: string;
  sellerUserId: string;
  description: string;
  dimensions: string | null;
  budgetCents: number | null;
  timeline: string | null;
  listingId: string | null;
};

type CreateCustomOrderRequestResult =
  | {
      ok: true;
      conversationId: string;
      messageId: string;
      listingId: string | null;
      listingTitle: string | null;
    }
  | { ok: false; error: "unavailable" };

export async function createCustomOrderRequestMessage(
  input: CreateCustomOrderRequestInput,
): Promise<CreateCustomOrderRequestResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const request = await sendActorCustomOrderRequest(input);
      return { ok: true, ...request };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2010"
      ) {
        const sqlState = error.meta?.code;
        if (sqlState === "40001" && attempt === 0) continue;
        if (sqlState === "22023" || sqlState === "42501") {
          // The route performs friendly prechecks. Collapse transaction-local
          // races here because the fixed function intentionally does not leak
          // whether block, seller, listing, or account state rejected it.
          return { ok: false, error: "unavailable" };
        }
      }
      throw error;
    }
  }
  throw new Error("custom-request authority retry exhausted");
}
