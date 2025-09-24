import { auth } from "@clerk/nextjs/server";
import { createUploadthing, type FileRouter, createRouteHandler } from "uploadthing/next";

const f = createUploadthing();

export const fileRouter = {
  listingImage: f({ image: { maxFileSize: "8MB", maxFileCount: 8 } }) // ← allow up to 8 files
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      console.log("Upload complete:", file.url);
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof fileRouter;

export const { GET, POST } = createRouteHandler({
  router: fileRouter,
});
