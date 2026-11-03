export default function Template({ children }: { children: React.ReactNode }) {
  // Page-level entrances replay on Back, logo clicks, Clerk steps, and admin
  // navigation because templates remount by design. Keep the root boundary
  // stable and reserve motion for local components whose lifecycle is clear.
  return children;
}
