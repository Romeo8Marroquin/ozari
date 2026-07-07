import { QRCodeSVG } from 'qrcode.react';

interface MfaQrCodeProps {
  /** The `otpauth://totp/...` URI to encode. */
  value: string;
  /** Accessible name for the QR image (screen readers can't read the QR itself). */
  title: string;
}

/**
 * The enrollment QR: the `otpauthUri` encoded as a crisp inline SVG (rendered entirely client-side,
 * so the secret never leaves the browser) inside a white, hairline-bordered card matching the app's
 * `rounded-card` surface language. `level="M"` gives comfortable scan reliability for a URI this
 * length; the charcoal foreground keeps it on-brand rather than pure black.
 */
const MfaQrCode: React.FC<MfaQrCodeProps> = ({ value, title }) => (
  <div className="grid place-items-center rounded-card border border-charcoal/[0.07] bg-white p-4 shadow-sm">
    <QRCodeSVG
      value={value}
      title={title}
      size={168}
      level="M"
      marginSize={0}
      bgColor="#ffffff"
      fgColor="#262626"
      className="h-auto w-40"
    />
  </div>
);

export default MfaQrCode;
