// redacción de secretos en paths y urls, compartida por la telemetría http (paths de requests) y
// el proxy de rum (urls de vistas, referrers y recursos que manda el navegador).

export const REDACTED = 'REDACTED';
// parámetros de query cuyo valor es un secreto (codes oauth, api keys de terceros, firmas). más
// amplio que el de parámetros de ruta de http-telemetry: en una query `key`/`auth` casi nunca son ids
const SENSITIVE_QUERY_PARAM = /token|secret|code|pass|sig|credential|session|key|auth/i;
// segmento largo con alfabeto de token: se trata como secreto aunque nada lo declare. 32 cubre los
// tokens de las apps (48 hex, 43 base64url) y deja pasar ids de spotify (22); los uuid son ids
const TOKEN_LIKE_SEGMENT = /^[\w\-.~%]{32,}$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿el segmento de path tiene pinta de token (y no de uuid)? */
export const tokenLike = (segment: string): boolean => TOKEN_LIKE_SEGMENT.test(segment) && !UUID_SEGMENT.test(segment);

/**
 * url apta para telemetría: segmentos con pinta de token y valores de query sensibles tapados, y
 * sin fragmento (puede llevar un access_token implícito). una url que no parsea no se guarda.
 */
export function redactUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname
      .split('/')
      .map((segment) => (tokenLike(segment) ? REDACTED : segment))
      .join('/');
    [...url.searchParams.keys()].filter((name) => SENSITIVE_QUERY_PARAM.test(name)).forEach((name) => url.searchParams.set(name, REDACTED));
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}
