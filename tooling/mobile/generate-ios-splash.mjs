// genera el splash de ios (2732x2732, logo centrado sobre el color de fondo del
// tema) en el Splash.imageset del template de capacitor, en las tres escalas
// (1x/2x/3x) que referencia su Contents.json — todas apuntan a la misma imagen,
// como hace el template por defecto. análogo a generate-android-splash.mjs.
//
// uso (desde un cwd con sharp resolvible, ej. sis/packages/api; ejecutar DESPUÉS
// de `cap add ios`, que crea el Assets.xcassets):
//   node generate-ios-splash.mjs '{"assetsDir":".../packages/web/ios/App/App/Assets.xcassets","logo":"...","bgColor":"#0a0c0e"}'
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(`${process.cwd()}/`);
const sharp = require('sharp');

const { assetsDir, logo, bgColor } = JSON.parse(process.argv[2]);
const imagesetDir = join(assetsDir, 'Splash.imageset');
mkdirSync(imagesetDir, { recursive: true });

const SPLASH_SIZE = 2732; // ipad pro 12.9": el lienzo universal del template de capacitor
const FILES = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'];

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
};

// logo al 28% del lado (mismo criterio visual que el splash android) centrado
// sobre bgColor. el storyboard del template muestra esta imagen a tamaño completo.
async function buildSplash() {
  const side = Math.round(SPLASH_SIZE * 0.28);
  const inner = await sharp(logo).resize(side, side).png().toBuffer();
  return sharp({ create: { width: SPLASH_SIZE, height: SPLASH_SIZE, channels: 4, background: hexToRgb(bgColor) } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
}

const splash = await buildSplash();
FILES.forEach((f) => writeFileSync(join(imagesetDir, f), splash));

writeFileSync(
  join(imagesetDir, 'Contents.json'),
  `${JSON.stringify(
    {
      images: FILES.map((filename, i) => ({ idiom: 'universal', filename, scale: `${i + 1}x` })),
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  )}\n`,
);

console.log(`splash ios generado en ${imagesetDir} (bg ${bgColor})`);
