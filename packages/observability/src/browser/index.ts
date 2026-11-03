// sdk de navegador de @platform/observability: rum nativo de openobserve (@openobserve/browser-rum-slim)
// para la web y las apps nativas (capacitor). vistas por ruta plantilla, llamadas a la api con
// traceparent (el rum enlaza cada una con su traza de servidor), errores, web vitals, long tasks y
// clics, en la sección RUM de la org de cada app. sin session replay (build slim).
//
// transporte: el sdk manda por `proxy` a la api de la propia app (RUM_PROXY_PATH), que reenvía a
// openobserve por la red interna con el token de su org y el user.id que resuelve de la sesión:
// mismo origen en la web, CapacitorHttp en la nativa, sin token ni openobserve expuestos.
//
// en una app sveltekit:
//   hooks.client.ts → initBrowserTelemetry({ service, version }) + handleError → captureError
//   +layout raíz    → trackNavigations({ beforeNavigate, afterNavigate })
import { RUM_PROXY_PATH } from '../wire.js';

type Rum = (typeof import('@openobserve/browser-rum-slim'))['openobserveRum'];

export interface BrowserTelemetryOptions {
  // servicio en openobserve (`<app>-web`)
  service: string;
  // versión del bundle (`version` de $app/environment, ver appVersion en @platform/config): la misma
  // con la que la api sube los source maps, así el rum simboliza los errores de ese build
  version?: string;
  env?: string;
  // origen de la api si no es el de la página: VITE_API_BASE en la app nativa, o una función si se
  // decide en runtime (instancia de sis). '' = mismo origen (default). se lee al arrancar
  apiOrigin?: string | (() => string);
}

// el proxy de la api pone el token real de la org: el bundle no lleva ninguno
const PROXY_CLIENT_TOKEN = 'proxy';
const DEFAULT_ENV = 'production';
// sondeo de deploys de kit (version.json) y chunks: ni alargan la carga de una vista ni van a la api
const KIT_ASSETS = /\/_app\//;
// ruta de sveltekit cuando ninguna casa (404 de cliente)
const UNMATCHED_ROUTE = '(unmatched)';
const PLATFORMS = new Set(['web', 'ios', 'android']);

// llamadas hechas antes de que cargue el sdk (import dinámico): se aplican al cargar
const pending: Array<(rum: Rum) => void> = [];
let rum: Rum | null = null;
let initialized = false;

const call = (fn: (rum: Rum) => void): void => {
  if (rum) fn(rum);
  else pending.push(fn);
};

// capacitor inyecta su global antes que la spa; sin importarlo para no atar el sdk a capacitor
const detectPlatform = (): string => {
  const platform = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return platform && PLATFORMS.has(platform) ? platform : 'web';
};

// origen normalizado (sin path ni barra final); '' o inválido = el de la página
const originOf = (value: string): string => {
  try {
    return value ? new URL(value).origin : location.origin;
  } catch {
    return location.origin;
  }
};

/** arranca el rum. llamar lo antes posible (hooks.client.ts); el sdk carga aparte. idempotente. */
export function initBrowserTelemetry({ service, version, env = DEFAULT_ENV, apiOrigin = '' }: BrowserTelemetryOptions): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const api = originOf(typeof apiOrigin === 'function' ? apiOrigin() : apiOrigin);
  const isApi = (url: string): boolean => {
    const { origin, pathname } = new URL(url, location.href);
    return (origin === location.origin || origin === api) && !KIT_ASSETS.test(pathname) && pathname !== RUM_PROXY_PATH;
  };

  import('@openobserve/browser-rum-slim')
    .then(({ openobserveRum }) => {
      openobserveRum.init({
        applicationId: service,
        clientToken: PROXY_CLIENT_TOKEN,
        proxy: `${api}${RUM_PROXY_PATH}`,
        service,
        env,
        version,
        sessionSampleRate: 100,
        sessionReplaySampleRate: 0,
        // vistas con la ruta plantilla de kit (`/albums/[id]`), no la url con ids: trackNavigations
        trackViewsManually: true,
        trackResources: true,
        trackLongTasks: true,
        trackUserInteractions: true,
        // el nombre de una acción sale del texto del elemento: enmascarado, como los inputs
        enablePrivacyForActionName: true,
        defaultPrivacyLevel: 'mask-user-input',
        allowedTracingUrls: [{ match: isApi, propagatorTypes: ['tracecontext'] }],
        traceSampleRate: 100,
        excludedActivityUrls: [KIT_ASSETS],
      });
      openobserveRum.setGlobalContextProperty('app.platform', detectPlatform());
      rum = openobserveRum;
      pending.splice(0).forEach((fn) => fn(openobserveRum));
    })
    .catch(() => undefined);
}

/** registra un error (Error o cualquier valor lanzado) con contexto opcional (handleError de kit). */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  call((r) => r.addError(error, context));
}

// forma mínima de la navegación de sveltekit ($app/navigation) que se consume: sin importar tipos
// de kit, que solo existen dentro de cada app
interface KitNavigation {
  type: string;
  willUnload: boolean;
  to: { route: { id: string | null } } | null;
}
type NavigationHook = (callback: (navigation: KitNavigation) => void) => void;

const routeOf = (navigation: KitNavigation): string => navigation.to?.route.id ?? UNMATCHED_ROUTE;

/**
 * una vista de rum por ruta plantilla. se llama en la inicialización del +layout raíz pasándole los
 * hooks de `$app/navigation` (deben registrarse durante la init de un componente):
 *
 *   trackNavigations({ beforeNavigate, afterNavigate });
 *
 * la vista empieza ANTES de los load de la navegación, para que sus fetch le pertenezcan; la
 * inicial, con el primer afterNavigate (la carga del documento la mide el sdk igualmente).
 */
export function trackNavigations({ beforeNavigate, afterNavigate }: { beforeNavigate: NavigationHook; afterNavigate: NavigationHook }): void {
  beforeNavigate((navigation) => {
    if (navigation.willUnload || !navigation.to) return;
    const name = routeOf(navigation);
    call((r) => r.startView({ name }));
  });
  afterNavigate((navigation) => {
    if (navigation.type !== 'enter') return;
    const name = routeOf(navigation);
    call((r) => r.startView({ name }));
  });
}
