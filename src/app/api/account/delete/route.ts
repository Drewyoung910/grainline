import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { anonymizeUserAccount, getAccountDeletionBlockers } from "@/lib/accountDeletion";

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;
    throw error;
  }
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blockers = await getAccountDeletionBlockers(me.id);
  if (blockers.length > 0) {
    return NextResponse.json(
      { error: "Account deletion is blocked by open obligations.", blockers },
      { status: 409 }
    );
  }

  try {
    await (await clerkClient()).users.deleteUser(clerkId);
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "account_delete_clerk" }, extra: { dbUserId: me.id } });
    return NextResponse.json({
      error: "Account deletion is temporarily unavailable. Please try again.",
    }, { status: 503 });
  }

  try {
    await anonymizeUserAccount(me.id);
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "account_delete_anonymize" }, extra: { dbUserId: me.id } });
    return NextResponse.json({
      error: "Your sign-in was deleted, but account data anonymization needs manual support follow-up.",
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
