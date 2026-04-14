/**
 * Generates PWA icons for the manifest and Apple touch icons.
 * Run: node scripts/generate-pwa-icons.mjs
 *
 * Output:
 *   public/icons/icon-{size}x{size}.png   — standard PWA manifest icons
 *   public/icons/apple-touch-icon.png      — 180×180 Apple touch icon
 *   public/favicon.ico                     — 48×48 favicon (PNG in .ico wrapper)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "icons");

function iconSvg(size) {
  const fontSize = Math.round(size * 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#131313"/>
  <rect x="${size * 0.08}" y="${size * 0.08}" width="${size * 0.84}" height="${size * 0.84}" rx="${size * 0.12}" fill="none" stroke="#00ff41" stroke-width="${Math.max(2, size * 0.02)}"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#00ff41" font-family="system-ui,Segoe UI,sans-serif" font-weight="800" font-size="${fontSize}">CH</text>
</svg>`;
}

/** Sizes required by the PWA manifest + Apple guidelines. */
const MANIFEST_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const APPLE_TOUCH_SIZE = 180;
const FAVICON_SIZE = 48;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // Manifest icons
  for (const s of MANIFEST_SIZES) {
    const buf = Buffer.from(iconSvg(s));
    const out = path.join(outDir, `icon-${s}x${s}.png`);
    await sharp(buf).png().toFile(out);
    console.log("Wrote", out);
  }

  // Apple touch icon (180×180)
  const appleBuf = Buffer.from(iconSvg(APPLE_TOUCH_SIZE));
  const appleOut = path.join(outDir, "apple-touch-icon.png");
  await sharp(appleBuf).png().toFile(appleOut);
  console.log("Wrote", appleOut);

  // Favicon (48×48 PNG — browsers accept PNG-in-ico)
  const favBuf = Buffer.from(iconSvg(FAVICON_SIZE));
  const favOut = path.join(root, "public", "favicon-48x48.png");
  await sharp(favBuf).png().toFile(favOut);
  console.log("Wrote", favOut);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
