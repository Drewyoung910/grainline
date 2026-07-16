import { Pulse } from "@/components/RouteSkeletons";

function WarmSurfacePulse({ className, media = false }: { className: string; media?: boolean }) {
  return <div className={`animate-pulse rounded ${media ? "bg-stone-300/60" : "bg-white/70"} ${className}`} />;
}

function BreadcrumbSkeleton() {
  return (
    <div className="mb-5 flex items-center gap-2" aria-hidden="true">
      <Pulse className="h-4 w-10" />
      <Pulse className="h-4 w-2" />
      <Pulse className="h-4 w-14" />
      <Pulse className="h-4 w-2" />
      <Pulse className="h-4 w-24" />
    </div>
  );
}

function LocalPageHeadingSkeleton() {
  return (
    <header className="mb-6" aria-hidden="true">
      <Pulse className="mb-3 h-9 w-[34rem] max-w-full" />
      <div className="space-y-2">
        <Pulse className="h-4 w-[52rem] max-w-full" />
        <Pulse className="h-4 w-[40rem] max-w-[85%]" />
      </div>
    </header>
  );
}

export function BrowseIndexSkeleton() {
  return (
    <main
      className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8"
      aria-busy="true"
      aria-label="Loading browse results"
    >
      <div className="mb-3 flex items-center gap-3 border-b border-neutral-200 pb-3 md:hidden" aria-hidden="true">
        <Pulse className="h-11 w-28" />
        <Pulse className="h-11 w-32" />
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:gap-8">
        <aside className="hidden w-64 shrink-0 space-y-6 md:block" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Pulse className="h-4 w-24" />
              <Pulse className="h-9 w-full" />
              {index === 0 && <Pulse className="h-9 w-full" />}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <header className="mb-6 flex items-center justify-between gap-4" aria-hidden="true">
            <div className="space-y-2">
              <Pulse className="h-8 w-40" />
              <Pulse className="h-4 w-24" />
            </div>
            <Pulse className="h-9 w-32" />
          </header>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <li key={index}>
                <Pulse className="aspect-[4/5] w-full rounded-2xl" />
                <div className="mt-3 space-y-2 px-1">
                  <Pulse className="h-4 w-3/4" />
                  <Pulse className="h-4 w-1/3" />
                  <Pulse className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

export function BrowseCitySkeleton() {
  return (
    <main
      className="mx-auto max-w-[1600px] px-4 pb-16 pt-8 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label="Loading local listings"
    >
      <BreadcrumbSkeleton />
      <LocalPageHeadingSkeleton />

      <div className="mb-6 flex gap-2 overflow-hidden pb-2" aria-hidden="true">
        {Array.from({ length: 7 }).map((_, index) => (
          <Pulse
            key={index}
            className={`h-8 shrink-0 rounded-full ${index === 0 ? "w-14" : "w-28"}`}
          />
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <li key={index}>
            <Pulse className="aspect-[4/5] w-full rounded-2xl" />
            <div className="flex items-start gap-3 pt-2.5">
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-4/5" />
                <Pulse className="h-4 w-1/3" />
                <Pulse className="h-3 w-2/3" />
              </div>
              {index % 3 === 0 && <Pulse className="h-10 w-10 shrink-0 rounded-full" />}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function MakersCitySkeleton() {
  return (
    <main
      className="mx-auto max-w-[1600px] px-4 pb-16 pt-8 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label="Loading local makers"
    >
      <BreadcrumbSkeleton />
      <LocalPageHeadingSkeleton />

      <ul className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="card-listing">
            <WarmSurfacePulse media className="h-36 w-full rounded-none" />
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-3">
                <WarmSurfacePulse className="h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <WarmSurfacePulse className="h-4 w-2/3" />
                  <WarmSurfacePulse className="h-3 w-1/3" />
                </div>
              </div>
              <WarmSurfacePulse className="h-3 w-4/5" />
              <div className="flex items-center justify-between gap-4">
                <WarmSurfacePulse className="h-3 w-24" />
                <WarmSurfacePulse className="h-8 w-20" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
