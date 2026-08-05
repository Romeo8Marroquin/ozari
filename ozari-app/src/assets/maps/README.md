# Maps app icons

The brand marks shown by `components/MapsAppIcon.tsx` — in the "¿Con qué app quieres abrirlo?"
chooser, and on the button itself once a preference is saved.

## The file contract

Replace these three files **in place**, keeping the exact names — `MapsAppIcon` imports them by path,
so a rename breaks the build rather than silently showing nothing.

| File | App |
|---|---|
| `google-maps.png` | Google Maps (the four-colour pin) |
| `waze.png` | Waze (the rounded cyan tile) |
| `apple-maps.png` | Apple Maps (the rounded map tile) |

**Format:** PNG with a transparent background. (Not PDF or SVG: SVG brand assets usually carry their
own `<style>`/fonts that our CSP and the inline-SVG pipeline handle badly, and PDF is not an image
format a browser can render in an `<img>`.)

**Size:** **128×128 px**. They render at 16px (the button) and 28px (the chooser row), so 128 covers
a 3× display with room to spare while staying a few KB. Square canvas, artwork centred — the
component uses `object-contain`, so a non-square file letterboxes rather than distorting.

**Keep them small.** These are inlined/fingerprinted by Vite and shipped to a driver on mobile data;
run them through any PNG optimiser before committing. A few KB each is normal for a flat logo.

## Why not fetch them from the web?

The app's CSP sets `img-src 'self' data: blob: …` — a logo hosted on Google's or Waze's CDN is
blocked outright, and would also make an offline driver see three broken images. Bundling them is
both the only thing that works and the faster option.

## Placeholders

If a file here is a 1×1 transparent pixel, it is still the **placeholder** committed so the build
stays green — the icon will simply render blank. Drop the real artwork in and nothing else changes.
