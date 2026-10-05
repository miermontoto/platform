// helpers de trazas para el código de las apps: spans manuales alrededor del trabajo que
// no nace de una request http (ticks de pollers, sweepers, jobs) y el trace id activo.
import { isSpanContextValid, SpanStatusCode, trace, type Span, type SpanOptions } from '@opentelemetry/api';

/** nombre del tracer de la plataforma (instrumentation scope en el backend). */
export const TRACER_NAME = '@platform/observability';

// proxy del api: delega en el provider real en cuanto initTelemetry lo registra
export const tracer = trace.getTracer(TRACER_NAME);

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
 * en trabajo de background usar `{ root: true }`: un timer hereda el contexto de quien
 * lo programó, y sin root el tick colgaría de la request (o del tick anterior) que lo agendó.
 */
export function withSpan<T>(name: string, fn: (span: Span) => T, options: SpanOptions = {}): T {
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
