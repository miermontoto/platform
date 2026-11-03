// arranque de opentelemetry en las apis: tracer, logger y meter providers, contexto async
// (AsyncLocalStorage) y propagación w3c. el export otlp solo se activa con
// OTEL_EXPORTER_OTLP_ENDPOINT (+ OTEL_EXPORTER_OTLP_HEADERS para la auth; ambos los leen
// los propios exporters). sin endpoint las trazas siguen existiendo en proceso —trace_id
// en los logs, x-trace-id en las respuestas— pero no salen de la máquina.
// OTEL_SDK_DISABLED=true lo apaga todo salvo el logger.
import path from 'node:path';
import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { AlwaysOnSampler, BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { instrumentFetch } from './fetch.js';
import { configureLogger, createLogger, installConsoleBridge } from './logger.js';
import { createInstruments } from './metrics.js';
import { publishSourceMaps } from './o2.js';
import { TRACER_NAME } from './tracing.js';

export interface TelemetryOptions {
  // service.name en el backend (nombre de la app; el rum de su web va como `<service>-web`)
  service: string;
  version?: string;
  // build de la spa cuyos source maps se publican para el rum (default ./static, el de mountSpa)
  staticDir?: string;
  // redirige console.* al logger estructurado (default true)
  bridgeConsole?: boolean;
}

// tope de longitud de un atributo (sql largos, urls): por encima se trunca
const ATTRIBUTE_MAX_LENGTH = 4096;
// espera máxima del flush al cerrar: un backend caído no debe bloquear el exit
const SHUTDOWN_TIMEOUT_MS = 3000;
const DEFAULT_ENVIRONMENT = 'development';
const DEFAULT_STATIC_DIR = 'static';
/** sufijo del servicio del rum de la web de una app (`sis` → `sis-web`). */
export const WEB_SERVICE_SUFFIX = '-web';
// cada cuánto salen las métricas: la resolución de los rate()/histogram_quantile de promql
const METRIC_EXPORT_INTERVAL_MS = 30_000;

const log = createLogger('telemetry');
let providers: { tracer: NodeTracerProvider; logger?: LoggerProvider; meter?: MeterProvider } | null = null;

/** inicializa trazas + logs. llamar justo después de loadAppEnv. idempotente. */
export function initTelemetry({ service, version, staticDir = path.resolve(process.cwd(), DEFAULT_STATIC_DIR), bridgeConsole = true }: TelemetryOptions): void {
  if (providers) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const disabled = process.env.OTEL_SDK_DISABLED === 'true';
  const exporting = Boolean(endpoint) && !disabled;

  if (bridgeConsole) installConsoleBridge();
  if (disabled) {
    configureLogger({ service, exporting });
    log.info('sdk desactivado (OTEL_SDK_DISABLED)');
    return;
  }

  const environment = process.env.NODE_ENV ?? DEFAULT_ENVIRONMENT;
  const resource = resourceFromAttributes({
    'service.name': service,
    ...(version && { 'service.version': version }),
    'deployment.environment.name': environment,
  });
  const spanProcessor = exporting ? new BatchSpanProcessor(new OTLPTraceExporter()) : undefined;
  const logProcessor = exporting ? new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }) : undefined;
  const tracerProvider = new NodeTracerProvider({
    resource,
    // siempre muestrea, ignorando el flag `sampled` del traceparent entrante: con el
    // ParentBased por defecto cualquier cliente podría sacar sus requests de las trazas
    // mandando `traceparent: ...-00`. el volumen de estas apps no necesita muestreo.
    sampler: new AlwaysOnSampler(),
    spanLimits: { attributeValueLengthLimit: ATTRIBUTE_MAX_LENGTH },
    spanProcessors: spanProcessor ? [spanProcessor] : [],
  });
  tracerProvider.register();
  const loggerProvider = logProcessor ? new LoggerProvider({ resource, processors: [logProcessor] }) : undefined;
  if (loggerProvider) logs.setGlobalLoggerProvider(loggerProvider);
  const meterProvider = exporting
    ? new MeterProvider({
        resource,
        readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS })],
      })
    : undefined;
  if (meterProvider) {
    metrics.setGlobalMeterProvider(meterProvider);
    createInstruments(meterProvider.getMeter(TRACER_NAME));
  }
  providers = { tracer: tracerProvider, logger: loggerProvider, meter: meterProvider };

  configureLogger({ service, exporting });
  instrumentFetch();
  log.info(exporting ? `export otlp → ${endpoint}` : 'export otlp desactivado (sin OTEL_EXPORTER_OTLP_ENDPOINT)');
  // la web sirve el mismo build (misma versión): sus errores de rum se simbolizan con estos maps
  if (exporting && version) void publishSourceMaps({ service: `${service}${WEB_SERVICE_SUFFIX}`, version, env: environment, dir: staticDir });
}

/** vacía los buffers pendientes y cierra los exporters (como mucho SHUTDOWN_TIMEOUT_MS). */
export async function shutdownTelemetry(): Promise<void> {
  if (!providers) return;
  const { tracer, logger, meter } = providers;
  providers = null;
  await Promise.race([
    Promise.allSettled([tracer.shutdown(), logger?.shutdown(), meter?.shutdown()]),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref()),
  ]);
}
