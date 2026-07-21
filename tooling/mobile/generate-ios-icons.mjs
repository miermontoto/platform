// genera el app icon de ios (1024x1024 opaco, SIN canal alfa — el app store lo
// exige) desde el logo 1024x1024 de una app, dentro del AppIcon.appiconset del
// template de capacitor. análogo a generate-android-icons.mjs, sin depender de
// @capacitor/assets (su sharp antiguo no carga en este sistema).
//
// uso (desde un cwd con sharp resolvible, ej. sis/packages/api; ejecutar DESPUÉS
// de `cap add ios`, que crea el Assets.xcassets):
//   node generate-ios-icons.mjs '{"assetsDir":".../packages/web/ios/App/App/Assets.xcassets","logo":"...","bgColor":"#0a0c0e","logoHasBackground":false}'
//
// - logoHasBackground=true: el logo ya trae su fondo y se aplana tal cual;
//   false: se compone el logo (768/1024 ≈ 75%) centrado sobre bgColor (duckhunt).
// - xcode 14+/capacitor 7 usa un único marketing icon 1024 en el catálogo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToRgb, loadSharp } from './lib.mjs';

const sharp = loadSharp();
const { assetsDir, logo, bgColor, logoHasBackground } = JSON.parse(process.argv[2]);
const iconsetDir = join(assetsDir, 'AppIcon.appiconset');
mkdirSync(iconsetDir, { recursive: true });

const ICON_SIZE = 1024; // marketing icon, único en el template de capacitor 7
const ICON_FILE = 'AppIcon-512@2x.png';

// icono 1024 opaco: aplanado sobre bgColor para garantizar png sin alfa. el
// flatten compone cualquier transparencia del logo contra el fondo del tema.
async function buildIcon() {
  if (logoHasBackground) {
    return sharp(logo).resize(ICON_SIZE, ICON_SIZE).flatten({ background: hexToRgb(bgColor) }).png().toBuffer();
  }
  const inner = await sharp(logo).resize(768, 768).png().toBuffer();
  return sharp({ create: { width: ICON_SIZE, height: ICON_SIZE, channels: 4, background: hexToRgb(bgColor) } })
    .composite([{ input: inner, gravity: 'center' }])
    .flatten({ background: hexToRgb(bgColor) })
    .png()
    .toBuffer();
}

writeFileSync(join(iconsetDir, ICON_FILE), await buildIcon());
writeFileSync(
  join(iconsetDir, 'Contents.json'),
  `${JSON.stringify(
    {
      images: [{ filename: ICON_FILE, idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  )}\n`,
);

console.log(`app icon ios generado en ${iconsetDir} (bg ${bgColor})`);
