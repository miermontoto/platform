// trazas de las llamadas a la api propia: se parchea el fetch global (no solo createHttp, que
// sis no usa) para abrir un span CLIENT y propagar `traceparent`, de modo que el span de
// servidor continúa la traza del cliente. solo a la api (mismo origen u origen configurado):
// a terceros no se añade el header, que dispararía preflight cors y filtraría ids de traza.
//
// en la app nativa CapacitorHttp ya ha parcheado fetch antes de que cargue la spa; este parche
// lo envuelve, así que la petición sigue saliendo por la capa nativa.
import { CLIENT_TELEMETRY_PATH, type WireAttrs } from '../wire.js';
import { endSpan, startSpan, traceparent } from './spans.js';

// a partir de este status la llamada es un fallo (los 4xx son respuestas de negocio: un 401
// por sesión caducada no es un error de la app, igual que en el span de servidor)
const SERVER_ERROR_STATUS = 500;
const TRACEPARENT = 'traceparent';
// segmento con pinta de id (numérico, hex/uuid, o alfanumérico largo con algún dígito, como
// los ids de spotify): se sustituye en el nombre del span para no disparar la cardinalidad.
// la ruta exacta la lleva el span de servidor hijo (http.route, url.path redactado)
const ID_SEGMENT = /^(?:\d+|[0-9a-f-]{8,}|(?=[^/]*\d)[\w-]{12,})$/i;
const ID_PLACEHOLDER = ':id';
// recursos internos de sveltekit en el mismo origen (version.json del sondeo de deploys,
// chunks): no son llamadas a la api y el sondeo de cada pestaña llenaría la traza de ruido
const KIT_ASSETS_PREFIX = '/_app/';

const requestUrl = (input: RequestInfo | URL): URL | null => {
  try {
    return new URL(input instanceof Request ? input.url : String(input), location.href);
  } catch {
    return null;
  }
};

const templatePath = (pathname: string): string =>
  pathname
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ID_PLACEHOLDER : segment))
    .join('/');

/** parchea globalThis.fetch y devuelve el original, que usa el transporte para sus envíos. */
export function instrumentFetch(isApi: (url: URL) => boolean): typeof fetch {
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (input, init) => {
    const url = requestUrl(input);
    if (!url || url.pathname === CLIENT_TELEMETRY_PATH || url.pathname.startsWith(KIT_ASSETS_PREFIX) || !isApi(url)) {
      return original(input, init);
    }

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = templatePath(url.pathname);
    const span = startSpan(`${method} ${path}`, {
      kind: 'client',
      attrs: { 'http.request.method': method, 'server.address': url.hostname, 'url.template': path },
    });
    // los headers de init sustituyen a los de la Request (semántica de fetch): se parte de ellos
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(TRACEPARENT, traceparent(span));

    return original(input, { ...init, headers }).then(
      (res) => {
        const attrs: WireAttrs = { 'http.response.status_code': res.status };
        endSpan(span, { attrs, error: res.status >= SERVER_ERROR_STATUS ? `HTTP ${res.status}` : undefined });
        return res;
      },
      (err: unknown) => {
        // abortar (un AbortController) es voluntario: no es un fallo. ojo: firefox cancela las
        // peticiones en vuelo al recargar o salir con un TypeError de red, indistinguible de un
        // fallo real de red; por eso el mensaje lleva el prefijo `network:` y los paneles separan
        // esos ("sin respuesta") de los 5xx
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        const reason = err instanceof Error ? err.message : String(err);
        endSpan(span, aborted ? { attrs: { 'http.aborted': true } } : { error: `network: ${reason}` });
        throw err;
      },
    );
  };

  return original;
}
