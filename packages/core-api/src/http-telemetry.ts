// telemetría http: un span SERVER por request (continúa el traceparent entrante, se
// nombra con la ruta plantilla y lleva el status) y una línea de access log con duración
// y trace id. el trace id viaja en `x-trace-id` para que el cliente (o un agente mirando
// la pestaña de red) salte de una respuesta fallida a su traza. el traceparent entrante
// es dato del cliente: solo decide a qué traza se une el span (así los servicios propios
// encadenan sus trazas), nunca si se registra.
import type { Context, MiddlewareHandler } from 'hono';
import { matchedRoutes, routePath } from 'hono/route';
import {
  context,
  isSpanContextValid,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type TextMapGetter,
} from '@opentelemetry/api';
import { createLogger, tracer } from '@platform/observability';

/** header de respuesta con el trace id de la request. */
export const TRACE_HEADER = 'x-trace-id';

/** rutas sin span ni access log: assets estáticos de la spa (fuera de /api) y sondas de salud. */
export const DEFAULT_QUIET_PATHS =
  /^\/(?!api\/)(?:_app\/|.*\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|webmanifest|txt|xml)$)|\/(?:health|healthz|version)$/;

// a partir de esta duración el access log sube a warn (HTTP_SLOW_MS lo sobrescribe)
const DEFAULT_SLOW_MS = 1000;
const SERVER_ERROR_STATUS = 500;
// rutas comodín (middlewares, fallback de la spa): no identifican el endpoint
const CATCH_ALL_ROUTES = new Set(['', '*', '/*']);
// parámetros de ruta cuyo valor es un secreto (enlaces de share, secretos de webhook en el
// path): no deben llegar ni al access log ni al backend. la query nunca se registra.
const SENSITIVE_PARAM = /token|secret|code|pass|sig|credential|session/i;
const REDACTED = 'REDACTED';
// segmento de plantilla que es un parámetro: `:name`, con patrón `{...}` u opcional `?`
const PARAM_SEGMENT = /^:(\w+)/;
// red de seguridad para segmentos que ninguna plantilla declara como parámetro (404, url de
// webhook mal escrita): uno largo con alfabeto de token se trata como secreto. 32 cubre los
// tokens de las apps (48 hex, 43 base64url) y deja pasar ids de spotify (22); los uuid son ids
const TOKEN_LIKE_SEGMENT = /^[\w\-.~%]{32,}$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const log = createLogger('http');

/**
 * path de la request apto para logs y trazas. redacta por POSICIÓN de segmento, no por
 * sustitución de texto (el valor decodificado de un parámetro no tiene por qué coincidir con
 * el codificado que mandó el cliente): se parte el mismo path sobre el que casó el router y
 * se tapan los segmentos que alguna plantilla declara como parámetro sensible. se usan todas
 * las rutas que casan, no solo la que respondió, porque un middleware puede cortar antes del
 * handler (el 401 del gate). fuera de los parámetros declarados no sensibles (`:id`), un
 * segmento con pinta de token también se tapa.
 */
export function loggablePath(c: Context): string {
  const params = matchedRoutes(c).flatMap((route) =>
    route.path.split('/').flatMap((segment, i) => {
      const name = PARAM_SEGMENT.exec(segment)?.[1];
      return name ? [{ i, sensitive: SENSITIVE_PARAM.test(name) }] : [];
    }),
  );
  const sensitive = new Set(params.filter((p) => p.sensitive).map((p) => p.i));
  const declared = new Set(params.map((p) => p.i));
  const tokenLike = (segment: string, i: number) =>
    !declared.has(i) && TOKEN_LIKE_SEGMENT.test(segment) && !UUID_SEGMENT.test(segment);
  return c.req.path
    .split('/')
    .map((segment, i) => (sensitive.has(i) || tokenLike(segment, i) ? REDACTED : segment))
    .join('/');
}

const headerGetter: TextMapGetter<Headers> = {
  get: (headers, key) => headers.get(key) ?? undefined,
  // forEach y no keys(): este último exige la lib DOM.Iterable en el tsconfig de la app
  keys: (headers) => {
    const keys: string[] = [];
    headers.forEach((_, key) => keys.push(key));
    return keys;
  },
};

export function httpTelemetry(quietPaths: RegExp): MiddlewareHandler {
  // se lee en la primera request: el middleware se crea antes de que loadAppEnv cargue el .env
  let slowMs: number | undefined;

  return async (c, next) => {
    const { method, path } = c.req;
    if (quietPaths.test(path)) return next();
    slowMs ??= Number(process.env.HTTP_SLOW_MS) || DEFAULT_SLOW_MS;

    const parent = propagation.extract(context.active(), c.req.raw.headers, headerGetter);
    const span = tracer.startSpan(
      method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': method,
          'user_agent.original': c.req.header('user-agent'),
          // ip real tras nginx-proxy, que sobrescribe x-real-ip con $remote_addr (x-forwarded-for
          // no: lo arrastra del cliente). informativo; un acceso directo al puerto puede falsearlo
          'client.address': c.req.header('x-real-ip'),
        },
      },
      parent,
    );
    // sin sdk (tests, OTEL_SDK_DISABLED) el span es no-op y su trace id son ceros: sin header
    const traceId = isSpanContextValid(span.spanContext()) ? span.spanContext().traceId : undefined;
    const start = performance.now();
    if (traceId) c.header(TRACE_HEADER, traceId);

    await context.with(trace.setSpan(parent, span), async () => {
      try {
        await next();
      } finally {
        const { status } = c.res;
        const route = routePath(c);
        const ms = Math.round(performance.now() - start);
        // tras el routing: hasta aquí no se sabe qué segmentos son parámetros sensibles
        const safePath = loggablePath(c);
        span.setAttribute('url.path', safePath);
        span.setAttribute('http.response.status_code', status);
        if (!CATCH_ALL_ROUTES.has(route)) {
          span.setAttribute('http.route', route);
          span.updateName(`${method} ${route}`);
        }
        if (status >= SERVER_ERROR_STATUS) span.setStatus({ code: SpanStatusCode.ERROR });
        // las respuestas construidas a mano (new Response) no heredan el header preparado.
        // un 101 de websocket no admite re-crear la respuesta: se queda sin header.
        if (traceId && !c.res.headers.has(TRACE_HEADER)) {
          try {
            c.header(TRACE_HEADER, traceId);
          } catch {}
        }
        const level = status >= SERVER_ERROR_STATUS ? 'error' : ms >= slowMs! ? 'warn' : 'info';
        log[level](`${method} ${safePath} ${status} ${ms}ms`);
        span.end();
      }
    });
  };
}
