// Small hover label for icon-only header controls (desktop only). Parent
// needs `relative group` on the hoverable element. Screen readers already
// get the control's aria-label, so the tip is aria-hidden. The show delay
// keeps it from flashing when the cursor passes through the header.
export default function IconHoverTip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-full z-[300] mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-300 motion-reduce:transition-none md:block"
    >
      {label}
    </span>
  );
}
