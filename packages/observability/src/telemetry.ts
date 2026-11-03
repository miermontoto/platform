// arranque de opentelemetry en las apis: tracer + logger providers, contexto async
// (AsyncLocalStorage) y propagación w3c. el export otlp solo se activa con
// OTEL_EXPORTER_OTLP_ENDPOINT (+ OTEL_EXPORTER_OTLP_HEADERS para la auth; ambos los leen
// los propios exporters). sin endpoint las trazas siguen existiendo en proceso —trace_id
// en los logs, x-trace-id en las respuestas— pero no salen de la máquina.
// OTEL_SDK_DISABLED=true lo apaga todo salvo el logger.
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider, type LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { AlwaysOnSampler, BatchSpanProcessor, NodeTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { instrumentFetch } from './fetch.js';
import { configureLogger, createLogger, installConsoleBridge } from './logger.js';

export interface TelemetryOptions {
  // service.name en el backend (nombre de la app)
  service: string;
  version?: string;
  // redirige console.* al logger estructurado (default true)
  bridgeConsole?: boolean;
}

// tope de longitud de un atributo (sql largos, urls): por encima se trunca
const ATTRIBUTE_MAX_LENGTH = 4096;
// espera máxima del flush al cerrar: un backend caído no debe bloquear el exit
const SHUTDOWN_TIMEOUT_MS = 3000;
const DEFAULT_ENVIRONMENT = 'development';

/**
 * destino de la telemetría de cliente (ingest.ts): los mismos processors del export de la api,
 * así sus spans y logs comparten lotes, reintentos y el flush del cierre. null sin export.
 */
export interface ClientSink {
  service: string;
  environment: string;
  spans: SpanProcessor;
  logs: LogRecordProcessor;
}

const log = createLogger('telemetry');
let providers: { tracer: NodeTracerProvider; logger?: LoggerProvider } | null = null;
let sink: ClientSink | null = null;

/** processors de export para la telemetría de cliente; null si no hay export otlp. */
export const clientSink = (): ClientSink | null => sink;

/** true si la api exporta y por tanto acepta telemetría de cliente. */
export const clientTelemetryEnabled = (): boolean => sink !== null;

/** inicializa trazas + logs. llamar justo después de loadAppEnv. idempotente. */
export function initTelemetry({ service, version, bridgeConsole = true }: TelemetryOptions): void {
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
  providers = { tracer: tracerProvider, logger: loggerProvider };
  if (spanProcessor && logProcessor) sink = { service, environment, spans: spanProcessor, logs: logProcessor };

  configureLogger({ service, exporting });
  instrumentFetch();
  log.info(exporting ? `export otlp → ${endpoint}` : 'export otlp desactivado (sin OTEL_EXPORTER_OTLP_ENDPOINT)');
}

/** vacía los buffers pendientes y cierra los exporters (como mucho SHUTDOWN_TIMEOUT_MS). */
export async function shutdownTelemetry(): Promise<void> {
  if (!providers) return;
  const { tracer, logger } = providers;
  providers = null;
  sink = null;
  await Promise.race([
    Promise.allSettled([tracer.shutdown(), logger?.shutdown()]),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref()),
  ]);
}
