import { appConfig } from "@/config/app.js";

export function isValidEnumValue(enumObj: unknown, value: number): boolean {
  return Object.values(enumObj as object).includes(value);
}

export const sanitizeSensitiveData = (data: object): object => {
  if (!data || typeof data !== "object") return data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const copy: Record<string, any> = { ...data };

  for (const key of Object.keys(copy)) {
    if (appConfig.sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      copy[key] = "***REDACTED***";
    } else if (typeof copy[key] === "object") {
      copy[key] = sanitizeSensitiveData(copy[key]);
    }
  }

  return copy;
};
