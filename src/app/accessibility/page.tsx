import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Grainline's commitment to digital accessibility and WCAG 2.1 AA conformance.",
};

export default function AccessibilityPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 space-y-8">
      <h1 className="text-3xl font-bold font-display">Accessibility Statement</h1>

      <section className="space-y-3 text-sm text-neutral-700 leading-relaxed">
        <p>
          Grainline LLC is committed to ensuring digital accessibility for people with disabilities.
          We are continually improving the user experience for everyone and applying the relevant
          accessibility standards.
        </p>

        <h2 className="text-lg font-semibold font-display pt-4">Conformance Status</h2>
        <p>
          We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA.
          These guidelines explain how to make web content more accessible to people with a wide
          range of disabilities.
        </p>

        <h2 className="text-lg font-semibold font-display pt-4">Measures Taken</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Semantic HTML with proper heading hierarchy and landmark regions</li>
          <li>Skip-to-content keyboard navigation link</li>
          <li>Reduced-motion support for users with vestibular disorders</li>
          <li>ARIA labels on interactive elements (buttons, links, form controls)</li>
          <li>Sufficient color contrast ratios for text content</li>
          <li>Keyboard-accessible navigation and interactive components</li>
          <li>Alt text on product images (AI-assisted with manual override)</li>
        </ul>

        <h2 className="text-lg font-semibold font-display pt-4">Known Limitations</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Map features require WebGL support and may not be accessible via screen readers</li>
          <li>Some drag-and-drop features (photo reorder) require mouse interaction; arrow button alternatives are provided</li>
          <li>Third-party embeds (Stripe checkout, Clerk authentication) follow their own accessibility standards</li>
        </ul>

        <h2 className="text-lg font-semibold font-display pt-4">Feedback</h2>
        <p>
          We welcome your feedback on the accessibility of Grainline. If you encounter accessibility
          barriers on any part of the site, please contact us:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Email: <a href="mailto:support@thegrainline.com" className="underline hover:text-neutral-900">support@thegrainline.com</a></li>
        </ul>
        <p>We aim to respond to accessibility feedback within 5 business days.</p>

        <p className="text-xs text-neutral-400 pt-6">Last updated: April 2026</p>
      </section>
    </main>
  );
}
