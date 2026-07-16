import { Pulse } from "@/components/RouteSkeletons";

export default function FeedLoading() {
  return (
    <main className="mx-auto max-w-4xl p-6 md:p-8" aria-busy="true" aria-label="Loading feed">
      <div className="mb-6 space-y-3">
        <Pulse className="h-8 w-32" />
        <Pulse className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <article key={index} className="card-section overflow-hidden">
            <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
              <Pulse className="h-10 w-10 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-40 max-w-full" />
                <Pulse className="h-3 w-28" />
              </div>
            </div>
            <Pulse className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Pulse className="h-4 w-3/4" />
              <Pulse className="h-3 w-1/2" />
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
