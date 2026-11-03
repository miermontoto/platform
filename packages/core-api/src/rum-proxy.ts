// proxy del rum de openobserve (RUM_PROXY_PATH). el sdk de navegador manda aquí sus lotes con
// `?o2forward=/rum/v1/<org>/rum?<params>` y la api los reenvía a openobserve por la red interna:
// - a SU org (la del export otlp), diga lo que diga el cliente
// - con el token de rum de esa org en vez del del bundle, que no lleva ninguno
// - con el usr.id de la sesión (identify) en cada evento, nunca el que mande el cliente
// - cada evento reconstruido desde las claves del esquema de rum (openobserve aplana: un `usr_id`
//   o `ip` de primer nivel del cliente caería en la columna del servidor) y con las urls redactadas
//   (tokens de share en el path, codes oauth en la query, fragmento) como los paths de las trazas
// - con la ip y el user-agent del navegador, para la geo y el dispositivo del rum
// createPlatformApp la registra ANTES que la telemetría http, cors y el gate de cada app: pre-auth
// (la pantalla de login también se mide) y sin span ni access log propios, que serían una línea
// por lote de cada pestaña. sin export otlp responde 404 y el sdk descarta el lote.
//
// sin auth y abierta a internet: body acotado, cubo de tokens por ip y solo lotes de rum.
import type { Context, Env, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createLogger, openObserveTarget, RUM_LIMITS, RUM_PROXY_PATH, rumToken } from '@platform/observability';
import { redactUrl } from './redact.js';

export interface ClientTelemetryOptions {
  // usuario de la request (usr.id en el rum) desde la cookie de sesión de la app; el cliente nunca
  // lo manda. undefined/null = anónimo. Context sin tipar: solo lee cookies
  identify?: (c: Context) => string | number | null | undefined;
}

// cubo por ip: ráfaga de BURST lotes y REFILL_PER_S de recarga (~60/min). el sdk agrupa por vista
// y manda al cambiar de vista, al ocultarse la página y cada pocos segundos con actividad
const BURST = 30;
const REFILL_PER_S = 1;
// tope de ips seguidas: al pasarlo se vacía la tabla entera (memoria acotada; olvidar cubos
// solo regala una ráfaga)
const MAX_TRACKED_CLIENTS = 10_000;
const MS_PER_S = 1_000;
const UNKNOWN_CLIENT = 'unknown';
// origen del webview de ios; el de android (https://app.<dominio>) manda por CapacitorHttp, sin Origin
const NATIVE_ORIGIN_PROTOCOL = 'capacitor:';
// lo único que reenvía: el intake de rum (la build slim no manda replay ni logs)
const FORWARD_RE = /^\/rum\/v1\/[^/?]+\/rum\?(.*)$/;
const TOKEN_PARAM = 'o2-api-key';
// lotes comprimidos (compressIntakeRequests) no se pueden reescribir: el sdk se configura sin
const ENCODING_PARAM = 'o2-evp-encoding';
// claves de primer nivel de un evento de rum (esquema rum-events-format del que deriva el sdk, con
// _o2 en vez de _dd). usr no está: lo pone el servidor. una clave desconocida se descarta y se avisa
// una vez, para notar si una versión nueva del sdk añade alguna
const RUM_EVENT_KEYS = new Set([
  'type', 'date', 'application', 'service', 'version', 'build_version', 'build_id', 'source',
  'session', 'view', 'action', 'resource', 'error', 'long_task', 'vital', 'stream', 'connectivity',
  'display', 'synthetics', 'ci_test', 'os', 'device', 'context', 'container', 'feature_flags',
  'privacy', 'account', '_o2',
]);
const SERVER_ERROR_STATUS = 500;
const UPSTREAM_ERROR = 502;

const log = createLogger('rum');
const buckets = new Map<string, { tokens: number; at: number }>();
const droppedKeys = new Set<string>();

const allow = (client: string): boolean => {
  const t = Date.now();
  const prev = buckets.get(client) ?? { tokens: BURST, at: t };
  const tokens = Math.min(BURST, prev.tokens + ((t - prev.at) / MS_PER_S) * REFILL_PER_S);
  if (buckets.size >= MAX_TRACKED_CLIENTS) buckets.clear();
  buckets.set(client, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: t });
  return tokens >= 1;
};

// identidad solo para lotes de la propia app: sin Origin (CapacitorHttp nativo), del mismo host
// que la api o del webview de ios. el sdk manda text/plain, sin preflight, así que una página
// ajena sí puede mandar un lote con las cookies de quien la visita (si no son SameSite=Lax): entra
// como anónimo y no puede firmar sesiones a nombre de nadie. "null" (iframe sandbox) no parsea
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

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// redacta in situ las urls de un objeto anidado (view.url, resource.url, error.resource.url...)
const redactIn = (parent: unknown, ...keys: string[]): void => {
  if (!isObject(parent)) return;
  keys.forEach((key) => {
    if (key in parent) parent[key] = redactUrl(parent[key]);
  });
};

// un evento del cliente → el que se guarda: solo claves del esquema, urls redactadas, usr del servidor
const sanitize = (event: Json, userId: string | undefined): Json => {
  const kept = Object.fromEntries(
    Object.entries(event).filter(([key]) => {
      if (RUM_EVENT_KEYS.has(key)) return true;
      if (key !== 'usr' && !droppedKeys.has(key)) {
        droppedKeys.add(key);
        log.warn(`clave de rum desconocida descartada: ${key}`);
      }
      return false;
    }),
  );
  redactIn(kept.view, 'url', 'referrer');
  redactIn(kept.resource, 'url');
  redactIn(isObject(kept.error) ? kept.error.resource : undefined, 'url');
  return userId ? { ...kept, usr: { id: userId } } : kept;
};

// cada línea es un evento json; las que no parsean como objeto se descartan
const rewrite = (body: string, userId: string | undefined): string | null => {
  const lines = body.split('\n').filter(Boolean);
  if (lines.length > RUM_LIMITS.events) return null;
  return lines
    .flatMap((line) => {
      try {
        const event: unknown = JSON.parse(line);
        return isObject(event) ? [JSON.stringify(sanitize(event, userId))] : [];
      } catch {
        return [];
      }
    })
    .join('\n');
};

export function mountRumProxy<E extends Env>(app: Hono<E>, { identify }: ClientTelemetryOptions = {}): void {
  app.post(RUM_PROXY_PATH, bodyLimit({ maxSize: RUM_LIMITS.bodyBytes, onError: (c) => c.body(null, 413) }), async (c) => {
    const target = openObserveTarget();
    if (!target) return c.body(null, 404);
    // ip real tras nginx-proxy (ver client.address en http-telemetry)
    const client = c.req.header('x-real-ip') ?? UNKNOWN_CLIENT;
    if (!allow(client)) return c.body(null, 429);

    const forward = FORWARD_RE.exec(c.req.query('o2forward') ?? '');
    if (!forward) return c.body(null, 400);
    const params = new URLSearchParams(forward[1]);
    if (params.has(ENCODING_PARAM)) return c.body(null, 400);

    // sin content-length, bodyLimit corta el stream al pasar el tope y la lectura falla: se
    // responde aquí (relanzar llevaría el corte al onError de la app, una línea por body abusivo)
    let text: string;
    try {
      text = await c.req.text();
    } catch {
      return c.body(null, 413);
    }
    let userId: string | undefined;
    try {
      const id = firstParty(c) ? identify?.(c) : undefined;
      userId = id === null || id === undefined ? undefined : String(id);
    } catch (err) {
      // una sesión que no se puede resolver no tira el lote: llega como anónimo
      log.warn('identify falló:', err);
    }
    const body = rewrite(text, userId);
    if (body === null) return c.body(null, 413);

    try {
      params.set(TOKEN_PARAM, await rumToken(target));
      const res = await fetch(`${target.base}/rum/v1/${target.org}/rum?${params}`, {
        method: 'POST',
        body,
        headers: {
          'content-type': c.req.header('content-type') ?? 'text/plain;charset=UTF-8',
          ...(client !== UNKNOWN_CLIENT && { 'x-forwarded-for': client }),
          ...(c.req.header('user-agent') && { 'user-agent': c.req.header('user-agent')! }),
        },
      });
      // 4xx de openobserve (lote inválido) → el sdk lo descarta; 5xx → lo reintenta
      return c.body(null, res.ok ? 202 : res.status < SERVER_ERROR_STATUS ? 400 : UPSTREAM_ERROR);
    } catch (err) {
      log.warn('reenvío a openobserve falló:', err);
      return c.body(null, UPSTREAM_ERROR);
    }
  });
}
