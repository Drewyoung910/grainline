export function codePointLength(value: string): number {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

export function isTextWithinCodePointRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  if (typeof value !== "string") return false;
  const length = codePointLength(value);
  return length >= minimum && length <= maximum;
}
