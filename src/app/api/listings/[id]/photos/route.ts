import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    {
      error: "Photo changes are saved from the listing edit form. Upload photos there, then press Save.",
    },
    { status: 410 },
  );
}
