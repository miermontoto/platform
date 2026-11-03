// barrel de @platform/observability: trazas, logs y métricas (opentelemetry) de las apis, trabajos de
// fondo y operaciones mcp con su traza y su métrica, y el destino openobserve (proxy de rum, source
// maps). el sdk de navegador vive en ./browser (sin node)
export { initTelemetry, shutdownTelemetry, WEB_SERVICE_SUFFIX, type TelemetryOptions } from './telemetry.js';
export { createLogger, type Logger, type LogLevel, type LogAttrs } from './logger.js';
export { withSpan, currentTraceId, tracer, TRACER_NAME } from './tracing.js';
export { httpServerDuration, dbOperationDuration, defineCounter, defineUpDownCounter, defineHistogram, type Counter, type Histogram } from './metrics.js';
export { runJob, every, type JobContext, type JobOptions, type EveryOptions } from './jobs.js';
export { traceMcpOperation, type McpOperation } from './mcp.js';
export { openObserveTarget, rumToken, publishSourceMaps, type OpenObserveTarget, type SourceMapRelease } from './o2.js';
export { RUM_PROXY_PATH, RUM_LIMITS } from './wire.js';
