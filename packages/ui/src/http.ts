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
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
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
