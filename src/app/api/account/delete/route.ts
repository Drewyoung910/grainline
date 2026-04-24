import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { ensureUser } from "@/lib/ensureUser";
import { anonymizeUserAccount, getAccountDeletionBlockers } from "@/lib/accountDeletion";

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await ensureUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blockers = await getAccountDeletionBlockers(me.id);
  if (blockers.length > 0) {
    return NextResponse.json(
      { error: "Account deletion is blocked by open obligations.", blockers },
      { status: 409 }
    );
  }

  await anonymizeUserAccount(me.id);

  try {
    await (await clerkClient()).users.deleteUser(clerkId);
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "account_delete_clerk" }, extra: { dbUserId: me.id } });
    return NextResponse.json({
      ok: true,
      warning: "Your Grainline account data was anonymized, but Clerk account deletion needs manual support follow-up.",
    });
  }

  return NextResponse.json({ ok: true });
}
