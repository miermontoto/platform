// métricas otlp: instrumentos de la plataforma (requests http, sentencias sqlite, trabajos de fondo,
// gauges del runtime) y una factoría para los de cada app (`defineCounter('agent.runs')`). salen cada
// METRIC_EXPORT_INTERVAL_MS a la página de métricas de openobserve y se consultan con promql
// (`histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_bucket[5m])))`).
//
// el api de métricas no tiene proxy como el de trazas: un meter pedido antes de registrar el
// provider es noop para siempre, y los módulos de las apps definen sus instrumentos al importarse,
// antes de initTelemetry. por eso cada instrumento es perezoso: se crea en el meter real la primera
// vez que se usa tras el init; hasta entonces (y sin export, o en un worker thread) no cuesta nada.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createNoopMeter, type Attributes, type Meter, type MetricOptions } from '@opentelemetry/api';

const NS_PER_S = 1e9;
// resolución del muestreo del lag del event loop
const EVENT_LOOP_RESOLUTION_MS = 20;
const EVENT_LOOP_PERCENTILE = 99;
// límites de bucket: los de semconv para http; más finos para sqlite, que es síncrono y casi
// siempre sub-milisegundo (una query de 100ms ya bloquea el proceso entero)
const HTTP_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];
const DB_BUCKETS_S = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1];

export interface Counter {
  add(value: number, attrs?: Attributes): void;
}
export interface Histogram {
  record(value: number, attrs?: Attributes): void;
}

const noop = createNoopMeter();
let meter: Meter | null = null;

// el instrumento real se crea una vez, al primer uso con meter; antes, el noop (que no se cachea)
const lazy = <I>(create: (m: Meter) => I, fallback: I): (() => I) => {
  let real: I | undefined;
  return () => real ?? (meter ? (real = create(meter)) : fallback);
};

/** contador monótono de la app (eventos: runs lanzados, llamadas). atributos de baja cardinalidad. */
export function defineCounter(name: string, options?: MetricOptions): Counter {
  const get = lazy((m) => m.createCounter(name, options), noop.createCounter(name));
  return { add: (value, attrs) => get().add(value, attrs) };
}

/** contador que sube y baja (conexiones abiertas, elementos en cola). */
export function defineUpDownCounter(name: string, options?: MetricOptions): Counter {
  const get = lazy((m) => m.createUpDownCounter(name, options), noop.createUpDownCounter(name));
  return { add: (value, attrs) => get().add(value, attrs) };
}

/** histograma (duraciones en segundos, tamaños); `advice.explicitBucketBoundaries` fija los buckets. */
export function defineHistogram(name: string, options?: MetricOptions): Histogram {
  const get = lazy((m) => m.createHistogram(name, options), noop.createHistogram(name));
  return { record: (value, attrs) => get().record(value, attrs) };
}

/** duración de cada request http servida (s): method, route, status. lo registra http-telemetry. */
export const httpServerDuration = defineHistogram('http.server.request.duration', {
  unit: 's',
  description: 'duración de las requests http servidas',
  advice: { explicitBucketBoundaries: HTTP_BUCKETS_S },
});

/** duración de cada sentencia sqlite (s): operación, tabla y fichero. lo registra @platform/db. */
export const dbOperationDuration = defineHistogram('db.client.operation.duration', {
  unit: 's',
  description: 'duración de las sentencias sqlite',
  advice: { explicitBucketBoundaries: DB_BUCKETS_S },
});

/** activa los instrumentos sobre el meter del provider registrado y los gauges del runtime. lo llama initTelemetry. */
export function createInstruments(real: Meter): void {
  meter = real;
  // lag del event loop: el síntoma directo de una query síncrona o un cálculo que bloquea
  const loop = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  loop.enable();
  real
    .createObservableGauge('nodejs.eventloop.delay.p99', { unit: 's', description: 'p99 del lag del event loop desde la última lectura' })
    .addCallback((result) => {
      result.observe(loop.percentile(EVENT_LOOP_PERCENTILE) / NS_PER_S);
      loop.reset();
    });
  real
    .createObservableGauge('process.memory.usage', { unit: 'By', description: 'memoria residente (rss) del proceso' })
    .addCallback((result) => result.observe(process.memoryUsage.rss()));
  real
    .createObservableGauge('v8js.memory.heap.used', { unit: 'By', description: 'heap de v8 en uso' })
    .addCallback((result) => result.observe(process.memoryUsage().heapUsed));
}
