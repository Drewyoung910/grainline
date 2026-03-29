// src/app/api/uploadthing/core.ts
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { auth } from "@clerk/nextjs/server";

const f = createUploadthing();

function fileToUrl(file: { ufsUrl?: string; url?: string; key?: string }) {
  return file?.ufsUrl ?? (file?.key ? `https://utfs.io/f/${file.key}` : null);
}

export const fileRouter = {
  listingImage: f({ image: { maxFileSize: "8MB", maxFileCount: 8 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  messageImage: f({ image: { maxFileSize: "8MB", maxFileCount: 6 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  messageFile: f({ pdf: { maxFileSize: "8MB", maxFileCount: 4 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  messageAny: f({
    image: { maxFileSize: "8MB", maxFileCount: 6 },
    pdf: { maxFileSize: "8MB", maxFileCount: 4 },
  })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  reviewPhoto: f({ image: { maxFileSize: "8MB", maxFileCount: 6 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  listingVideo: f({ video: { maxFileSize: "128MB", maxFileCount: 1 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  bannerImage: f({ image: { maxFileSize: "4MB", maxFileCount: 1 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),

  galleryImage: f({ image: { maxFileSize: "4MB", maxFileCount: 10 } })
    .middleware(async () => {
      const { userId } = await auth();
      if (!userId) throw new Error("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      const url = fileToUrl(file);
      return { url, key: file.key, name: file.name, type: file.type };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof fileRouter;
