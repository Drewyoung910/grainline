export default function Home() {
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Grainline</h1>
      <ul className="list-disc pl-6">
        <li><a href="/sign-in">Sign in</a></li>
        <li><a href="/sign-up">Sign up</a></li>
        <li><a href="/dashboard">Dashboard</a></li>
      </ul>
    </main>
  );
}
