import { Hammer, MessageCircle, Shield } from "@/components/icons";

// Shown where the marketplace statistics go until those numbers are large
// enough to mean something. Keep the wording to what Grainline enforces or
// provides: handmade is a rule with removals behind it, not a guarantee about
// every piece.
const PROMISES = [
  {
    Icon: Hammer,
    title: "Handmade is the rule",
    body: "Mass-produced and dropshipped goods aren't allowed here.",
  },
  {
    Icon: Shield,
    title: "Secure checkout",
    body: "Payments run through Stripe, with buyer cases if something goes wrong.",
  },
  {
    Icon: MessageCircle,
    title: "Talk to the maker",
    body: "Ask about wood, size or finish before you buy.",
  },
];

export default function HomePromiseBand() {
  return (
    /* Zero-height anchor + 50% translation keeps the band half inside and
       half outside the hero at every height, like the statistics band. */
    <section
      data-home-promises
      aria-label="Why buy on Grainline"
      className="relative z-30 h-0 px-4 sm:px-6 lg:px-8"
    >
      <ul className="mx-auto grid w-full max-w-5xl -translate-y-1/2 grid-cols-1 gap-6 rounded-[22px] border border-white/30 bg-[#F7F5F0]/90 px-5 py-4 shadow-[0_20px_50px_-30px_rgba(28,20,16,0.55)] backdrop-blur-md md:grid-cols-3 md:px-6 md:py-5">
        {PROMISES.map(({ Icon, title, body }, index) => (
          // Phones show the first promise only, so the band never covers the
          // buttons in the hero.
          <li key={title} className={`min-w-0 gap-3 ${index === 0 ? "flex" : "hidden md:flex"}`}>
            <Icon size={22} className="mt-0.5 shrink-0 text-[#2C1F1A]" />
            <div className="min-w-0">
              <p className="text-[15px] font-medium leading-snug text-neutral-900">{title}</p>
              <p className="mt-0.5 text-sm leading-snug text-neutral-600">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
