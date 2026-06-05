// sirve la spa estática del build de sveltekit con fallback a 200.html.
// registrar SIEMPRE al final, después de todas las rutas de api.
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'fs';
import path from 'path';
import type { Env, Hono } from 'hono';

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

  app.use('/*', serveStatic({ root }));

  // fallback spa: ruta no api desconocida → 200.html; api desconocida → 404 json
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    const fallback = path.join(staticDir, '200.html');
    if (fs.existsSync(fallback)) return c.html(fs.readFileSync(fallback, 'utf8'));
    return c.text('not found', 404);
  });
}
