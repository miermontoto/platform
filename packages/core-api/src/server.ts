// arranque del servidor http con shutdown graceful (SIGINT/SIGTERM) y flush de telemetría.
//
// shutdown: onShutdown (pollers fuera, ws cerrados por el hub) → server.close() (deja de
// aceptar y cierra las keep-alive ociosas) → margen de SHUTDOWN_DRAIN_MS para las requests en
// vuelo → corte de lo que quede (streams sse de mcp, keep-alive que se quedaron ociosas tras el
// close) → afterClose, flush y exit. SHUTDOWN_TIMEOUT_MS es el tope duro: pasado, afterClose
// (cerrar la db), el flush y el exit corren igual. sin él un socket que no cierra (un upgrade
// que el corte no alcanza) colgaba el proceso hasta el SIGKILL de docker a los 10s, con ~10s
// de 502 por deploy y sin cerrar la db ni volcar la telemetría.
import { serve, type ServerType } from '@hono/node-server';
import type { Env, Hono } from 'hono';
import { createLogger, shutdownTelemetry } from '@platform/observability';

// margen para que las requests en vuelo terminen antes de cortar las conexiones que queden
const SHUTDOWN_DRAIN_MS = 1_000;
// tope del cierre del servidor; pasado, el shutdown sigue sin esperar a server.close()
const SHUTDOWN_TIMEOUT_MS = 3_000;

export interface StartServerOptions {
  // tag de logs (nombre de la app)
  name: string;
  version?: string;
  // default: env PORT o 3000
  port?: number;
  // engancha el upgrade de websocket al http.Server tras serve() (hono node-ws:
  // createNodeWebSocket().injectWebSocket). sin esto las rutas ws no reciben el
  // upgrade. no-op si la app no usa websockets.
  injectWebSocket?: (server: ServerType) => void;
  // parar pollers/watchers y cerrar los ws ANTES de cerrar el servidor (las requests en
  // vuelo siguen vivas hasta SHUTDOWN_DRAIN_MS)
  onShutdown?: () => void | Promise<void>;
  // limpieza tras cerrar el servidor (cerrar db)
  afterClose?: () => void | Promise<void>;
}

export function startApiServer<E extends Env>(
  app: Hono<E>,
  { name, version, port, injectWebSocket, onShutdown, afterClose }: StartServerOptions,
) {
  const log = createLogger(name);
  const resolvedPort = port ?? parseInt(process.env.PORT || '3000');
  const server = serve({ fetch: app.fetch, port: resolvedPort }, (info) => {
    log.info(`${version ? `${version} ` : ''}escuchando en http://localhost:${info.port}`);
  });
  injectWebSocket?.(server);

  const shutdown = async () => {
    log.info('cerrando...');
    await onShutdown?.();
    // node >= 19: close() también cierra las keep-alive ociosas; las activas siguen
    const closed = new Promise<boolean>((res) => server.close(() => res(true)));
    // closeAllConnections solo existe en http(s).Server; en http2 queda el tope duro
    const drain = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
    }, SHUTDOWN_DRAIN_MS);
    const timedOut = new Promise<boolean>((res) => setTimeout(() => res(false), SHUTDOWN_TIMEOUT_MS).unref());
    const clean = await Promise.race([closed, timedOut]);
    clearTimeout(drain);
    if (!clean) log.warn(`cierre forzado: conexiones abiertas tras ${SHUTDOWN_TIMEOUT_MS}ms`);
    await afterClose?.();
    // último paso: los logs del propio cierre también salen en el flush
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
