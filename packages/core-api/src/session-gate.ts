// gate de sesión genérico: resuelve la cookie a una sesión y delega en `hydrate`
// la inyección de contexto específica de cada app (userId, role, workspace...).
import type { Context, Env, MiddlewareHandler, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { trace } from '@opentelemetry/api';

export interface SessionGateOptions<E extends Env, S> {
  cookieName: string;
  validate: (token: string) => S | null;
  // rutas exentas del gate (health, version, login...)
  isPreAuth?: (path: string) => boolean;
  // bypass total del gate (ej. bootstrap sin usuarios)
  bypass?: (c: Context<E>) => boolean;
  // inyección de contexto de la app y continuación de la cadena
  hydrate: (c: Context<E>, session: S, next: Next) => Promise<Response | void>;
}

export function sessionGate<E extends Env, S>(opts: SessionGateOptions<E, S>): MiddlewareHandler<E> {
  return async (c, next) => {
    if (opts.isPreAuth?.(c.req.path)) return next();
    if (opts.bypass?.(c)) return next();
    const token = getCookie(c, opts.cookieName);
    const session = token ? opts.validate(token) : null;
    if (!session) return c.json({ error: 'no autorizado' }, 401);
    // usuario en el span de la request (user.id) para filtrar trazas por usuario. las
    // sesiones de @platform/auth llevan userId; otra forma de sesión simplemente no lo pone.
    const userId = (session as { userId?: unknown }).userId;
    if (userId !== undefined) trace.getActiveSpan()?.setAttribute('user.id', String(userId));
    return opts.hydrate(c, session, next);
  };
}
