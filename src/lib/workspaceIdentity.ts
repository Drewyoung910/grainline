// Who the sidebar belongs to, plus its badge counts. A failure here must never
// take the page with it, so each part fails on its own and the sidebar shows
// what it has. Read-only: visiting a buyer page must not create a seller.
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { countActorUnreadMessages } from "@/lib/conversationMessageAuthority";
import { countUnreadOwnerNotifications } from "@/lib/notificationOwnerAccess";
import { sellerOwnerGuildApplicationState } from "@/lib/sellerOwnerPrivateAccess";
import { sellerOwnerAccountSummary, sellerOwnerCore, sellerOwnerDashboardState } from "@/lib/sellerProfileOwnerAccess";
import { logServerError } from "@/lib/serverErrorLogger";
import { userAccountByClerkId } from "@/lib/userIdentityAccess";
import { readWorkshopOrderQueue } from "@/lib/workshopData";
import { guildNavLabel, type WorkspaceCounts } from "@/lib/workspaceNav";

export type WorkspaceIdentity = Readonly<{
  personName: string;
  shopName: string | null;
  avatarUrl: string | null;
  hasSeller: boolean;
  guildLabel: string | null;
  counts: WorkspaceCounts;
}>;

async function soft<T>(source: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logServerError(error, { source: `workspace_sidebar_${source}` });
    return null;
  }
}

export const readWorkspaceIdentity = cache(async (): Promise<WorkspaceIdentity | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const me = await soft("user", () => userAccountByClerkId(prisma, userId));
  if (!me || me.banned || me.deletedAt) return null;

  const [summary, core, messages, notifications] = await Promise.all([
    soft("summary", () => sellerOwnerAccountSummary(me.id)),
    soft("core", () => sellerOwnerCore(me.id)),
    soft("messages", () => countActorUnreadMessages(me.id)),
    soft("notifications", () => countUnreadOwnerNotifications(me.id)),
  ]);

  let guildLabel: string | null = null;
  let ordersToShip: number | null = null;
  let ordersToShipCapped = false;
  if (summary) {
    const [dashboard, guild, queue] = await Promise.all([
      soft("dashboard", () => sellerOwnerDashboardState(me.id)),
      soft("guild", () => sellerOwnerGuildApplicationState(summary.sellerProfileId, me.id)),
      soft("orders", () => readWorkshopOrderQueue(me.id)),
    ]);
    guildLabel = dashboard
      ? guildNavLabel({
          guildLevel: dashboard.guildLevel,
          verificationStatus: guild?.makerVerification?.status ?? null,
        })
      : null;
    ordersToShip = queue?.awaiting.length ?? null;
    ordersToShipCapped = queue?.capped ?? false;
  }

  return {
    personName: me.name ?? "Your account",
    shopName: core?.displayName ?? null,
    avatarUrl: summary?.avatarImageUrl ?? me.imageUrl ?? null,
    hasSeller: Boolean(summary),
    guildLabel,
    counts: {
      ordersToShip,
      ordersToShipCapped,
      messages,
      notifications,
    },
  };
});
