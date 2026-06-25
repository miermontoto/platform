// rutas del changelog "novedades": estado para el usuario actual + marcar visto.
// framework-light a propósito (como sessionGate): el id de usuario lo resuelve la
// app desde el contexto que inyecta su gate, y getState/markSeen vienen del
// ChangelogService de @platform/changelog. la app las monta bajo /api/changelog.
import { Hono } from 'hono';
import type { Context, Env } from 'hono';

// shape estructural del estado (evita acoplar core-api a @platform/changelog)
interface ChangelogStateLike {
  entries: unknown[];
  unseen: number;
  lastSeenAt: number | null;
}

export interface ChangelogRoutesOptions<E extends Env, TId extends string | number> {
  // resuelve el id de usuario del contexto (lo deja el gate de cada app en hydrate)
  userId: (c: Context<E>) => TId;
  getState: (userId: TId) => ChangelogStateLike;
  markSeen: (userId: TId, at?: number) => void;
}

export function changelogRoutes<E extends Env, TId extends string | number = number>(
  opts: ChangelogRoutesOptions<E, TId>,
): Hono<E> {
  const r = new Hono<E>();

  // estado completo + nº de no vistas para el usuario actual
  r.get('/', (c) => c.json(opts.getState(opts.userId(c))));

  // marca todo como visto (al cerrar el modal / abrir el panel de novedades)
  r.post('/seen', (c) => {
    opts.markSeen(opts.userId(c));
    return c.body(null, 204);
  });

  return r;
}
