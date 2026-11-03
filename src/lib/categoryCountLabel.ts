export function categoryCountLabel(count: number): string {
  if (count <= 0) return "Coming soon";
  return count === 1 ? "1 piece" : `${count.toLocaleString("en-US")} pieces`;
}
