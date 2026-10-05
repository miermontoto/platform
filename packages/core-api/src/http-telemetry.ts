// telemetría http: un span SERVER por request (continúa el traceparent entrante, se
// nombra con la ruta plantilla y lleva el status) y una línea de access log con duración
// y trace id. el trace id viaja en `x-trace-id` para que el cliente (o un agente mirando
// la pestaña de red) salte de una respuesta fallida a su traza. el traceparent entrante
// es dato del cliente: solo decide a qué traza se une el span (así los servicios propios
// encadenan sus trazas), nunca si se registra.
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { context, propagation, SpanKind, SpanStatusCode, trace, type TextMapGetter } from '@opentelemetry/api';
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

const log = createLogger('http');

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
          'url.path': path,
          'user_agent.original': c.req.header('user-agent'),
          // ip real tras nginx-proxy, que sobrescribe x-real-ip con $remote_addr (x-forwarded-for
          // no: lo arrastra del cliente). informativo; un acceso directo al puerto puede falsearlo
          'client.address': c.req.header('x-real-ip'),
        },
      },
      parent,
    );
    const { traceId } = span.spanContext();
    const start = performance.now();
    c.header(TRACE_HEADER, traceId);

    await context.with(trace.setSpan(parent, span), async () => {
      try {
        await next();
      } finally {
        const { status } = c.res;
        const route = routePath(c);
        const ms = Math.round(performance.now() - start);
        span.setAttribute('http.response.status_code', status);
        if (!CATCH_ALL_ROUTES.has(route)) {
          span.setAttribute('http.route', route);
          span.updateName(`${method} ${route}`);
        }
        if (status >= SERVER_ERROR_STATUS) span.setStatus({ code: SpanStatusCode.ERROR });
        // las respuestas construidas a mano (new Response) no heredan el header preparado.
        // un 101 de websocket no admite re-crear la respuesta: se queda sin header.
        if (!c.res.headers.has(TRACE_HEADER)) {
          try {
            c.header(TRACE_HEADER, traceId);
          } catch {}
        }
        const level = status >= SERVER_ERROR_STATUS ? 'error' : ms >= slowMs! ? 'warn' : 'info';
        log[level](`${method} ${path} ${status} ${ms}ms`);
        span.end();
      }
    });
  };
}
