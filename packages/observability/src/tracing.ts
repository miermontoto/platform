// helpers de trazas para el código de las apps: spans manuales alrededor del trabajo que
// no nace de una request http (ticks de pollers, sweepers, jobs) y el trace id activo.
import {
  INVALID_SPAN_CONTEXT,
  isSpanContextValid,
  SpanStatusCode,
  trace,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';

/** nombre del tracer de la plataforma (instrumentation scope en el backend). */
export const TRACER_NAME = '@platform/observability';

// proxy del api: delega en el provider real en cuanto initTelemetry lo registra
export const tracer = trace.getTracer(TRACER_NAME);

// span que no registra nada: el que recibe fn cuando no se abre span real
const NOOP_SPAN = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);

// cierra el span marcado como error (excepción + status) y relanza
const fail = (span: Span, err: unknown): never => {
  const message = err instanceof Error ? err.message : String(err);
  span.recordException(err instanceof Error ? err : message);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.end();
  throw err;
};

/**
 * ejecuta fn (sync o async) dentro de un span activo: las queries y fetches de dentro
 * cuelgan de él, y un throw/rechazo queda registrado en el span antes de relanzarse.
 * sin traza activa no abre nada (misma regla que queries y fetch: nada de trazas sueltas)
 * salvo con `{ root: true }`, que es lo que usa el trabajo de background para tener traza
 * propia. el root también corta la herencia: un timer hereda el contexto de quien lo
 * programó, y sin él el tick colgaría de la request (o del tick anterior) que lo agendó.
 */
export function withSpan<T>(name: string, fn: (span: Span) => T, options: SpanOptions = {}): T {
  if (!options.root && !trace.getActiveSpan()) return fn(NOOP_SPAN);
  return tracer.startActiveSpan(name, options, (span) => {
    try {
      const out = fn(span);
      if (!(out instanceof Promise)) {
        span.end();
        return out;
      }
      return out.then(
        (value) => {
          span.end();
          return value;
        },
        (err) => fail(span, err),
      ) as T;
    } catch (err) {
      return fail(span, err);
    }
  });
}

/** trace id (32 hex) del span activo; undefined fuera de una traza. */
export function currentTraceId(): string | undefined {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && isSpanContextValid(ctx) ? ctx.traceId : undefined;
}
