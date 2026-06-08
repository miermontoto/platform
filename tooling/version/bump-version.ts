// bump de versión snapshot (estilo minecraft: <yy>w<ww><letra>) compartido por
// las apps de la plataforma. extraído del scripts/bump-version.ts de sis.
//
// uso: tsx bump-version.ts [ruta/a/constants.ts]   (default: src/constants.ts
// relativo a cwd — los scripts de app lo invocan desde packages/api).
// misma semana iso → avanza la letra; semana nueva → resetea a 'a'. al agotarse la 'z'
// la letra crece en longitud estilo columnas de hoja de cálculo (z→aa, az→ba, zz→aaa),
// NO al siguiente codepoint ascii ('{'), que rompería el formato y el propio bump.
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const CONSTANTS_PATH = resolve(process.cwd(), process.argv[2] ?? 'src/constants.ts');
const VERSION_RE = /export const VERSION = '(\d{2}w\d{2})([a-z]+)';/;

// incrementa la(s) letra(s) con rollover: a→b … y→z → z→aa → aa→ab … az→ba … zz→aaa.
function nextLetter(letters: string): string {
  const chars = letters.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== 'z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'a'; // carry: esta posición vuelve a 'a' y seguimos con la anterior
  }
  return 'a' + chars.join(''); // todas eran 'z' → crece una posición
}

function isoWeekTag(): string {
  const d = new Date();
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // lunes=0
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // jueves de la semana ISO
  const firstThu = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((target.getTime() - firstThu.getTime()) / (7 * 86_400_000));
  return `${String(target.getUTCFullYear() % 100).padStart(2, '0')}w${String(week).padStart(2, '0')}`;
}

const src = readFileSync(CONSTANTS_PATH, 'utf-8');
const match = src.match(VERSION_RE);

if (!match) {
  console.error(`no se encontró VERSION en ${CONSTANTS_PATH}`);
  process.exit(1);
}

const [fullMatch, currentWeek, currentLetter] = match;
const newWeek = isoWeekTag();
const newLetter = newWeek === currentWeek ? nextLetter(currentLetter) : 'a';
const newVersion = `${newWeek}${newLetter}`;

writeFileSync(CONSTANTS_PATH, src.replace(fullMatch, `export const VERSION = '${newVersion}';`));
console.log(`${match[1]}${match[2]} -> ${newVersion}`);
