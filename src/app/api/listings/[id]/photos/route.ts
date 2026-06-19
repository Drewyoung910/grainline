import { auth } from "@clerk/nextjs/server";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { privateJson } from "@/lib/privateResponse";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  return privateJson(
    {
      error: "Photo changes are saved from the listing edit form. Upload photos there, then press Save.",
    },
    { status: HTTP_STATUS.GONE },
  );
}
