export function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  const result = value as Record<string, unknown>;
  if (keys && Object.keys(result).some((key) => !keys.includes(key)))
    throw new Error("Unknown field");
  return result;
}
export function text(value: unknown, name = "Text", max = 4000, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)
  ) {
    throw new Error(`${name} must be bounded text`);
  }
  return value;
}
export function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid array size");
  return value as unknown[];
}
export function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error("Invalid number");
  return value as number;
}
export function hash(value: unknown, length = 64): string {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value))
    throw new Error("Invalid digest");
  return value;
}
export function commit(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value))
    throw new Error("Invalid commit");
  return value;
}
