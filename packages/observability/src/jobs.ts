// trabajo de fondo de las apps (sweepers, pollers, timers, tareas de arranque): cada ejecución es la
// raíz de su traza (sus queries y fetch cuelgan de ella, sus logs llevan su trace id) y deja su
// duración y resultado en la métrica job.duration (job.name, job.outcome y las labels del trabajo).
//
// runJob ejecuta una vez. every programa un trabajo periódico sin solapes: el siguiente tick se
// programa al acabar el anterior. con `align` los ticks caen en múltiplos del intervalo en el reloj
// (cada minuto en punto) y job.nextIn(ms) cambia el retraso del siguiente (un reintento corto).
//
// un trabajo que captura sus propios errores (los barridos que nunca deben tumbar su timer) marca
// el fallo con job.fail(err): el span sale en error y la métrica lo cuenta aunque nada lance. lo
// que sí lanza se registra igual, se loguea y no se propaga.
import { SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api';
import { createLogger } from './logger.js';
import { defineHistogram } from './metrics.js';
import { withSpan } from './tracing.js';

const MS_PER_S = 1000;
// de un barrido de milisegundos a un poll de minutos
const JOB_BUCKETS_S = [0.001, 0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300];
const OUTCOME_OK = 'ok';
const OUTCOME_ERROR = 'error';

const jobDuration = defineHistogram('job.duration', {
  unit: 's',
  description: 'duración de cada ejecución de un trabajo de fondo, por nombre y resultado',
  advice: { explicitBucketBoundaries: JOB_BUCKETS_S },
});
const log = createLogger('job');

export interface JobContext {
  span: Span;
  /** marca la ejecución como fallida sin lanzar (el trabajo ya gestionó y logueó su error) */
  fail(err: unknown): void;
  /** retraso hasta el siguiente tick, solo para esta vez (every) */
  nextIn(ms: number): void;
}

export interface JobOptions {
  // baja cardinalidad: van al span y a la métrica (el provider de un poller)
  labels?: Record<string, string>;
  // solo al span: ids de conexión, workspace o usuario
  attrs?: Attributes;
}

export interface EveryOptions extends JobOptions {
  // primer tick al programar (default) o tras el primer intervalo
  runAtStart?: boolean;
  // ticks en múltiplos del intervalo en el reloj
  align?: boolean;
}

const execute = <T>(name: string, fn: (job: JobContext) => T | Promise<T>, { labels = {}, attrs = {} }: JobOptions) =>
  withSpan(
    name,
    async (span) => {
      span.setAttributes({ 'job.name': name, ...labels, ...attrs });
      let failed = false;
      let nextMs: number | undefined;
      const job: JobContext = {
        span,
        fail: (err) => {
          if (failed) return;
          failed = true;
          const message = err instanceof Error ? err.message : String(err);
          span.recordException(err instanceof Error ? err : message);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
        },
        nextIn: (ms) => {
          nextMs = ms;
        },
      };
      const start = performance.now();
      let result: T | undefined;
      try {
        result = await fn(job);
      } catch (err) {
        job.fail(err);
        log.error(`${name} falló:`, err);
      }
      jobDuration.record((performance.now() - start) / MS_PER_S, { 'job.name': name, 'job.outcome': failed ? OUTCOME_ERROR : OUTCOME_OK, ...labels });
      return { result, nextMs };
    },
    { root: true },
  );

/** ejecuta un trabajo de fondo una vez, como raíz de su traza. nunca lanza: devuelve undefined si falla. */
export async function runJob<T>(name: string, fn: (job: JobContext) => T | Promise<T>, options: JobOptions = {}): Promise<T | undefined> {
  return (await execute(name, fn, options)).result;
}

/**
 * programa un trabajo periódico (`every('sweep media-gc', 6 * HOUR_MS, sweepMedia)`). devuelve
 * la función que lo para. el timer no retiene el proceso (unref): lo mantiene vivo el servidor.
 */
export function every(name: string, intervalMs: number, fn: (job: JobContext) => unknown, { runAtStart = true, align = false, ...options }: EveryOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const wait = (ms: number): number => (align ? ms - (Date.now() % ms) : ms);
  const schedule = (ms: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), wait(ms));
    timer.unref?.();
  };
  const tick = async (): Promise<void> => {
    const { nextMs } = await execute(name, fn, options);
    schedule(nextMs ?? intervalMs);
  };
  if (runAtStart) void tick();
  else schedule(intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
