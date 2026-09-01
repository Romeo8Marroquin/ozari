import { beforeEach, describe, expect, it, vi } from 'vitest';

// The renderer and the template are both behind the dynamic import, so both are mocked: what this
// file tests is the HAND-OFF to the browser, not react-pdf's ability to lay out a page.
const { toBlob, pdf } = vi.hoisted(() => {
  const toBlob = vi.fn(() => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })));
  // The SIGNATURE is declared (rather than a named-but-unused parameter) so the assertions below
  // can read what the template was handed.
  return { toBlob, pdf: vi.fn<(element: unknown) => { toBlob: typeof toBlob }>(() => ({ toBlob })) };
});
vi.mock('@react-pdf/renderer', () => ({ pdf }));
vi.mock('./OrderDocument', () => ({ default: () => null }));

import { downloadDocument } from './downloadDocument';
import type { DocumentModel } from './documentModel';
import type { DocumentCopy } from './OrderDocument';

const model = {
  kind: 'receipt',
  reference: 42,
  issuedAt: new Date('2026-08-05T15:00:00Z'),
  letterhead: { businessName: 'Party Rentals GT', businessPhone: '', hasTerms: false, quoteValidityDays: 15, banks: [] },
  isPaid: false,
  client: { name: 'Test', contact: '1234', address: 'Calle' },
  event: { type: 'Boda', deliveryAt: new Date('2026-08-06T15:00:00Z') },
  groups: [],
  totals: { groups: [], total: 0, balance: 0 },
  currencySymbol: 'Q',
} as unknown as DocumentModel;

const input = {
  model,
  copy: {} as DocumentCopy,
  money: (amount: number) => `Q ${amount}`,
  date: (value: Date) => value.toISOString(),
  dateTime: (value: Date) => value.toISOString(),
};

const createObjectURL = vi.fn(() => 'blob:fake');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

describe('downloadDocument', () => {
  it('renders the model and hands the bytes over under the document’s own name', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await downloadDocument(input);

    expect(pdf).toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    // Naming the file is half the reason this is a real PDF rather than a print stylesheet, where
    // the browser names it after the page title.
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('ped-00042.pdf');
    expect(anchor.href).toBe('blob:fake');
    click.mockRestore();
  });

  it('revokes the object URL LATER, never in the same task as the click', async () => {
    // Revoking immediately races the browser's own read of the blob: Chrome has already taken it,
    // but Firefox (desktop and Android) and older Safari start the download asynchronously and find
    // the URL gone — the tap produces nothing, with no error to explain it. The bytes still get
    // freed, which matters for an admin generating documents all afternoon; just not yet.
    vi.useFakeTimers();
    try {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      await downloadDocument(input);
      expect(document.querySelector('a[download]')).toBeNull();
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the model and the caller’s formatters through to the template', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await downloadDocument(input);
    // The template is pure layout: everything it renders arrives as props, which is what keeps the
    // currency symbol and the date language in ONE place instead of a second copy inside the PDF.
    const element = pdf.mock.calls[0]?.[0] as unknown as { props: Record<string, unknown> };
    expect(element.props['model']).toBe(model);
    expect(element.props['money']).toBe(input.money);
    expect(element.props['dateTime']).toBe(input.dateTime);
  });
});
