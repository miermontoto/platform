// sdk de navegador de @platform/observability: errores, web vitals y spans del cliente (carga,
// navegaciones, fetch a la api con traceparent) para la web y las apps nativas (capacitor).
// todo sale en lotes hacia la api de la propia app (CLIENT_TELEMETRY_PATH), que lo valida,
// lo simboliza y lo mete en su export otlp como servicio `<app>-web`: el cliente nunca ve el
// backend ni sus credenciales, y en la web es una petición al mismo origen.
//
// en una app sveltekit:
//   hooks.client.ts → initBrowserTelemetry({ version }) + handleError → captureError
//   +layout raíz    → trackNavigations({ beforeNavigate, afterNavigate })
import { CLIENT_TELEMETRY_PATH, type WirePlatform } from '../wire.js';
import { installErrorHandlers } from './errors.js';
import { instrumentFetch } from './fetch.js';
import { startPageload } from './spans.js';
import { configureTransport } from './transport.js';
import { observeVitals } from './vitals.js';

export { captureError } from './errors.js';
export { trackNavigations } from './spans.js';

export interface BrowserTelemetryOptions {
  // versión del bundle (`version` de $app/environment, ver appVersion en @platform/config)
  version?: string;
  // origen de la api si no es el de la página: VITE_API_BASE en la app nativa, o una función
  // si se decide en runtime (instancia de sis). '' = mismo origen (default)
  apiOrigin?: string | (() => string);
  // web vitals (default true)
  vitals?: boolean;
}

const PLATFORMS = new Set<WirePlatform>(['web', 'ios', 'android']);
let initialized = false;

// capacitor inyecta su global antes que la spa; sin importarlo para no atar el sdk a capacitor
const detectPlatform = (): WirePlatform => {
  const platform = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return PLATFORMS.has(platform as WirePlatform) ? (platform as WirePlatform) : 'web';
};

// origen normalizado (sin path ni barra final); '' o inválido = el de la página
const originOf = (value: string): string => {
  try {
    return value ? new URL(value).origin : location.origin;
  } catch {
    return location.origin;
  }
};

/** arranca la telemetría de cliente. llamar lo antes posible (hooks.client.ts). idempotente. */
export function initBrowserTelemetry({ version, apiOrigin = '', vitals = true }: BrowserTelemetryOptions = {}): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const api = typeof apiOrigin === 'function' ? apiOrigin : () => apiOrigin;

  const original = instrumentFetch((url) => url.origin === location.origin || url.origin === originOf(api()));
  configureTransport({ endpoint: () => `${originOf(api())}${CLIENT_TELEMETRY_PATH}`, version, platform: detectPlatform(), fetch: original });
  startPageload();
  installErrorHandlers();
  if (vitals) observeVitals();
}
