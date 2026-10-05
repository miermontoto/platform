// trazas de las llamadas salientes con el fetch nativo (undici) vía diagnostics_channel:
// sin monkey-patching de módulos, así que funciona igual en las apis bundleadas por tsup.
// cada request hecha dentro de una traza abre un span CLIENT hijo y propaga `traceparent`,
// de modo que el servicio destino (p.ej. mier.info en el login oidc) continúa la misma
// traza. fuera de una traza no se crea nada: un poller sin envolver no genera ruido.
import { subscribe } from 'node:diagnostics_channel';
import { context, propagation, SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { tracer } from './tracing.js';

// claves de query cuyo valor no debe salir en las trazas (api keys de terceros, codes oauth)
const SENSITIVE_PARAM = /token|key|secret|pass|sig|code|auth|session|credential/i;
const REDACTED = 'REDACTED';
// status http a partir del cual un span de cliente es error (4xx y 5xx, según semconv)
const CLIENT_ERROR_STATUS = 400;

const CHANNELS = {
  create: 'undici:request:create',
  headers: 'undici:request:headers',
  trailers: 'undici:request:trailers',
  error: 'undici:request:error',
} as const;

// forma mínima de la request que publica undici en sus canales
interface UndiciRequest {
  origin: string;
  method: string;
  path: string;
  addHeader?: (name: string, value: string) => unknown;
}

interface UndiciMessage {
  request: UndiciRequest;
  response?: { statusCode: number };
  error?: Error;
}

// span en vuelo de cada request; se suelta solo cuando la request se recolecta
const inflight = new WeakMap<UndiciRequest, Span>();
let installed = false;

const redactUrl = (origin: string, path: string): string => {
  const url = new URL(path, origin);
  [...url.searchParams.keys()]
    .filter((k) => SENSITIVE_PARAM.test(k))
    .forEach((k) => url.searchParams.set(k, REDACTED));
  return url.toString();
};

const onCreate = (msg: unknown): void => {
  const { request } = msg as UndiciMessage;
  if (!trace.getActiveSpan()) return;
  const { host, hostname } = new URL(request.origin);
  const span = tracer.startSpan(`${request.method} ${host}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'http.request.method': request.method,
      'server.address': hostname,
      'url.full': redactUrl(request.origin, request.path),
    },
  });
  inflight.set(request, span);
  const carrier: Record<string, string> = {};
  propagation.inject(trace.setSpan(context.active(), span), carrier);
  Object.entries(carrier).forEach(([k, v]) => request.addHeader?.(k, v));
};

const onHeaders = (msg: unknown): void => {
  const { request, response } = msg as UndiciMessage;
  const span = inflight.get(request);
  if (!span || !response) return;
  span.setAttribute('http.response.status_code', response.statusCode);
  if (response.statusCode >= CLIENT_ERROR_STATUS) span.setStatus({ code: SpanStatusCode.ERROR });
};

// el span se cierra al terminar de leerse el body (trailers) o al fallar la request
const onEnd = (msg: unknown): void => {
  const { request, error } = msg as UndiciMessage;
  const span = inflight.get(request);
  if (!span) return;
  inflight.delete(request);
  if (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }
  span.end();
};

/** suscribe los canales de undici. idempotente; lo llama initTelemetry. */
export function instrumentFetch(): void {
  if (installed) return;
  installed = true;
  subscribe(CHANNELS.create, onCreate);
  subscribe(CHANNELS.headers, onHeaders);
  subscribe(CHANNELS.trailers, onEnd);
  subscribe(CHANNELS.error, onEnd);
}
