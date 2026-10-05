// logger estructurado con niveles y scope, correlacionado con la traza activa. salida
// dual: stdout (por defecto `[scope] mensaje`, el formato de siempre para no romper los
// greps sobre los logs del contenedor, o una línea json por registro con LOG_FORMAT=json)
// y, con el export otlp activo, un log record otlp que hereda el trace_id/span_id del
// contexto. LOG_LEVEL filtra ambas salidas. info/debug van a stdout y warn/error a
// stderr, igual que console.*.
import { format } from 'node:util';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { logs, SeverityNumber, type AnyValueMap, type Logger as OtlpLogger } from '@opentelemetry/api-logs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

export type LogLevel = keyof typeof LEVELS;
type EmitLevel = Exclude<LogLevel, 'silent'>;

const SEVERITY: Record<EmitLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const DEFAULT_LEVEL: LogLevel = 'info';
const DEFAULT_SERVICE = 'app';
const LOG_FORMAT_JSON = 'json';
// scope de los console.* sin prefijo `[scope]` (librerías de terceros): en pretty se
// imprimen tal cual, sin etiqueta, como antes del bridge
const CONSOLE_SCOPE = 'console';
// prefijo `[scope] ` que las apps escriben a mano en sus console.*
const SCOPE_PREFIX = /^\[([^\]\s]+)\]\s*/;
// nombre del logger otlp (instrumentation scope en el backend)
const OTLP_LOGGER_NAME = '@platform/observability';

/** atributos estructurados de un registro: columnas consultables en el backend. */
export type LogAttrs = AnyValueMap;

export interface Logger {
  /** ruido de cada ciclo (polling, cache hits): oculto salvo LOG_LEVEL=debug */
  debug(...args: unknown[]): void;
  /** eventos que interesan en operación normal (arranque, totales de un job) */
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** sub-scope por entidad: createLogger('poll').child(userId) escribe `[poll:12]` */
  child(suffix: string | number): Logger;
}

interface LoggerConfig {
  service: string;
  threshold: number;
  json: boolean;
  // logger otlp solo si hay LoggerProvider exportando: sin él no se construye el record
  otlp: OtlpLogger | null;
}

// config perezosa desde el entorno: los imports esm se evalúan antes que loadAppEnv, así
// que no se lee al cargar el módulo. initTelemetry la rehace tras cargar el .env y los
// worker threads (que no inicializan telemetría) la resuelven en su primer log.
let config: LoggerConfig | null = null;

const resolveConfig = (service = config?.service ?? DEFAULT_SERVICE, otlp = config?.otlp ?? null): LoggerConfig => ({
  service,
  // un LOG_LEVEL inválido no debe dejar el proceso mudo: cae al nivel por defecto
  threshold: LEVELS[process.env.LOG_LEVEL?.toLowerCase() as LogLevel] ?? LEVELS[DEFAULT_LEVEL],
  json: process.env.LOG_FORMAT?.toLowerCase() === LOG_FORMAT_JSON,
  otlp,
});

/** fija el servicio y el export otlp, y relee LOG_LEVEL/LOG_FORMAT. lo llama initTelemetry. */
export function configureLogger({ service, exporting }: { service: string; exporting: boolean }): void {
  config = resolveConfig(service, exporting ? logs.getLogger(OTLP_LOGGER_NAME) : null);
}

const isPlainObject = (v: unknown): v is LogAttrs => {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// `k=v` legible; los strings con espacios van entre comillas para no partir el par
const formatAttr = ([k, v]: [string, unknown]): string =>
  ` ${k}=${typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v)}`;

function write(level: EmitLevel, scope: string, args: unknown[]): void {
  const cfg = (config ??= resolveConfig());
  if (LEVELS[level] < cfg.threshold) return;

  // atributos estructurados: el último argumento, si es un objeto plano tras el mensaje
  const attrs = args.length > 1 && isPlainObject(args.at(-1)) ? (args.at(-1) as LogAttrs) : undefined;
  const parts = attrs ? args.slice(0, -1) : args;
  const error = parts.find((a): a is Error => a instanceof Error);
  // mensaje sin stack (json/otlp lo llevan aparte en exception.*); el pretty lo conserva
  const msg = error ? format(...parts.map((a) => (a instanceof Error ? a.message : a))) : format(...parts);
  const spanContext = trace.getActiveSpan()?.spanContext();
  const traced = spanContext && isSpanContextValid(spanContext) ? spanContext : undefined;

  const line = cfg.json
    ? JSON.stringify({
        time: new Date().toISOString(),
        level,
        service: cfg.service,
        scope,
        msg,
        trace_id: traced?.traceId,
        span_id: traced?.spanId,
        ...attrs,
        ...(error && { error: { type: error.name, message: error.message, stack: error.stack } }),
      })
    : [
        scope === CONSOLE_SCOPE ? '' : `[${scope}] `,
        error ? format(...parts) : msg,
        ...Object.entries(attrs ?? {}).map(formatAttr),
        traced ? ` trace=${traced.traceId}` : '',
      ].join('');
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(`${line}\n`);

  // el record hereda trace_id/span_id del contexto activo (lo resuelve el sdk)
  cfg.otlp?.emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: msg,
    attributes: { scope, ...attrs },
    exception: error,
  });
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args) => write('debug', scope, args),
    info: (...args) => write('info', scope, args),
    warn: (...args) => write('warn', scope, args),
    error: (...args) => write('error', scope, args),
    child: (suffix) => createLogger(`${scope}:${suffix}`),
  };
}

/**
 * redirige console.* al logger: el `[scope]` que las apps ya escriben a mano pasa a ser
 * el scope del registro, y cada línea gana trace id y export otlp sin tocar las llamadas.
 */
export function installConsoleBridge(): void {
  const route =
    (level: EmitLevel) =>
    (...args: unknown[]): void => {
      const [first, ...rest] = args;
      const match = typeof first === 'string' ? SCOPE_PREFIX.exec(first) : null;
      if (!match) return write(level, CONSOLE_SCOPE, args);
      const tail = (first as string).slice(match[0].length);
      write(level, match[1], tail ? [tail, ...rest] : rest);
    };
  console.debug = route('debug');
  console.log = console.info = route('info');
  console.warn = route('warn');
  console.error = route('error');
}
