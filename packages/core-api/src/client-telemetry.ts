// ruta de ingesta de la telemetría de cliente (CLIENT_TELEMETRY_PATH). createPlatformApp la
// registra ANTES que la telemetría http, cors y el gate de cada app: es pre-auth (los errores
// de la pantalla de login también cuentan) y no genera span ni access log propios, que serían
// una línea por lote de cada pestaña abierta.
//
// sin auth y abierta a internet: body acotado, cubo de tokens por ip y validación completa
// en ingestClientBatch. sin export otlp responde 404 y el cliente deja de enviar.
import type { Context, Env, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CLIENT_TELEMETRY_PATH, clientTelemetryEnabled, createLogger, ingestClientBatch, WIRE_LIMITS } from '@platform/observability';
import { DEFAULT_STATIC_DIR } from './spa.js';

export interface ClientTelemetryOptions {
  // usuario de la request (user.id en el backend) desde la cookie de sesión de la app; el
  // cliente nunca lo manda. undefined/null = anónimo. Context sin tipar: solo lee cookies
  identify?: (c: Context) => string | number | null | undefined;
  // build de la spa con sus source maps, para simbolizar stacks (default: el de mountSpa)
  staticDir?: string;
}

// cubo por ip: ráfaga de BURST lotes y REFILL_PER_S de recarga (~30/min). un cliente normal
// manda un lote cada 5s como mucho, más los envíos urgentes de errores
const BURST = 20;
const REFILL_PER_S = 0.5;
// tope de ips seguidas: al pasarlo se vacía la tabla entera (memoria acotada; olvidar cubos
// solo regala una ráfaga)
const MAX_TRACKED_CLIENTS = 10_000;
const MS_PER_S = 1_000;
const UNKNOWN_CLIENT = 'unknown';
// origen del webview de ios; el de android (https://app.<dominio>) manda por CapacitorHttp, sin Origin
const NATIVE_ORIGIN_PROTOCOL = 'capacitor:';

const log = createLogger('client-telemetry');
const buckets = new Map<string, { tokens: number; at: number }>();

const allow = (client: string): boolean => {
  const t = Date.now();
  const prev = buckets.get(client) ?? { tokens: BURST, at: t };
  const tokens = Math.min(BURST, prev.tokens + ((t - prev.at) / MS_PER_S) * REFILL_PER_S);
  if (buckets.size >= MAX_TRACKED_CLIENTS) buckets.clear();
  buckets.set(client, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: t });
  return tokens >= 1;
};

// identidad solo para lotes de la propia app: sin Origin (CapacitorHttp nativo), del mismo host
// que la api o del webview de ios. text/plain no dispara preflight, así que una página ajena sí
// puede mandar un lote con las cookies de quien la visita (si no son SameSite=Lax): entra como
// anónimo y no puede firmar errores a nombre de nadie. "null" (iframe sandbox) no parsea: ajeno
const firstParty = (c: Context): boolean => {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === NATIVE_ORIGIN_PROTOCOL || url.host === c.req.header('host');
  } catch {
    return false;
  }
};

export function mountClientTelemetry<E extends Env>(app: Hono<E>, { identify, staticDir = DEFAULT_STATIC_DIR }: ClientTelemetryOptions = {}): void {
  app.post(
    CLIENT_TELEMETRY_PATH,
    bodyLimit({ maxSize: WIRE_LIMITS.bodyBytes, onError: (c) => c.body(null, 413) }),
    async (c) => {
      if (!clientTelemetryEnabled()) return c.body(null, 404);
      // ip real tras nginx-proxy (ver client.address en http-telemetry)
      const client = c.req.header('x-real-ip') ?? UNKNOWN_CLIENT;
      if (!allow(client)) return c.body(null, 429);

      // sin content-length, bodyLimit corta el stream al pasar el tope y la lectura falla: se
      // responde aquí (relanzar llevaría el corte al onError de la app, una línea de error por
      // cada body abusivo)
      let text: string;
      try {
        text = await c.req.text();
      } catch {
        return c.body(null, 413);
      }
      let batch: unknown;
      try {
        batch = JSON.parse(text);
      } catch {
        return c.body(null, 400);
      }
      let userId: string | undefined;
      try {
        const id = firstParty(c) ? identify?.(c) : undefined;
        userId = id === null || id === undefined ? undefined : String(id);
      } catch (err) {
        // una sesión que no se puede resolver no tira el lote: llega como anónimo
        log.warn('identify falló:', err);
      }
      const accepted = await ingestClientBatch(batch, {
        userAgent: c.req.header('user-agent'),
        clientAddress: client === UNKNOWN_CLIENT ? undefined : client,
        userId,
        staticDir,
      });
      return c.body(null, accepted === null ? 400 : 204);
    },
  );
}
