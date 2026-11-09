// Generates the PWA/app icons in /public (plus app/icon.png and app/apple-icon.png) from inline SVG sources.
// Run with: node scripts/generate-icons.mjs
//
// The mark is "Capital +": a white C with a black outline, centred, and a small yellow "+" raised at
// its top-right like an exponent.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const INK = '#111111';
const OUTLINE = 11;

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22a35a" />
      <stop offset="1" stop-color="#0a5730" />
    </linearGradient>
    <linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="-40" y1="-80" x2="40" y2="80">
      <stop offset="0" stop-color="#fde68a" />
      <stop offset="0.55" stop-color="#facc15" />
      <stop offset="1" stop-color="#eaa300" />
    </linearGradient>
  </defs>
`;

/** Ring of radii R/r opening to the right by ±`open` degrees, centred on 0,0. */
function cPath(R, r, open) {
  const p = (rad, a) => [rad * Math.cos((a * Math.PI) / 180), -rad * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(R, open);
  const [x1, y1] = p(R, -open);
  const [x2, y2] = p(r, -open);
  const [x3, y3] = p(r, open);
  return `M${x0} ${y0} A${R} ${R} 0 1 0 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 1 1 ${x3} ${y3} Z`;
}

const C_PATH = cPath(172, 96, 36);
const PLUS_PATH = 'M-32 0 H32 M0 -32 V32';

/** The C and the "+", in the 512 grid, centred on the C; `scale` shrinks it for safe zones. */
function mark(scale, { fill = '#ffffff', plus = 'url(#gold)', ink = INK } = {}) {
  return `
    <g transform="translate(256 256) scale(${scale})">
      <path d="${C_PATH}" fill="${ink}" stroke="${ink}" stroke-width="${OUTLINE * 2}" stroke-linejoin="round" />
      <path d="${C_PATH}" fill="${fill}" />
      <g transform="translate(176 -158)">
        <path d="${PLUS_PATH}" fill="none" stroke="${ink}" stroke-width="${23 + OUTLINE * 2}" stroke-linecap="round" />
        <path d="${PLUS_PATH}" fill="none" stroke="${plus}" stroke-width="23" stroke-linecap="round" />
      </g>
    </g>
  `;
}

/** Full-bleed background (required for maskable icons and iOS, which apply their own mask/corners). */
function fullBleedSvg(markScale) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      ${DEFS}
      <rect width="512" height="512" fill="url(#bg)" />
      ${mark(markScale)}
    </svg>
  `;
}

/** Rounded-square variant for the "any" purpose icon and favicon. */
function roundedSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      ${DEFS}
      <rect width="512" height="512" rx="112" fill="url(#bg)" />
      ${mark(1)}
    </svg>
  `;
}

/**
 * Notification badge (Android status bar): the system only uses the alpha channel, so it is the
 * C and the "+" in plain white on transparency, without the outline.
 */
function badgeSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <g transform="translate(-24 20)">${mark(1, { plus: '#fff', ink: 'none' })}</g>
    </svg>
  `;
}

async function render(svg, size, outFile) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(rootDir, outFile));
  console.log('wrote', outFile);
}

async function main() {
  await mkdir(publicDir, { recursive: true });

  await render(roundedSvg(), 512, 'public/icon-512.png');
  await render(roundedSvg(), 192, 'public/icon-192.png');
  await render(roundedSvg(), 512, 'app/icon.png');
  // Maskable icons need the mark (the "+" included) inside the ~80% "safe zone", full-bleed background.
  await render(fullBleedSvg(0.72), 512, 'public/icon-maskable-512.png');
  await render(fullBleedSvg(0.72), 192, 'public/icon-maskable-192.png');
  // iOS home-screen icon: no transparency, iOS applies its own rounding.
  await render(fullBleedSvg(0.9), 180, 'public/apple-touch-icon.png');
  await render(fullBleedSvg(0.9), 180, 'app/apple-icon.png');
  await render(badgeSvg(), 96, 'public/badge-96.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
