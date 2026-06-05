// carga de .env para las apis: raíz de la app (dev en monorepo) o cwd (docker),
// con .env.local sobrescribiendo en dev local.
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

/**
 * carga el .env de la app. `metaUrl` es el import.meta.url del entrypoint;
 * `levelsUp` cuántos niveles hay desde su carpeta hasta la raíz de la app
 * (default 3: packages/api/src → raíz de la app).
 */
export function loadAppEnv(metaUrl: string, { levelsUp = 3 }: { levelsUp?: number } = {}): void {
  const dir = dirname(fileURLToPath(metaUrl));
  const appRootEnv = resolve(dir, ...Array(levelsUp).fill('..'), '.env');
  const cwdEnv = resolve(process.cwd(), '.env');
  const envPath = existsSync(appRootEnv) ? appRootEnv : cwdEnv;
  if (existsSync(envPath)) dotenv.config({ path: envPath });

  const envLocalPath = envPath.replace(/\.env$/, '.env.local');
  if (existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath, override: true });
    console.log(`[env] override desde ${envLocalPath}`);
  }
}
