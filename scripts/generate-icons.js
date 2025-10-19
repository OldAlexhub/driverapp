/*
Small helper to generate app icons and splash-ready assets from a high-res source.
Usage:
  node ./scripts/generate-icons.js ./assets/images/icon-source.png

This script requires `sharp` which is already a dependency in the repo.
It writes several files under `assets/images/` that `app.json` expects:
  - icon.png (1024x1024)
  - icon-foreground.png (foreground layer for adaptive icon)
  - icon-background.png (background layer for adaptive icon)
  - mipmap-mdpi/ic_launcher.png
  - mipmap-hdpi/ic_launcher.png
  - mipmap-xhdpi/ic_launcher.png
  - mipmap-xxhdpi/ic_launcher.png
  - mipmap-xxxhdpi/ic_launcher.png

Note: The script produces a simple centered foreground and a solid color background.
For best results, provide a source image with a transparent background for the foreground layer.
*/

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function main() {
  const src = process.argv[2] || './assets/images/icon-source.png';
  if (!fs.existsSync(src)) {
    console.error('Source icon not found:', src);
    process.exit(1);
  }

  const outDir = path.resolve('assets', 'images');
  await ensureDir(outDir);

  // Generate main icon (1024x1024)
  await sharp(src).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(outDir, 'icon.png'));

  // Foreground: keep transparency if present, otherwise use the source resized to 768
  await sharp(src).resize(768, 768, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(outDir, 'icon-foreground.png'));

  // Background: solid color (match app.json background) at 1024x1024
  const backgroundColor = { r: 0x00, g: 0x1f, b: 0x3f, alpha: 1 };
  const bg = Buffer.alloc(4 * 1, 0);
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: backgroundColor } }).png().toFile(path.join(outDir, 'icon-background.png'));

  // Generate mipmap sizes
  const mipmapDir = path.resolve('assets');
  const sizes = [48, 72, 96, 144, 192];
  const names = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
  for (let i = 0; i < sizes.length; i++) {
    const dir = path.join(mipmapDir, names[i]);
    await ensureDir(dir);
    await sharp(src).resize(sizes[i], sizes[i], { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, 'ic_launcher.png'));
  }

  console.log('Generated icon assets in assets/images and mipmap folders. Replace icon-source.png with a high-res source if needed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
