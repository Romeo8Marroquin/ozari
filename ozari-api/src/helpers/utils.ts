import { applicationConfig } from '@src/applicationConfig';

export function isValidEnumValue(enumObj: unknown, value: number): boolean {
  return Object.values(enumObj as object).includes(value);
}

export const sanitizeSensitiveData = (data: object): object => {
  if (!data || typeof data !== 'object') return data;

  const copy: Record<string, any> = { ...data };

  for (const key of Object.keys(copy)) {
    if (applicationConfig.sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      copy[key] = '***REDACTED***';
    } else if (typeof copy[key] === 'object') {
      copy[key] = sanitizeSensitiveData(copy[key]);
    }
  }

  return copy;
};
