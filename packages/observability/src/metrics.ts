// métricas otlp de las apis: duración de requests http y de queries sqlite (histogramas con nombres
// semconv) y gauges del runtime (memoria, heap, lag del event loop). salen cada
// METRIC_EXPORT_INTERVAL_MS a la página de métricas de openobserve y se consultan con promql
// (`histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_bucket[5m])))`).
//
// el api de métricas no tiene proxy como el de trazas: un meter pedido antes de registrar el
// provider es noop para siempre. por eso los instrumentos se exportan como bindings vivos (`let`)
// que initTelemetry sustituye por los reales; hasta entonces (y sin export, o en un worker thread)
// son noop y registrar no cuesta nada.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createNoopMeter, type Histogram, type Meter } from '@opentelemetry/api';

const NS_PER_S = 1e9;
// resolución del muestreo del lag del event loop
const EVENT_LOOP_RESOLUTION_MS = 20;
const EVENT_LOOP_PERCENTILE = 99;
// límites de bucket: los de semconv para http; más finos para sqlite, que es síncrono y casi
// siempre sub-milisegundo (una query de 100ms ya bloquea el proceso entero)
const HTTP_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];
const DB_BUCKETS_S = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1];

const noop = createNoopMeter();

/** duración de cada request http servida (s): method, route, status. lo registra http-telemetry. */
export let httpServerDuration: Histogram = noop.createHistogram('noop');
/** duración de cada sentencia sqlite (s): operación y tabla. lo registra @platform/db. */
export let dbOperationDuration: Histogram = noop.createHistogram('noop');

/** crea los instrumentos reales sobre el meter del provider registrado. lo llama initTelemetry. */
export function createInstruments(meter: Meter): void {
  httpServerDuration = meter.createHistogram('http.server.request.duration', {
    unit: 's',
    description: 'duración de las requests http servidas',
    advice: { explicitBucketBoundaries: HTTP_BUCKETS_S },
  });
  dbOperationDuration = meter.createHistogram('db.client.operation.duration', {
    unit: 's',
    description: 'duración de las sentencias sqlite',
    advice: { explicitBucketBoundaries: DB_BUCKETS_S },
  });

  // lag del event loop: el síntoma directo de una query síncrona o un cálculo que bloquea
  const loop = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  loop.enable();
  meter
    .createObservableGauge('nodejs.eventloop.delay.p99', { unit: 's', description: 'p99 del lag del event loop desde la última lectura' })
    .addCallback((result) => {
      result.observe(loop.percentile(EVENT_LOOP_PERCENTILE) / NS_PER_S);
      loop.reset();
    });
  meter
    .createObservableGauge('process.memory.usage', { unit: 'By', description: 'memoria residente (rss) del proceso' })
    .addCallback((result) => result.observe(process.memoryUsage.rss()));
  meter
    .createObservableGauge('v8js.memory.heap.used', { unit: 'By', description: 'heap de v8 en uso' })
    .addCallback((result) => result.observe(process.memoryUsage().heapUsed));
}
