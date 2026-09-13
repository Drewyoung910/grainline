import { Pulse } from "@/components/RouteSkeletons";

export default function AcceptTermsLoading() {
  return (
    <main
      className="min-h-[100svh] bg-[#F7F5F0] px-6 py-12"
      aria-busy="true"
      aria-label="Loading terms acceptance"
    >
      <section className="card-section mx-auto max-w-lg space-y-5 p-6" aria-hidden="true">
        <Pulse className="h-4 w-32" />
        <Pulse className="h-8 w-72 max-w-full" />
        <div className="space-y-2">
          <Pulse className="h-4 w-full" />
          <Pulse className="h-4 w-4/5" />
        </div>
        <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-4">
          <Pulse className="h-4 w-full" />
          <Pulse className="h-4 w-5/6" />
          <Pulse className="h-4 w-2/3" />
        </div>
        <Pulse className="h-11 w-full" />
      </section>
    </main>
  );
}
