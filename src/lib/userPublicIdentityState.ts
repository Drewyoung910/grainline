function safeCount(value: unknown, label: string) {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(number);
}

export function publicActiveMemberCountFromRows(
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length !== 1) {
    throw new TypeError("Public active-member count is invalid");
  }
  return safeCount(rows[0]?.value, "Public active-member count");
}
