import { Pulse } from "@/components/RouteSkeletons";

function WarmSurfacePulse({ className, media = false }: { className: string; media?: boolean }) {
  return <div className={`animate-pulse rounded ${media ? "bg-stone-300/60" : "bg-white/70"} ${className}`} />;
}

function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index}>
          <Pulse className="aspect-[4/5] w-full rounded-2xl" />
          <div className="space-y-2 pt-2.5">
            <Pulse className="h-4 w-4/5" />
            <Pulse className="h-4 w-1/3" />
            <Pulse className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TagLandingSkeleton() {
  return (
    <div className="min-h-[100svh] bg-[#F7F5F0]">
      <main
        className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8"
        aria-busy="true"
        aria-label="Loading tagged pieces"
      >
        <header className="mb-8 flex flex-col gap-4 border-b border-stone-200/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Pulse className="h-4 w-32" />
            <Pulse className="h-10 w-72 max-w-full" />
            <Pulse className="h-4 w-[30rem] max-w-full" />
          </div>
          <Pulse className="h-10 w-32 shrink-0" />
        </header>
        <ListingGridSkeleton />
      </main>
    </div>
  );
}

export function BlogAuthorSkeleton() {
  return (
    <main
      className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6"
      aria-busy="true"
      aria-label="Loading author stories"
    >
      <Pulse className="mb-6 h-4 w-36" />

      <header className="mb-10 border-b border-neutral-100 pb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Pulse className="h-16 w-16 shrink-0 rounded-full" />
            <div className="space-y-2">
              <Pulse className="h-10 w-72 max-w-full" />
              <Pulse className="h-4 w-96 max-w-full" />
              <Pulse className="h-4 w-16" />
            </div>
          </div>
          <Pulse className="h-10 w-24 shrink-0" />
        </div>
      </header>

      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="card-listing">
            <WarmSurfacePulse media className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-3 p-4">
              <div className="flex gap-2">
                <WarmSurfacePulse className="h-5 w-20 rounded-full" />
                <WarmSurfacePulse className="h-4 w-12" />
              </div>
              <WarmSurfacePulse className="h-5 w-4/5" />
              <WarmSurfacePulse className="h-4 w-full" />
              <WarmSurfacePulse className="h-3 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function CustomerPhotosSkeleton() {
  const heights = ["h-52", "h-72", "h-60", "h-80", "h-64", "h-48", "h-72", "h-56"];
  return (
    <main
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8"
      aria-busy="true"
      aria-label="Loading customer photos"
    >
      <header className="mb-8 space-y-3">
        <Pulse className="h-4 w-32" />
        <Pulse className="h-10 w-64" />
        <Pulse className="h-4 w-[32rem] max-w-full" />
      </header>
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4" aria-hidden="true">
        {heights.map((height, index) => (
          <Pulse key={index} className={`mb-3 w-full break-inside-avoid rounded-lg ${height}`} />
        ))}
      </div>
    </main>
  );
}
