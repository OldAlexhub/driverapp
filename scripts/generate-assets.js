#!/usr/bin/env node
// Generate resized icons and splash PNGs from assets/images/playstore.png
// Usage:
//   npm install sharp
//   node ./scripts/generate-assets.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'assets', 'images', 'playstore.png');

if (!fs.existsSync(src)) {
  console.error('Source image not found:', src);
  process.exit(1);
}

const ensure = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };

// Android mipmap sizes (px)
const androidSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// iOS icon sizes (common set)
const iosSizes = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024];

// Splash sizes to produce
const splashSizes = [512, 1024, 2048];

async function gen() {
  console.log('Generating assets from', src);

  // Android mipmaps
  for (const [dir, size] of Object.entries(androidSizes)) {
    const outDir = path.join(root, 'assets', dir);
    ensure(outDir);
    const outFile = path.join(outDir, 'ic_launcher.png');
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(outFile);
    console.log('Wrote', outFile);
  }

  // iOS icons
  const iosOut = path.join(root, 'assets', 'ios-icons');
  ensure(iosOut);
  for (const size of iosSizes) {
    const outFile = path.join(iosOut, `Icon-${size}.png`);
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(outFile);
    console.log('Wrote', outFile);
  }

  // Splash
  const splashOut = path.join(root, 'assets', 'images');
  ensure(splashOut);
  for (const size of splashSizes) {
    const outFile = path.join(splashOut, `splash-${size}.png`);
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toFile(outFile);
    console.log('Wrote', outFile);
  }

  console.log('All assets generated.');
}

gen().catch((err) => { console.error(err); process.exit(1); });
