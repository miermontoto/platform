// versión snapshot de la app (`export const VERSION = '26w45a'` en el constants.ts de su api,
// lo que bumpea tooling/version) para el svelte.config.js de su web:
//
//   import { appVersion } from '@platform/config/version';
//   kit: { version: { name: appVersion() } }
//
// así `version` de $app/environment es la misma versión que la api, y la telemetría de cliente
// sabe qué build corre cada pestaña o app nativa (que puede ir varias por detrás de la api).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION_RE = /export const VERSION = '([^']+)'/;
// desde packages/web (cwd de vite y de svelte-kit) al constants.ts de la api
const DEFAULT_CONSTANTS = '../api/src/constants.ts';

/**
 * @param {string} [constantsPath] relativo a cwd (default ../api/src/constants.ts)
 * @returns {string | undefined} undefined si no se encuentra: kit cae a su versión por defecto
 */
export function appVersion(constantsPath = DEFAULT_CONSTANTS) {
  try {
    return VERSION_RE.exec(readFileSync(resolve(process.cwd(), constantsPath), 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}
