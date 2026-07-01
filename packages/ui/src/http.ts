// transporte http compartido por los clientes web de la plataforma: fetch nativo
// con json, credenciales de sesión y hook de 401 por app (throw, redirect a login...).
// los TIPOS de cada api NO viven aquí: cada app define los suyos junto a sus endpoints.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// error de red: el fetch ni siquiera obtuvo respuesta http (offline, dns caído, conexión
// perdida). extiende ApiError con status 0 para ser retrocompatible — los callers que ya
// filtran por `instanceof ApiError` lo siguen capturando (antes un fallo de red se colaba
// como TypeError sin envolver) — mientras que el modo offline puede afinar con
// `instanceof OfflineError`. clave: al NO pasar por la rama 401, un fallo de red nunca
// dispara on401 ni el redirect a /login (no es una sesión inválida, es falta de red).
export class OfflineError extends ApiError {
  constructor(detail?: string) {
    super(detail ? `sin conexión: ${detail}` : 'sin conexión', 0);
    this.name = 'OfflineError';
  }
}

export interface HttpOptions {
  // prefijo de url (default '' = urls absolutas del caller)
  base?: string;
  // se invoca ante un 401 ANTES de lanzar ApiError (ej. redirect a /login)
  on401?: () => void;
}

export interface Http {
  req: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  patch: <T>(path: string, body: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
}

export function createHttp({ base = '', on401 }: HttpOptions = {}): Http {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // fetch SOLO rechaza (sin llegar a una respuesta http) por fallo de red: offline,
      // dns, conexión caída. lo normalizamos a OfflineError para que el caller lo distinga
      // de un 401/4xx y NO dispare on401 ni el redirect a login. nota nativa: bajo
      // CapacitorHttp el fallo puede no ser el TypeError del browser, por eso capturamos
      // cualquier throw aquí en vez de comparar el tipo del error.
      throw new OfflineError(e instanceof Error ? e.message : String(e));
    }
    if (res.status === 401) {
      on401?.();
      throw new ApiError('no autorizado', 401);
    }
    if (!res.ok) throw new ApiError(await res.text(), res.status);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    req,
    get: <T>(path: string) => req<T>('GET', path),
    post: <T>(path: string, body?: unknown) => req<T>('POST', path, body),
    put: <T>(path: string, body: unknown) => req<T>('PUT', path, body),
    patch: <T>(path: string, body: unknown) => req<T>('PATCH', path, body),
    del: <T>(path: string) => req<T>('DELETE', path),
  };
}
