// barrel de @platform/observability: trazas + logs estructurados (opentelemetry) de las apis y
// la ingesta de la telemetría de cliente. el sdk de navegador vive en ./browser (sin node)
export { initTelemetry, shutdownTelemetry, clientTelemetryEnabled, type TelemetryOptions } from './telemetry.js';
export { createLogger, type Logger, type LogLevel, type LogAttrs } from './logger.js';
export { withSpan, currentTraceId, tracer, TRACER_NAME } from './tracing.js';
export { ingestClientBatch, CLIENT_SERVICE_SUFFIX, type ClientContext } from './ingest.js';
export { CLIENT_TELEMETRY_PATH, WIRE_LIMITS } from './wire.js';
