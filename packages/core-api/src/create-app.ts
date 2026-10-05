// factoría del hono base de la plataforma: telemetría http (span + access log), cors en
// /api/* y errores estructurados con trace id
import { Hono } from 'hono';
import type { Env } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { trace } from '@opentelemetry/api';
import { createLogger, currentTraceId } from '@platform/observability';
import { DEFAULT_QUIET_PATHS, TRACE_HEADER, httpTelemetry } from './http-telemetry.js';

export interface PlatformAppOptions {
  // prefijos de mensaje que indican fallo de config/dependencia externa → 503 en vez de 500
  configErrorPrefixes?: RegExp;
  // rutas sin span ni access log (default: assets estáticos de la spa y sondas de salud)
  quietPaths?: RegExp;
}

const log = createLogger('api');

/**
 * crea el hono base con el middleware estándar. las rutas, el gate de sesión
 * y la spa los registra cada app encima.
 */
export function createPlatformApp<E extends Env>(opts: PlatformAppOptions = {}): Hono<E> {
  const app = new Hono<E>();

  app.use('*', httpTelemetry(opts.quietPaths ?? DEFAULT_QUIET_PATHS));
  // x-trace-id expuesto a los clientes cross-origin (app nativa contra la api remota)
  app.use('/api/*', cors({ exposeHeaders: [TRACE_HEADER] }));

  // traduce errores no capturados a respuestas estructuradas en /api/*, con el trace id
  // para saltar a la traza. fuera de /api responde como el handler por defecto de hono
  // (relanzar haría que hono reinvocara este handler en cada nivel de middleware).
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    const msg = err instanceof Error ? err.message : String(err);
    trace.getActiveSpan()?.recordException(err);
    log.error(`${c.req.method} ${c.req.path}:`, err);
    if (!c.req.path.startsWith('/api/')) return c.text('Internal Server Error', 500);
    const isConfig = opts.configErrorPrefixes?.test(msg) ?? false;
    return c.json({ error: msg, traceId: currentTraceId() }, isConfig ? 503 : 500);
  });

  return app;
}
