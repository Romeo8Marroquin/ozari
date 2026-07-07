import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MfaQrCode from './MfaQrCode';

describe('MfaQrCode', () => {
  it('renders an accessible inline SVG QR for the otpauth URI', () => {
    const { container } = render(
      <MfaQrCode value="otpauth://totp/Ozari:ana@example.com?secret=ABCDEF" title="scan me" />,
    );
    // Testing Library's getByTitle matches the SVG <title> — the QR's accessible name.
    expect(screen.getByTitle('scan me')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
