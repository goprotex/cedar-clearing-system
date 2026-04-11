/**
 * Generates public/icons/icon-192x192.png and icon-512x512.png for the PWA manifest.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "icons");

function iconSvg(size) {
  const fs = Math.round(size * 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#131313"/>
  <rect x="${size * 0.08}" y="${size * 0.08}" width="${size * 0.84}" height="${size * 0.84}" rx="${size * 0.12}" fill="none" stroke="#00ff41" stroke-width="${Math.max(2, size * 0.02)}"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#00ff41" font-family="system-ui,Segoe UI,sans-serif" font-weight="800" font-size="${fs}">CH</text>
</svg>`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const s of [192, 512]) {
    const buf = Buffer.from(iconSvg(s));
    const out = path.join(outDir, `icon-${s}x${s}.png`);
    await sharp(buf).png().toFile(out);
    console.log("Wrote", out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
