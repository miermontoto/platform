// sirve la spa estática del build de sveltekit con fallback a 200.html.
// registrar SIEMPRE al final, después de todas las rutas de api.
//
// cache: lo hasheado (/_app/immutable/*) es inmutable un año; todo lo demás (200.html,
// service-worker.js, registerSW.js, _app/version.json, manifest, iconos) va con no-cache para
// que navegador y cdn revaliden en cada deploy (sin cabecera, cloudflare aplica 4h y sigue
// sirviendo el service worker del build anterior).
// fallback: solo las navegaciones reciben 200.html. un asset que no existe (/_app/* o una
// extensión de asset conocida) es 404: el chunk de un build anterior debe fallar rápido para
// que sveltekit recargue, no cachearse como html bajo una url .js. la lista de extensiones es
// cerrada a propósito: hay rutas con puntos en el parámetro (ids de usuario de spotify en sis).
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'fs';
import path from 'path';
import type { Env, Hono } from 'hono';

const API_PREFIX = '/api/';
const APP_PREFIX = '/_app/';
const IMMUTABLE_PREFIX = '/_app/immutable/';
const FALLBACK_FILE = '200.html';
const CACHE_CONTROL = 'Cache-Control';
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_REVALIDATE = 'no-cache';
const ASSET_EXT_RE = /\.(?:m?js|css|map|json|webmanifest|html|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|txt|xml|wasm)$/i;

export interface MountSpaOptions {
  // directorio absoluto del build estático (default: ./static relativo a cwd)
  staticDir?: string;
  // root relativo que recibe serveStatic (debe apuntar al mismo directorio)
  root?: string;
}

export function mountSpa<E extends Env>(
  app: Hono<E>,
  { staticDir = path.resolve(process.cwd(), 'static'), root = './static' }: MountSpaOptions = {},
): void {
  // sin build estático (dev con vite aparte) no se monta nada
  if (!fs.existsSync(staticDir)) return;

  // la cabecera va sobre la Response que devuelve serveStatic al encontrar el fichero: su onFound
  // corre después de construirla y un c.header() ahí se pierde. si no lo encuentra, serveStatic
  // sigue la cadena (notFound) y no devuelve una Response.
  const statics = serveStatic({ root });
  app.use('/*', async (c, next) => {
    const found = await statics(c, next);
    if (!(found instanceof Response)) return;
    found.headers.set(CACHE_CONTROL, c.req.path.startsWith(IMMUTABLE_PREFIX) ? CACHE_IMMUTABLE : CACHE_REVALIDATE);
    return found;
  });

  // 200.html se lee una vez al montar: el build no cambia en caliente (cada deploy es un proceso nuevo)
  const fallbackFile = path.join(staticDir, FALLBACK_FILE);
  const fallback = fs.existsSync(fallbackFile) ? fs.readFileSync(fallbackFile, 'utf8') : null;

  // fallback spa: navegación desconocida → 200.html; api desconocida → 404 json; asset → 404
  app.notFound((c) => {
    const requested = c.req.path;
    if (requested.startsWith(API_PREFIX)) return c.json({ error: 'not found' }, 404);
    if (fallback === null || requested.startsWith(APP_PREFIX) || ASSET_EXT_RE.test(requested)) {
      return c.text('not found', 404);
    }
    c.header(CACHE_CONTROL, CACHE_REVALIDATE);
    return c.html(fallback);
  });
}
