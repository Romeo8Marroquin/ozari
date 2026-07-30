/**
 * Fit a natural image size inside the given bounds preserving aspect ratio — the lightbox frame's
 * geometry: as LARGE as the bounds allow, never cropping (the image is object-contain inside).
 * Degenerate sizes (unloaded image metadata) fall back to the full bounds. Its own module so the
 * component file exports only the component (react-refresh contract).
 */
export function fitImageBox(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: maxWidth, height: maxHeight };
  const ratio = naturalWidth / naturalHeight;
  const width = Math.min(maxWidth, maxHeight * ratio);
  return { width, height: width / ratio };
}
