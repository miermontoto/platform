// factoría del hono base de la plataforma: logger, cors en /api/* y errores estructurados
import { Hono } from 'hono';
import type { Env } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

export interface PlatformAppOptions {
  // prefijos de mensaje que indican fallo de config/dependencia externa → 503 en vez de 500
  configErrorPrefixes?: RegExp;
}

/**
 * crea el hono base con el middleware estándar. las rutas, el gate de sesión
 * y la spa los registra cada app encima.
 */
export function createPlatformApp<E extends Env>(opts: PlatformAppOptions = {}): Hono<E> {
  const app = new Hono<E>();

  app.use('*', logger());
  app.use('/api/*', cors());

  // traduce errores no capturados a respuestas estructuradas en /api/*.
  app.onError((err, c) => {
    if (!c.req.path.startsWith('/api/')) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const isConfig = opts.configErrorPrefixes?.test(msg) ?? false;
    console.error(`[api] ${c.req.method} ${c.req.path}: ${msg}`);
    return c.json({ error: msg }, isConfig ? 503 : 500);
  });

  return app;
}
