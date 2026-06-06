// genera los mipmaps de android (launcher + round + adaptive foreground) desde
// el logo 1024x1024 de una app, sin depender de @capacitor/assets (su sharp
// antiguo no carga en este sistema).
//
// uso (desde un cwd con sharp resolvible, ej. sis/packages/api):
//   node generate-android-icons.mjs '{"resDir":"...","logo":"...","bgColor":"#0a0c0e","logoHasBackground":false}'
//
// - logoHasBackground=true: el logo ya trae su fondo (sis, carreterinas) y se
//   usa tal cual como icono legacy; false: se compone sobre bgColor (duckhunt)
// - adaptive foreground: logo al 60% centrado (safe zone de 66/108dp)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(`${process.cwd()}/`);
const sharp = require('sharp');

const cfg = JSON.parse(process.argv[2]);
const { resDir, logo, bgColor, logoHasBackground } = cfg;

const LAUNCHER_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND_SIZES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
};

const circleMask = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

// base 1024 cuadrada opaca para launcher legacy
async function buildBase() {
  if (logoHasBackground) return sharp(logo).resize(1024, 1024).png().toBuffer();
  const inner = await sharp(logo).resize(768, 768).png().toBuffer();
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: hexToRgb(bgColor) } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
}

// foreground adaptive: logo al 60% sobre lienzo transparente
async function buildForeground() {
  const inner = await sharp(logo).resize(616, 616).png().toBuffer();
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
}

const base = await buildBase();
const foreground = await buildForeground();

for (const [density, size] of Object.entries(LAUNCHER_SIZES)) {
  const dir = join(resDir, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  await sharp(base).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'));
  await sharp(base)
    .resize(size, size)
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toFile(join(dir, 'ic_launcher_round.png'));
}

for (const [density, size] of Object.entries(FOREGROUND_SIZES)) {
  const dir = join(resDir, `mipmap-${density}`);
  await sharp(foreground).resize(size, size).png().toFile(join(dir, 'ic_launcher_foreground.png'));
}

writeFileSync(
  join(resDir, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bgColor}</color>\n</resources>\n`,
);

console.log(`iconos generados en ${resDir} (bg ${bgColor})`);
