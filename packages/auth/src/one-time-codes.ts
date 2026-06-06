// códigos de un solo uso para handoffs de auth (oauth móvil: el callback emite
// un código que viaja en el deep link y la app lo canjea por la cookie de sesión).
// in-memory a propósito: las apps de la plataforma son single-process y los
// códigos viven segundos; si una app escala a multi-proceso, persistir en db.
import crypto from 'crypto';

export interface OneTimeCodeStore<T> {
  /** emite un código aleatorio asociado al payload. caduca a los ttlMs. */
  issue: (payload: T) => string;
  /** canjea y CONSUME el código. null si no existe, ya se usó o caducó. */
  redeem: (code: string) => T | null;
}

export function createOneTimeCodeStore<T>({ ttlMs = 60_000 }: { ttlMs?: number } = {}): OneTimeCodeStore<T> {
  const codes = new Map<string, { payload: T; expiresAt: number }>();

  // limpieza perezosa: barre caducados en cada issue (volumen mínimo)
  const sweep = () => {
    const now = Date.now();
    for (const [code, entry] of codes) if (entry.expiresAt < now) codes.delete(code);
  };

  return {
    issue(payload) {
      sweep();
      const code = crypto.randomBytes(32).toString('base64url');
      codes.set(code, { payload, expiresAt: Date.now() + ttlMs });
      return code;
    },
    redeem(code) {
      const entry = codes.get(code);
      if (!entry) return null;
      codes.delete(code); // single use, también si caducó
      return entry.expiresAt < Date.now() ? null : entry.payload;
    },
  };
}
