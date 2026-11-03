// captura de errores del cliente: excepciones sin capturar, promesas rechazadas sin handler,
// chunks o css que no cargan (típico tras un deploy) y los que la app pasa a mano (el
// handleError de sveltekit, que se queda los errores de load y navegación). salen como log
// de nivel error con el trace id de la navegación en curso, así `obs.sh errors` los lista
// junto a los del servidor.
import { clip, WIRE_LIMITS, type WireAttrs, type WireError } from '../wire.js';
import { activeSpan, currentRoute } from './spans.js';
import { enqueueEvent, now } from './transport.js';

// ruido que no es un fallo de la app: el aviso benigno de ResizeObserver y el error opaco de
// un script de otro origen (sin mensaje ni stack que aporten)
const IGNORED_MESSAGES = [/^ResizeObserver loop/, /^Script error\.?$/];
// frames de extensiones del navegador: su código corre en la página pero no es nuestro
const EXTENSION_FRAME = /(?:chrome|moz|safari(?:-web)?)-extension:\/\//;
// un error en bucle (un effect que lanza en cada tick) no debe inundar la cola: mismo error
// como mucho MAX_REPEATS veces por carga de página, y MAX_ERRORS en total
const MAX_REPEATS = 5;
const MAX_ERRORS = 100;
const SCOPE = 'client';
// elementos cuyo fallo de carga rompe la app (un chunk de un build ya retirado); las imágenes
// rotas (portadas, avatares) son ruido
const CRITICAL_RESOURCES = new Set(['SCRIPT', 'LINK']);

const seen = new Map<string, number>();
let total = 0;

const normalize = (error: unknown): WireError => {
  if (typeof error !== 'object' || error === null) return { type: typeof error, message: clip(String(error)) };
  // por forma y no con instanceof: un Error de otro realm (iframe, worker) no es instanceof
  // Error, y los rechazos de plugins nativos son objetos con message
  const { name, message, stack } = error as Partial<Error>;
  return {
    type: typeof name === 'string' ? name : (error.constructor?.name ?? 'Object'),
    message: clip(typeof message === 'string' ? message : String(error)),
    ...(typeof stack === 'string' && { stack: clip(stack, WIRE_LIMITS.stack) }),
  };
};

// huella: tipo + mensaje + primer frame (el mismo mensaje desde dos sitios son dos errores)
const fingerprint = ({ type, message, stack }: WireError): string =>
  `${type}:${message}:${stack?.split('\n').find((line) => line.includes(':')) ?? ''}`;

// encola un error ya normalizado, tras los filtros de ruido y los topes de repetición
const report = (wire: WireError, attrs: WireAttrs): void => {
  if (IGNORED_MESSAGES.some((re) => re.test(wire.message)) || EXTENSION_FRAME.test(wire.stack ?? '')) return;
  const key = fingerprint(wire);
  const repeats = (seen.get(key) ?? 0) + 1;
  seen.set(key, repeats);
  if (repeats > MAX_REPEATS || ++total > MAX_ERRORS) return;

  const parent = activeSpan();
  const route = currentRoute();
  enqueueEvent(
    {
      time: now(),
      level: 'error',
      scope: SCOPE,
      msg: wire.message,
      traceId: parent?.traceId,
      spanId: parent?.spanId,
      attrs: route ? { 'app.route': route, ...attrs } : attrs,
      error: wire,
    },
    true,
  );
};

/**
 * registra un error (Error o cualquier valor lanzado). `attrs` añade contexto consultable: las
 * claves propias de la app van bajo `app.*` (el servidor descarta las de otros espacios).
 */
export function captureError(error: unknown, attrs: WireAttrs = {}): void {
  report(normalize(error), attrs);
}

// fallo de carga de un recurso: no burbujea, solo se ve en fase de captura y sin ErrorEvent
const onResourceError = (target: EventTarget | null): void => {
  if (!(target instanceof HTMLElement) || !CRITICAL_RESOURCES.has(target.tagName)) return;
  const src = target instanceof HTMLScriptElement ? target.src : target instanceof HTMLLinkElement ? target.href : '';
  const path = src ? new URL(src, location.href).pathname : '';
  report({ type: 'ResourceError', message: `no carga ${target.tagName.toLowerCase()} ${path}` }, { 'error.resource': path });
};

export function installErrorHandlers(): void {
  addEventListener(
    'error',
    // Event y no ErrorEvent: en fase de captura llegan también los fallos de carga de recursos
    (event: Event) => {
      if (!(event instanceof ErrorEvent)) return onResourceError(event.target);
      captureError(event.error ?? event.message);
    },
    true,
  );
  addEventListener('unhandledrejection', (event) => captureError(event.reason, { 'error.unhandled_rejection': true }));
}
