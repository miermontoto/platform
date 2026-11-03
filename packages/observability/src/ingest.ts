// ingesta de la telemetría de cliente (lotes de @platform/observability/browser): valida cada
// elemento contra los topes del contrato, corrige la deriva de reloj del dispositivo, simboliza
// los stacks y lo entrega a los processors del export otlp de la api. sale con su propio
// resource (`<app>-web`, versión del bundle, plataforma), así la ui separa cliente de servidor
// y la cascada de una traza muestra los dos lados.
//
// el lote viene de un endpoint sin auth: todo es dato no confiable. ids y tiempos se validan,
// los strings se recortan y los atributos de identidad (user.id, session.id, client.address)
// los pone siempre el servidor, nunca el cliente.
import { SpanKind, SpanStatusCode, TraceFlags, type Attributes, type HrTime, type SpanContext } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableLogRecord, ReadWriteLogRecord } from '@opentelemetry/sdk-logs';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { symbolicate } from './sourcemaps.js';
import { clientSink } from './telemetry.js';
import { clip, WIRE_LIMITS, type WireAttrs, type WireEvent, type WireLevel, type WirePlatform, type WireSpan } from './wire.js';

/** contexto de la request que el cliente no puede falsear: lo resuelve la ruta de ingesta. */
export interface ClientContext {
  userAgent?: string;
  clientAddress?: string;
  userId?: string;
  // build de la spa con sus source maps (default: sin simbolizar)
  staticDir?: string;
}

/** sufijo del service.name de la telemetría de cliente (`sis` → `sis-web`). */
export const CLIENT_SERVICE_SUFFIX = '-web';

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
// w3c: el id todo ceros es inválido
const ZERO_ID = /^0+$/;
const SESSION_ID = /^[0-9a-f]{16}$/;
const ATTR_KEY = /^[\w.-]{1,64}$/;
const VERSION_MAX = 64;
const SCOPE_MAX = 64;
// relojes de dispositivo sincronizados por ntp difieren en ms; por debajo de esto no se corrige
// (la corrección mete el tiempo de tránsito del lote, peor que un desfase pequeño)
const CLOCK_SKEW_TOLERANCE_MS = 5_000;
// elementos más viejos que esto (pestaña restaurada de bfcache con cola antigua) se descartan
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MS_PER_S = 1_000;
const NS_PER_MS = 1_000_000;
const MAX_NANOS = 999_999_999;
const PLATFORMS = new Set<WirePlatform>(['web', 'ios', 'android']);
const SEVERITY: Record<WireLevel, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};
// atributos que solo pone el servidor: el cliente no puede suplantar a otro usuario
const RESERVED_ATTRS = new Set(['user.id', 'session.id', 'client.address', 'scope']);
// identidad estable del scope: el transformer otlp agrupa por referencia
const INSTRUMENTATION_SCOPE = { name: '@platform/observability/browser' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// los strings se recortan al usarlos (clip), no se rechazan: el body ya llega acotado
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v) && !ZERO_ID.test(v);

const toHr = (ms: number): HrTime => {
  const seconds = Math.floor(ms / MS_PER_S);
  return [seconds, Math.min(MAX_NANOS, Math.round((ms - seconds * MS_PER_S) * NS_PER_MS))];
};

const sanitizeAttrs = (input: unknown): Attributes =>
  isObject(input)
    ? Object.fromEntries(
        Object.entries(input)
          .filter(
            (entry): entry is [string, string | number | boolean] =>
              ATTR_KEY.test(entry[0]) && !RESERVED_ATTRS.has(entry[0]) && (typeof entry[1] === 'boolean' || isTime(entry[1]) || typeof entry[1] === 'string'),
          )
          .slice(0, WIRE_LIMITS.attrs)
          .map(([k, v]) => [k, typeof v === 'string' ? clip(v) : v]),
      )
    : {};

const sampled = (traceId: string, spanId: string): SpanContext => ({ traceId, spanId, traceFlags: TraceFlags.SAMPLED });

/**
 * mete un lote de cliente en el export. devuelve los elementos aceptados, o null si el lote no
 * tiene forma de lote o no hay export (la ruta responde 400/404 y el cliente deja de enviar).
 */
export async function ingestClientBatch(batch: unknown, ctx: ClientContext): Promise<number | null> {
  const sink = clientSink();
  if (!sink || !isObject(batch) || !isTime(batch.sentAt) || !Array.isArray(batch.spans) || !Array.isArray(batch.events)) return null;

  const received = Date.now();
  // mismo reloj en sentAt y en los tiempos del lote: el desplazamiento corrige ambos
  const skew = received - batch.sentAt;
  const offset = Math.abs(skew) > CLOCK_SKEW_TOLERANCE_MS ? skew : 0;
  const at = (ms: number): number => ms + offset;
  const inWindow = (ms: number): boolean => at(ms) >= received - MAX_AGE_MS && at(ms) <= received + CLOCK_SKEW_TOLERANCE_MS;

  const platform = PLATFORMS.has(batch.platform as WirePlatform) ? (batch.platform as WirePlatform) : 'web';
  const resource = resourceFromAttributes({
    'service.name': `${sink.service}${CLIENT_SERVICE_SUFFIX}`,
    ...(isString(batch.version) && { 'service.version': clip(batch.version, VERSION_MAX) }),
    'deployment.environment.name': sink.environment,
    'telemetry.sdk.language': 'webjs',
    'app.platform': platform,
    ...(ctx.userAgent && { 'user_agent.original': clip(ctx.userAgent) }),
  });
  // identidad de la request, igual en todos los elementos del lote (columnas en el backend)
  const identity: Attributes = {
    ...(isId(batch.session, SESSION_ID) && { 'session.id': batch.session }),
    ...(ctx.userId && { 'user.id': ctx.userId }),
    ...(ctx.clientAddress && { 'client.address': ctx.clientAddress }),
  };

  const toSpan = (input: unknown): ReadableSpan | null => {
    if (!isObject(input)) return null;
    const s = input as Partial<WireSpan>;
    if (!isId(s.traceId, TRACE_ID) || !isId(s.spanId, SPAN_ID) || !isString(s.name) || !isTime(s.start) || !isTime(s.end)) return null;
    if (!inWindow(s.start) || s.end < s.start) return null;
    const ctxSpan = sampled(s.traceId, s.spanId);
    return {
      name: clip(s.name),
      kind: s.kind === 'client' ? SpanKind.CLIENT : SpanKind.INTERNAL,
      spanContext: () => ctxSpan,
      parentSpanContext: isId(s.parentId, SPAN_ID) ? sampled(s.traceId, s.parentId) : undefined,
      startTime: toHr(at(s.start)),
      endTime: toHr(at(s.end)),
      duration: toHr(s.end - s.start),
      status: isString(s.error) ? { code: SpanStatusCode.ERROR, message: clip(s.error) } : { code: SpanStatusCode.UNSET },
      attributes: { ...sanitizeAttrs(s.attrs), ...identity },
      links: [],
      events: [],
      ended: true,
      resource,
      instrumentationScope: INSTRUMENTATION_SCOPE,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
  };

  const toLog = async (input: unknown): Promise<ReadableLogRecord | null> => {
    if (!isObject(input)) return null;
    const e = input as Partial<WireEvent>;
    if (!isTime(e.time) || !inWindow(e.time) || !isString(e.msg) || !(typeof e.level === 'string' && Object.hasOwn(SEVERITY, e.level))) return null;
    const error = isObject(e.error) && isString(e.error.message) ? e.error : undefined;
    const stack = error && isString(error.stack) ? await symbolicate(clip(error.stack, WIRE_LIMITS.stack), ctx.staticDir) : undefined;
    return {
      hrTime: toHr(at(e.time)),
      hrTimeObserved: toHr(received),
      spanContext: isId(e.traceId, TRACE_ID) && isId(e.spanId, SPAN_ID) ? sampled(e.traceId, e.spanId) : undefined,
      severityNumber: SEVERITY[e.level],
      severityText: e.level.toUpperCase(),
      body: clip(e.msg),
      resource,
      instrumentationScope: INSTRUMENTATION_SCOPE,
      attributes: {
        ...sanitizeAttrs(e.attrs),
        // mismas columnas que los logs del servidor (scope, exception.*): obs.sh los lee igual
        scope: isString(e.scope) ? clip(e.scope, SCOPE_MAX) : 'client',
        ...(error && {
          'exception.type': isString(error.type) ? clip(error.type) : 'Error',
          'exception.message': clip(error.message),
          ...(stack && { 'exception.stacktrace': stack }),
        }),
        ...identity,
      },
      droppedAttributesCount: 0,
    };
  };

  const spans = batch.spans.slice(0, WIRE_LIMITS.spans).map(toSpan).filter((s): s is ReadableSpan => s !== null);
  const records = (await Promise.all(batch.events.slice(0, WIRE_LIMITS.events).map(toLog))).filter(
    (r): r is ReadableLogRecord => r !== null,
  );
  spans.forEach((span) => sink.spans.onEnd(span));
  // el batch processor solo lee el record (lo bufferiza y lo exporta); el tipo de onEmit pide
  // los setters de un record del sdk que aquí nadie llama
  records.forEach((record) => sink.logs.onEmit(record as ReadWriteLogRecord));
  return spans.length + records.length;
}
