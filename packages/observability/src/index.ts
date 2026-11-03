// barrel de @platform/observability: trazas, logs y métricas (opentelemetry) de las apis y el destino
// openobserve (proxy de rum, source maps). el sdk de navegador vive en ./browser (sin node)
export { initTelemetry, shutdownTelemetry, WEB_SERVICE_SUFFIX, type TelemetryOptions } from './telemetry.js';
export { createLogger, type Logger, type LogLevel, type LogAttrs } from './logger.js';
export { withSpan, currentTraceId, tracer, TRACER_NAME } from './tracing.js';
export { httpServerDuration, dbOperationDuration } from './metrics.js';
export { openObserveTarget, rumToken, publishSourceMaps, type OpenObserveTarget, type SourceMapRelease } from './o2.js';
export { RUM_PROXY_PATH, RUM_LIMITS } from './wire.js';
