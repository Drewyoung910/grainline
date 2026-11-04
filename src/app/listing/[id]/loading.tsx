// src/app/listing/[id]/loading.tsx
import { LISTING_GALLERY_FRAME_HEIGHT, LISTING_PHOTO_TARGET_ATTRIBUTE } from "@/lib/photoMotion";

// Keeps the listing page's layout so nothing moves when the page arrives, and
// so a photo traveling from a listing card has its landing spot right away.
export default function ListingLoading() {
  return (
    <main className="min-h-[100svh] max-w-[1600px] mx-auto overflow-x-clip px-4 sm:px-6 lg:px-8 pb-16 pt-6">
      <div className="mb-4 h-5 w-56 max-w-full rounded bg-[#EFEAE0] animate-pulse" />
      <div className="grid min-w-0 gap-8 mb-10 lg:grid-cols-2">
        <div className="min-w-0">
          <div
            {...{ [LISTING_PHOTO_TARGET_ATTRIBUTE]: "" }}
            className={`${LISTING_GALLERY_FRAME_HEIGHT} w-full rounded-lg bg-[#EFEAE0] animate-pulse`}
          />
        </div>
        <div className="space-y-4 rounded-lg border border-stone-200/60 p-6 shadow-sm">
          <div className="h-8 w-2/3 rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-9 w-32 rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-12 w-full rounded-md bg-[#EFEAE0] animate-pulse" />
          <div className="h-12 w-full rounded-md bg-[#EFEAE0] animate-pulse" />
          <div className="h-24 w-full rounded bg-[#EFEAE0] animate-pulse" />
        </div>
      </div>
    </main>
  );
}
