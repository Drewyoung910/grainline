import { prisma } from "@/lib/db";
import { sendCustomOrderReady } from "@/lib/email";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { publicListingPath } from "@/lib/publicPaths";

type CustomOrderReadyListing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string | null;
};

export async function sendCustomOrderReadyLink({
  conversationId,
  sellerUserId,
  buyerUserId,
  sellerName,
  listing,
}: {
  conversationId: string;
  sellerUserId: string;
  buyerUserId: string;
  sellerName: string | null;
  listing: CustomOrderReadyListing;
}) {
  const listingLink = publicListingPath(listing.id, listing.title);
  const existingLinkMessage = await prisma.message.findFirst({
    where: {
      conversationId,
      kind: "custom_order_link",
      body: { contains: listing.id },
    },
    select: { id: true },
  });

  if (existingLinkMessage) {
    return { messageCreated: false };
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId: sellerUserId,
        recipientId: buyerUserId,
        kind: "custom_order_link",
        body: JSON.stringify({
          listingId: listing.id,
          title: listing.title,
          priceCents: listing.priceCents,
          currency: listing.currency,
        }),
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);

  await createNotification({
    userId: buyerUserId,
    type: "CUSTOM_ORDER_LINK",
    title: "Your custom piece is ready to review!",
    body: `${listing.title} - review and purchase`,
    link: listingLink,
    dedupScope: listing.id,
  });

  try {
    if (await shouldSendEmail(buyerUserId, "EMAIL_CUSTOM_ORDER")) {
      const buyerUser = await prisma.user.findUnique({
        where: { id: buyerUserId },
        select: { name: true, email: true },
      });
      if (buyerUser?.email) {
        await sendCustomOrderReady({
          buyer: { name: buyerUser.name, email: buyerUser.email },
          sellerName: sellerName ?? "Grainline maker",
          listingTitle: listing.title,
          priceCents: listing.priceCents,
          currency: listing.currency,
          listingId: listing.id,
        });
      }
    }
  } catch {
    // Non-fatal: the in-app message and notification are the durable buyer path.
  }

  return { messageCreated: true };
}
