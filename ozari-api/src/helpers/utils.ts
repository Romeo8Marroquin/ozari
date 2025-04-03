export function isValidEnumValue(enumObj: unknown, value: number): boolean {
  return Object.values(enumObj as object).includes(value);
}
