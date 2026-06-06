// genera los splash screens de android (drawable + variantes port/land por
// densidad) desde el logo 1024x1024 de una app: logo centrado (~28% del lado
// menor) sobre el color de fondo del tema. también fija
// windowSplashScreenBackground (splash del sistema en android 12+) en styles.xml.
//
// uso (desde un cwd con sharp resolvible, ej. sis/packages/api):
//   node generate-android-splash.mjs '{"appDir":".../packages/web/android/app/src/main","logo":"...","bgColor":"#0a0c0e"}'
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(`${process.cwd()}/`);
const sharp = require('sharp');

const { appDir, logo, bgColor } = JSON.parse(process.argv[2]);
const resDir = join(appDir, 'res');

// tamaños del template de capacitor (land = apaisado; port = espejo)
const LAND = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
};

async function splash(w, h) {
  const side = Math.round(Math.min(w, h) * 0.28);
  const inner = await sharp(logo).resize(side, side).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: hexToRgb(bgColor) } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
}

for (const [density, [w, h]] of Object.entries(LAND)) {
  for (const [qualifier, [W, H]] of [[`land-${density}`, [w, h]], [`port-${density}`, [h, w]]]) {
    const dir = join(resDir, `drawable-${qualifier}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'splash.png'), await splash(W, H));
  }
}
// fallback sin qualifier
writeFileSync(join(resDir, 'drawable', 'splash.png'), await splash(480, 320));

// splash del sistema (android 12+): color de fondo del tema; el icono lo pone
// el sistema desde el adaptive icon del launcher
const stylesPath = join(resDir, 'values', 'styles.xml');
let styles = readFileSync(stylesPath, 'utf8');
if (!styles.includes('windowSplashScreenBackground')) {
  styles = styles.replace(
    '<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">',
    `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="windowSplashScreenBackground">${bgColor}</item>`,
  );
  writeFileSync(stylesPath, styles);
}

console.log(`splash generado en ${resDir} (bg ${bgColor})`);
