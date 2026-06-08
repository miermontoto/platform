// hub de pub/sub sobre websockets, agnóstico del transporte: solo conoce la
// abstracción WsConnection (send + readyState), así que la capa de upgrade (cada
// app la trae, p.ej. @hono/node-ws) queda fuera. agrupa conexiones por clave
// (típicamente el userId) y publica un mensaje a TODAS las conexiones vivas de esa
// clave. entrega at-most-once: a una conexión que no está OPEN simplemente no se
// le envía (y el heartbeat la purga).
//
// heartbeat: cada heartbeatMs envía un frame de keep-alive {"type":"ping"} a cada
// conexión y descarta las que ya no están abiertas. el cliente lo usa para no
// reciclar el socket por inactividad (su watchdog espera ese ping).

// readyState OPEN del estándar WebSocket (0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED).
// literal para no acoplar core-api a ninguna implementación de ws.
const WS_OPEN = 1;

// frame de keep-alive: json con type 'ping' fuera del dominio de mensajes T. el
// cliente lo reconoce y lo ignora (solo refresca su watchdog).
const PING_FRAME = '{"type":"ping"}';

/** conexión ws mínima que el hub necesita. la app la adapta sobre su ws nativo. */
export interface WsConnection {
  // envía un frame de texto (el hub serializa los mensajes a json antes de llamar)
  send: (data: string) => void;
  // readyState del estándar WebSocket; el hub solo envía si es OPEN
  readonly readyState: number;
}

export interface WsHubOptions {
  // periodo del ping de keep-alive en ms (default 25s; debe ser menor que el
  // watchdog del cliente). pasar 0 o negativo desactiva el heartbeat.
  heartbeatMs?: number;
}

export interface WsHub<T> {
  /** registra una conexión bajo su clave. devuelve la baja (llamar en onClose). */
  add(key: string, conn: WsConnection): () => void;
  /** publica un mensaje a todas las conexiones OPEN de la clave. */
  publish(key: string, msg: T): void;
  /** detiene el heartbeat. llamar en el shutdown del servidor. */
  stop(): void;
}

export function createWsHub<T>({ heartbeatMs = 25_000 }: WsHubOptions = {}): WsHub<T> {
  // clave → conexiones vivas. un usuario puede tener varias (web + apk + pestañas).
  const conns = new Map<string, Set<WsConnection>>();

  // envía a una conexión solo si está OPEN; si tira al enviar, la trata como muerta
  // para que el caller la purgue. devuelve true si el envío fue válido.
  const trySend = (conn: WsConnection, data: string): boolean => {
    if (conn.readyState !== WS_OPEN) return false;
    try {
      conn.send(data);
      return true;
    } catch {
      return false;
    }
  };

  const add: WsHub<T>['add'] = (key, conn) => {
    let set = conns.get(key);
    if (!set) {
      set = new Set();
      conns.set(key, set);
    }
    set.add(conn);
    return () => {
      const s = conns.get(key);
      if (!s) return;
      s.delete(conn);
      if (s.size === 0) conns.delete(key);
    };
  };

  const publish: WsHub<T>['publish'] = (key, msg) => {
    const set = conns.get(key);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(msg);
    for (const conn of set) {
      // borrar de un Set durante su iteración es seguro en js
      if (!trySend(conn, data)) set.delete(conn);
    }
    if (set.size === 0) conns.delete(key);
  };

  // heartbeat: pinguea todo y purga lo que ya no está OPEN. unref para no mantener
  // vivo el proceso por sí solo (el shutdown llama stop() igualmente).
  let timer: ReturnType<typeof setInterval> | null = null;
  if (heartbeatMs > 0) {
    timer = setInterval(() => {
      for (const [key, set] of conns) {
        for (const conn of set) {
          if (!trySend(conn, PING_FRAME)) set.delete(conn);
        }
        if (set.size === 0) conns.delete(key);
      }
    }, heartbeatMs);
    timer.unref?.();
  }

  const stop: WsHub<T>['stop'] = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { add, publish, stop };
}
