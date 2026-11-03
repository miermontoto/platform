// cola y envío de la telemetría de cliente a la api propia (CLIENT_TELEMETRY_PATH). los
// eventos y spans se agrupan en lotes y salen cada FLUSH_INTERVAL_MS, al llenarse o al ocultarse
// la página. un lote fallido se descarta: reintentar amplificaría la caída que lo provocó.
import { WIRE_LIMITS, type WireBatch, type WireEvent, type WirePlatform, type WireSpan } from '../wire.js';

// envío con actividad normal; un error adelanta el envío a URGENT_FLUSH_MS (agrupa ráfagas)
const FLUSH_INTERVAL_MS = 5_000;
const URGENT_FLUSH_MS = 1_000;
// respuestas con las que la api dice que no hay ingesta (sin export otlp, ruta sin montar o
// bloqueada): el sdk se apaga el resto de la sesión en vez de insistir
const DISABLED_STATUS = new Set([401, 403, 404, 405, 410]);
// text/plain es cors-safelisted: ni el webview ni un origen distinto disparan preflight
const CONTENT_TYPE = 'text/plain;charset=UTF-8';

export interface TransportConfig {
  endpoint: () => string;
  version?: string;
  platform: WirePlatform;
  // fetch original (sin instrumentar): el envío de un lote no debe generar su propio span
  fetch: typeof fetch;
}

/** id aleatorio de n bytes en hex (los ids w3c de traza y span). */
export const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * epoch ms de alta resolución. el sentAt del lote sale de este mismo reloj, así que la
 * corrección de deriva del servidor arregla también el desfase de performance.now(), que en
 * ios se detiene mientras el dispositivo duerme (una app nativa abierta días se iría horas).
 */
export const now = (): number => performance.timeOrigin + performance.now();

/** id de esta carga de página (session.id en el backend). */
export const session = randomHex(8);

const encoder = new TextEncoder();
let config: TransportConfig | null = null;
let disabled = false;
let spans: WireSpan[] = [];
let events: WireEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
// instante del envío programado: una petición más urgente lo adelanta, nunca lo atrasa
let due = Infinity;

const schedule = (ms: number): void => {
  const at = Date.now() + ms;
  if (at >= due) return;
  clearTimeout(timer);
  due = at;
  timer = setTimeout(() => flush(), ms);
};

// un lote que pasa del tope de bytes se parte por la mitad hasta caber (cada elemento ya va
// recortado en origen, así que uno solo siempre cabe)
const send = (cfg: TransportConfig, batchSpans: WireSpan[], batchEvents: WireEvent[], keepalive: boolean): void => {
  const batch: WireBatch = {
    version: cfg.version,
    platform: cfg.platform,
    session,
    sentAt: now(),
    spans: batchSpans,
    events: batchEvents,
  };
  const body = JSON.stringify(batch);
  if (encoder.encode(body).length > WIRE_LIMITS.bodyBytes && batchSpans.length + batchEvents.length > 1) {
    const s = batchSpans.length >> 1;
    const e = batchEvents.length >> 1;
    send(cfg, batchSpans.slice(0, s), batchEvents.slice(0, e), keepalive);
    send(cfg, batchSpans.slice(s), batchEvents.slice(e), keepalive);
    return;
  }
  cfg
    .fetch(cfg.endpoint(), { method: 'POST', body, keepalive, credentials: 'include', headers: { 'content-type': CONTENT_TYPE } })
    .then((res) => {
      if (DISABLED_STATUS.has(res.status)) disabled = true;
    })
    .catch(() => undefined);
};

/**
 * envía lo encolado. `keepalive` solo al ocultarse la página: deja que la petición sobreviva a
 * la descarga, pero su cuota de 64 KiB es compartida y dos lotes grandes en vuelo la agotarían.
 */
export function flush(keepalive = false): void {
  clearTimeout(timer);
  due = Infinity;
  if (!config || disabled || (!spans.length && !events.length)) return;
  const [batchSpans, batchEvents] = [spans, events];
  spans = [];
  events = [];
  send(config, batchSpans, batchEvents, keepalive);
}

export function configureTransport(cfg: TransportConfig): void {
  config = cfg;
  // hidden cubre cambiar de app en móvil y cerrar la pestaña; pagehide, la navegación fuera en
  // safari antiguo. en una app nativa es la última ocasión antes de que el sistema la suspenda
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
  addEventListener('pagehide', () => flush(true));
}

export function enqueueSpan(span: WireSpan): void {
  if (disabled) return;
  spans.push(span);
  if (spans.length >= WIRE_LIMITS.spans) flush();
  else schedule(FLUSH_INTERVAL_MS);
}

/** `urgent` (errores) adelanta el envío: un fallo debe verse ya, no al siguiente intervalo. */
export function enqueueEvent(event: WireEvent, urgent = false): void {
  if (disabled) return;
  events.push(event);
  if (events.length >= WIRE_LIMITS.events) flush();
  else schedule(urgent ? URGENT_FLUSH_MS : FLUSH_INTERVAL_MS);
}
