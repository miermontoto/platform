// spans del cliente: la carga inicial (pageload) y cada navegación de la spa son la raíz de
// su traza, y los fetch a la api que ocurren mientras siguen abiertas cuelgan de ellas. como el
// fetch propaga traceparent, el span de servidor (y sus queries) quedan debajo en la misma
// traza: navegación → GET /api/x (cliente) → GET /api/x (servidor) → SELECT ...
//
// el navegador no tiene contexto async: el padre de un fetch es la navegación en curso, sin
// más. un poll que coincide con una navegación cuelga de ella; es el precio de no envolver
// cada promesa.
import { clip, type WireAttrs, type WireSpanKind } from '../wire.js';
import { enqueueSpan, now, randomHex } from './transport.js';

// una navegación que nunca acaba (cancelada por otro beforeNavigate, app sin trackNavigations)
// deja de adoptar fetch pasado este tiempo
const MAX_ACTIVE_MS = 30_000;
// nombre del span de la carga inicial hasta conocer su ruta
const PAGELOAD = 'pageload';
// ruta de sveltekit cuando ninguna casa (404 de cliente)
const UNMATCHED_ROUTE = '(unmatched)';

export interface ClientSpan {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  kind: WireSpanKind;
  start: number;
  attrs: WireAttrs;
}

interface StartOptions {
  kind?: WireSpanKind;
  // null = raíz de una traza nueva; por defecto, la navegación en curso
  parent?: ClientSpan | null;
  start?: number;
  attrs?: WireAttrs;
}

// navegación (o pageload) en curso: padre de los fetch que arrancan mientras está abierta
let active: ClientSpan | null = null;
// ruta plantilla actual (`/albums/[id]`, nunca la url real: sin ids ni tokens). la carga
// inicial fija además la de aterrizaje, a la que pertenecen las web vitals
let route: string | undefined;
let landingRoute: string | undefined;

export const currentRoute = (): string | undefined => route;
export const landing = (): string | undefined => landingRoute;

/** navegación en curso si sigue viva: los errores y fetch la toman como padre. */
export const activeSpan = (): ClientSpan | null => (active && now() - active.start < MAX_ACTIVE_MS ? active : null);

export function startSpan(name: string, { kind = 'internal', parent = activeSpan(), start = now(), attrs = {} }: StartOptions = {}): ClientSpan {
  return {
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    parentId: parent?.spanId,
    name: clip(name),
    kind,
    start,
    attrs: route ? { 'app.route': route, ...attrs } : attrs,
  };
}

export function endSpan(span: ClientSpan, { error, attrs }: { error?: string; attrs?: WireAttrs } = {}): void {
  enqueueSpan({ ...span, end: now(), error: error && clip(error), attrs: { ...span.attrs, ...attrs } });
}

/** header w3c del span (sampled siempre: la api registra todo, ver AlwaysOnSampler). */
export const traceparent = (span: ClientSpan): string => `00-${span.traceId}-${span.spanId}-01`;

// tiempos de la carga del documento relativos a su inicio (ms): red, html y arranque
const navigationTiming = (): WireAttrs => {
  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  if (!nav) return {};
  return {
    'navigation.type': nav.type,
    'navigation.ttfb_ms': Math.round(nav.responseStart),
    'navigation.dom_content_loaded_ms': Math.round(nav.domContentLoadedEventEnd),
    // 0 = el html salió de la caché del service worker o del bundle de la app nativa
    'navigation.transfer_size': nav.transferSize,
  };
};

/** abre el span de la carga inicial desde el inicio de la navegación del documento. */
export function startPageload(): void {
  active = startSpan(PAGELOAD, { parent: null, start: performance.timeOrigin });
}

// forma mínima de la navegación de sveltekit ($app/navigation) que se consume: sin importar
// tipos de kit, que solo existen dentro de cada app
interface KitNavigation {
  type: string;
  willUnload: boolean;
  to: { route: { id: string | null } } | null;
}
type NavigationHook = (callback: (navigation: KitNavigation) => void) => void;

const routeOf = (navigation: KitNavigation): string => navigation.to?.route.id ?? UNMATCHED_ROUTE;

/**
 * spans de pageload y navegación de la spa. se llama en la inicialización del +layout raíz
 * pasándole los hooks de `$app/navigation` (deben registrarse durante la init de un componente):
 *
 *   trackNavigations({ beforeNavigate, afterNavigate });
 *
 * el pageload acaba con el primer afterNavigate (app hidratada y primera ruta pintada); cada
 * navegación, de beforeNavigate (antes de sus load) a afterNavigate (ruta pintada).
 */
export function trackNavigations({ beforeNavigate, afterNavigate }: { beforeNavigate: NavigationHook; afterNavigate: NavigationHook }): void {
  beforeNavigate((navigation) => {
    // salir del sitio no es una navegación de la spa: la carga siguiente tendrá su pageload
    if (navigation.willUnload || !navigation.to) return;
    if (active) endSpan(active, { attrs: { 'navigation.interrupted': true } });
    // lo que falle durante la navegación (sus load, sus fetch) es de la ruta destino
    route = routeOf(navigation);
    active = startSpan(`navigate ${route}`, { parent: null, attrs: { 'navigation.type': navigation.type } });
  });
  afterNavigate((navigation) => {
    route = routeOf(navigation);
    if (!active) return;
    const pageload = active.name === PAGELOAD;
    if (pageload) {
      landingRoute = route;
      active.name = `${PAGELOAD} ${route}`;
    }
    endSpan(active, { attrs: { 'app.route': route, ...(pageload && navigationTiming()) } });
    active = null;
  });
}
