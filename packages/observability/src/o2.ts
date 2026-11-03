// openobserve como destino, deducido del export otlp: base y org de OTEL_EXPORTER_OTLP_ENDPOINT
// (`http://172.17.0.1:5080/api/<org>`) y la auth de OTEL_EXPORTER_OTLP_HEADERS (la misma cuenta
// que exporta). lo usan el proxy de rum (destino y token de la org) y la publicación de los source
// maps de la spa, con los que el rum simboliza los errores del cliente.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { createLogger } from './logger.js';

export interface OpenObserveTarget {
  // origen http de openobserve, sin /api
  base: string;
  org: string;
  // cabecera Authorization de la cuenta que exporta (Basic ...)
  authorization?: string;
}

export interface SourceMapRelease {
  // servicio del rum (`<app>-web`) y versión del bundle: la pareja con la que el sdk etiqueta sus errores
  service: string;
  version: string;
  env: string;
  // build de la spa (static/ de la api)
  dir: string;
}

const ENDPOINT_RE = /^(https?:\/\/[^/]+)\/api\/([^/]+)\/?$/;
const AUTH_HEADER = 'authorization';
const SOURCE_MAP_EXT = '.map';
const ZIP_NAME = 'sourcemaps.zip';
const ZIP_TYPE = 'application/zip';
// una caída de openobserve no debe colgar el arranque ni una request de rum; la subida de maps
// (decenas de MB en las webs grandes) tiene su propio margen
const REQUEST_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 120_000;

const log = createLogger('openobserve');
let target: OpenObserveTarget | null | undefined;
let token: Promise<string> | null = null;

// OTEL_EXPORTER_OTLP_HEADERS: `k=v,k2=v2` con los valores url-encoded (spec otlp)
const headerFromEnv = (name: string): string | undefined => {
  const pair = (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',').find((p) => p.slice(0, p.indexOf('=')).trim().toLowerCase() === name);
  return pair && decodeURIComponent(pair.slice(pair.indexOf('=') + 1).trim());
};

/** destino openobserve del export otlp, o null sin export (memo: el entorno no cambia en caliente). */
export function openObserveTarget(): OpenObserveTarget | null {
  if (target !== undefined) return target;
  const endpoint = process.env.OTEL_SDK_DISABLED === 'true' ? undefined : process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const match = endpoint ? ENDPOINT_RE.exec(endpoint) : null;
  target = match ? { base: match[1], org: match[2], authorization: headerFromEnv(AUTH_HEADER) } : null;
  return target;
}

const o2 = (t: OpenObserveTarget, apiPath: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> =>
  fetch(`${t.base}/api/${t.org}${apiPath}`, {
    ...init,
    headers: { ...(t.authorization && { authorization: t.authorization }), ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });

/** token de rum de la org (el del usuario que exporta). se cachea; un fallo se reintenta en la siguiente. */
export function rumToken(t: OpenObserveTarget): Promise<string> {
  token ??= o2(t, '/rumtoken')
    .then((res) => (res.ok ? (res.json() as Promise<{ data?: { rum_token?: string } }>) : Promise.reject(new Error(`rumtoken ${res.status}`))))
    .then((body) => body.data?.rum_token ?? Promise.reject(new Error('rumtoken vacío')));
  return token.catch((err) => {
    token = null;
    throw err;
  });
}

/**
 * sube los source maps del build de la spa a openobserve, una vez por servicio + versión + entorno
 * (si ya están, no hace nada). no lanza: un fallo deja los errores sin simbolizar y un warn.
 */
export async function publishSourceMaps({ service, version, env, dir }: SourceMapRelease): Promise<void> {
  const t = openObserveTarget();
  if (!t) return;
  try {
    const query = new URLSearchParams({ service, version, env });
    const listed = await o2(t, `/sourcemaps?${query}`);
    const existing = listed.ok ? ((await listed.json()) as unknown[] | { data?: unknown[] }) : [];
    if ((Array.isArray(existing) ? existing : (existing.data ?? [])).length > 0) return;

    const files = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith(SOURCE_MAP_EXT));
    if (files.length === 0) return;
    // rutas relativas a la raíz servida (`_app/immutable/chunks/x.js.map`): las de los frames del navegador
    const entries = Object.fromEntries(
      await Promise.all(files.map(async (file) => [file.split(path.sep).join('/'), new Uint8Array(await readFile(path.join(dir, file)))] as const)),
    );
    const form = new FormData();
    form.set('service', service);
    form.set('version', version);
    form.set('env', env);
    form.set('file', new Blob([zipSync(entries)], { type: ZIP_TYPE }), ZIP_NAME);
    const res = await o2(t, '/sourcemaps', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    log.info(`source maps de ${service} ${version} publicados (${files.length})`);
  } catch (err) {
    log.warn(`no se pudieron publicar los source maps de ${service} ${version}:`, err);
  }
}
