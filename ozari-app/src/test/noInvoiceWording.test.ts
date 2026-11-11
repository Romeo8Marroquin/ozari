import { describe, expect, it } from 'vitest';

import es from '@assets/locales/es.json';

/**
 * Owner rule (2026-11-11): the word "factura" — or anything that reads as invoicing — may not appear
 * ANYWHERE. The business issues no invoices, so the word promises a fiscal document that does not
 * exist. It reached a client once as `Días facturados` on the cotización (now `Días contratados`);
 * this keeps it from coming back through any string (EPIC-2-DOCUMENTS decision #10).
 */
const INVOICE_WORDING = /factur/i;

function collectStrings(node: unknown, path: string, found: string[]): string[] {
  if (typeof node === 'string') {
    if (INVOICE_WORDING.test(node)) found.push(`${path}: "${node}"`);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectStrings(value, path === '' ? key : `${path}.${key}`, found);
    }
  }
  return found;
}

describe('es.json — no invoicing vocabulary', () => {
  it('never says "factura" / "facturado" / "facturación"', () => {
    expect(collectStrings(es, '', [])).toEqual([]);
  });
});
