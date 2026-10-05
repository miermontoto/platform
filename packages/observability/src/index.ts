// barrel de @platform/observability: trazas + logs estructurados (opentelemetry) de las apis
export { initTelemetry, shutdownTelemetry, type TelemetryOptions } from './telemetry.js';
export { createLogger, type Logger, type LogLevel, type LogAttrs } from './logger.js';
export { withSpan, currentTraceId, tracer, TRACER_NAME } from './tracing.js';
