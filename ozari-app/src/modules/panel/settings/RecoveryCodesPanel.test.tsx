import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecoveryCodesPanel from './RecoveryCodesPanel';

const KEY = 'modules.panel.settings.security.mfa.enable.recovery';
const CODES = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'];

let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:codes'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  // Don't let a real download navigation happen in jsdom.
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('RecoveryCodesPanel', () => {
  it('renders the warning and every recovery code', () => {
    render(<RecoveryCodesPanel codes={CODES} />);
    expect(screen.getByText(`${KEY}.warning`)).toBeInTheDocument();
    for (const code of CODES) expect(screen.getByText(code)).toBeInTheDocument();
  });

  it('downloads the codes as a text file', async () => {
    render(<RecoveryCodesPanel codes={CODES} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.download` }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:codes');
  });

  it('offers a copy action for all codes at once', () => {
    render(<RecoveryCodesPanel codes={CODES} />);
    expect(screen.getByRole('button', { name: `${KEY}.copy` })).toBeInTheDocument();
  });
});
