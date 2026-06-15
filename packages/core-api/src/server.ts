// arranque del servidor http con shutdown graceful (SIGINT/SIGTERM)
import { serve, type ServerType } from '@hono/node-server';
import type { Env, Hono } from 'hono';

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
  // parar pollers/watchers ANTES de cerrar el servidor (requests en vuelo siguen vivas)
  onShutdown?: () => void | Promise<void>;
  // limpieza tras cerrar el servidor (cerrar db)
  afterClose?: () => void | Promise<void>;
}

export function startApiServer<E extends Env>(
  app: Hono<E>,
  { name, version, port, injectWebSocket, onShutdown, afterClose }: StartServerOptions,
) {
  const resolvedPort = port ?? parseInt(process.env.PORT || '3000');
  const server = serve({ fetch: app.fetch, port: resolvedPort }, (info) => {
    console.log(`[${name}${version ? ` ${version}` : ''}] escuchando en http://localhost:${info.port}`);
  });
  injectWebSocket?.(server);

  const shutdown = async () => {
    console.log(`\n[${name}] cerrando...`);
    await onShutdown?.();
    await new Promise<void>((res) => server.close(() => res()));
    await afterClose?.();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
