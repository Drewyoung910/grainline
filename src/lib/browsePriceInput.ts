// Browse price fields accept familiar currency punctuation on every layout,
// but the URL contract remains a plain decimal dollar amount.
export function cleanBrowsePriceInput(raw: string): string | null {
  const value = raw.replace(/[\s$,]/g, "");
  if (value === "") return "";
  return /^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(value) ? value : null;
}
