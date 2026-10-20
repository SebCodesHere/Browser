import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Generates the Xuvon app icon set from a code-defined SVG so the repository
// carries no binary source assets. Run with: npm run icons
//
// Output:
//   build/icon.png           1024px icon consumed by electron-builder
//   build/icons/icon-*.png   discrete sizes for docs and Linux desktop entries

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const outDir = path.join(root, "build", "icons");

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#4a5d94"/>
      <stop offset="0.55" stop-color="#3e4f80"/>
      <stop offset="1" stop-color="#252f52"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.24" cy="0.18" r="0.85">
      <stop offset="0" stop-color="#c9f5e2" stop-opacity="0.28"/>
      <stop offset="0.6" stop-color="#c9f5e2" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#c9f5e2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="236" fill="url(#body)"/>
  <rect x="0" y="0" width="1024" height="1024" rx="236" fill="url(#glow)"/>
  <path d="M296 300 L716 720 M716 300 L296 720"
        stroke="#c9f5e2" stroke-width="96" stroke-linecap="round" fill="none"/>
  <path d="M354 760 H670" stroke="#ffd3be" stroke-width="54" stroke-linecap="round"/>
</svg>`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const base = sharp(Buffer.from(svg), { density: 288 });

  for (const size of SIZES) {
    const file = path.join(outDir, `icon-${size}.png`);
    await base.clone().resize(size, size).png().toFile(file);
    console.log(`wrote ${path.relative(root, file)}`);
  }

  const main = path.join(root, "build", "icon.png");
  await base.clone().resize(1024, 1024).png().toFile(main);
  console.log(`wrote ${path.relative(root, main)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
