// Generate a monochrome notification icon (white on transparent)
// from the round launcher icon and write it into Android drawable folders.
"use strict";
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');

const prefer = path.join(root, 'assets', 'images', 'icon-source.png');
let src = prefer;
if (!fs.existsSync(src)) {
  const tryPaths = [
    path.join(root, 'assets', 'mipmap-xxxhdpi', 'ic_launcher_round.png'),
    path.join(root, 'assets', 'mipmap-xxhdpi', 'ic_launcher_round.png'),
    path.join(root, 'assets', 'mipmap-xhdpi', 'ic_launcher_round.png'),
    path.join(root, 'assets', 'mipmap-hdpi', 'ic_launcher_round.png'),
    path.join(root, 'assets', 'mipmap-mdpi', 'ic_launcher_round.png'),
  ];
  const found = tryPaths.find((p) => fs.existsSync(p));
  if (found) src = found;
}

if (!fs.existsSync(src)) {
  console.error('No source icon found. Place a high-res icon at', prefer);
  process.exit(1);
}

const outRoot = path.join(root, 'android', 'app', 'src', 'main', 'res');
const sizes = {
  'drawable-mdpi': 24,
  'drawable-hdpi': 36,
  'drawable-xhdpi': 48,
  'drawable-xxhdpi': 72,
  'drawable-xxxhdpi': 96,
};

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function build() {
  console.log('Using source:', src);
  for (const [dirName, size] of Object.entries(sizes)) {
    const outDir = path.join(outRoot, dirName);
    await ensureDir(outDir);
    const outFile = path.join(outDir, 'ic_stat_notify.png');
    try {
      const buffer = await sharp(src).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const white = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
      await sharp(white).composite([{ input: buffer, blend: 'dest-in' }]).png().toFile(outFile);
      console.log('Wrote', outFile);
    } catch (err) {
      console.error('Failed to write', outFile, err);
    }
  }
  console.log('Notification icons generated. Update AndroidManifest if you wish to use @drawable/ic_stat_notify');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
