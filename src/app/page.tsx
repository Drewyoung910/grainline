import Image from "next/image";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-5xl font-bold text-gray-900">Grainline</h1>
      <p className="mt-4 text-lg text-gray-700 text-center max-w-xl">
        The marketplace for woodworkers. Discover local makers, view profiles and reviews,
        and shop handcrafted pieces—all in one place.
      </p>
      <div className="mt-8 flex gap-4">
        <a
          href="#"
          className="rounded-xl px-6 py-3 bg-black text-white hover:opacity-90"
        >
          Become a Seller
        </a>
        <a
          href="#"
          className="rounded-xl px-6 py-3 border border-gray-300 hover:bg-gray-50"
        >
          Browse Listings
        </a>
      </div>
    </main>
  );
}
