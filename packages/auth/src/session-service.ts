// ciclo de vida de sesiones compartido por las apps de la plataforma. la identidad
// del usuario (role, spotifyId, lo que cada app necesite en su gate) se resuelve
// via `resolveUser`, así cada app conserva su propia tabla de users. soporta ids
// de user integer (sis, duckhunt) o text/uuid (carreterinas) y expiración sliding.
import crypto from 'crypto';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AnySessionTable, SessionTable } from './session-table.js';

export interface PlatformSession<TUser, TId extends string | number = number> {
  token: string;
  userId: TId;
  createdAt: number;
  expiresAt: number;
  user: TUser;
}

export interface SessionSummary {
  token: string;
  createdAt: number;
  expiresAt: number;
  userAgent: string | null;
}

export interface SessionServiceOptions<TUser, TId extends string | number, TSchema extends Record<string, unknown>> {
  getDb: () => BetterSQLite3Database<TSchema>;
  table: AnySessionTable;
  ttlMs: number;
  // expiración sliding: al validar con menos de la mitad del ttl restante,
  // la caducidad se desliza a now + ttl (estilo carreterinas). default: fija.
  sliding?: boolean;
  // proyección del user que viaja en la sesión validada. null = usuario
  // borrado → la sesión se considera inválida.
  resolveUser: (userId: TId) => TUser | null;
}

export interface SessionService<TUser, TId extends string | number = number> {
  createSession: (userId: TId, userAgent?: string) => PlatformSession<TUser, TId>;
  validateSession: (token: string) => PlatformSession<TUser, TId> | null;
  deleteSession: (token: string) => void;
  listSessions: (userId: TId) => SessionSummary[];
  deleteOtherSessions: (userId: TId, currentToken: string) => number;
  cleanupExpiredSessions: () => void;
}

const toMs = (v: Date | number): number => (v instanceof Date ? v.getTime() : Number(v));

export function createSessionService<
  TUser,
  TId extends string | number = number,
  TSchema extends Record<string, unknown> = Record<string, unknown>,
>(opts: SessionServiceOptions<TUser, TId, TSchema>): SessionService<TUser, TId> {
  const { getDb, ttlMs, sliding = false, resolveUser } = opts;
  // las queries tratan la tabla como la variante integer: las dos variantes son
  // estructuralmente idénticas salvo el tipo de user_id, y sqlite es dinámico.
  // el cast localiza aquí la única fricción del tipado union de drizzle.
  const table = opts.table as SessionTable;
  const asColId = (id: TId): number => id as never;

  return {
    createSession(userId, userAgent) {
      const user = resolveUser(userId);
      if (!user) throw new Error(`usuario ${userId} inexistente al crear sesión`);
      const token = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      const expiresAt = now + ttlMs;
      getDb()
        .insert(table)
        .values({
          token,
          userId: asColId(userId),
          createdAt: new Date(now),
          expiresAt: new Date(expiresAt),
          userAgent: userAgent ?? null,
        })
        .run();
      return { token, userId, createdAt: now, expiresAt, user };
    },

    // valida un token; borra la fila si expiró. null si no existe, expiró
    // o el usuario fue borrado. con sliding, desliza la caducidad si queda
    // menos de la mitad del ttl.
    validateSession(token) {
      if (!token) return null;
      const db = getDb();
      const row = db.select().from(table).where(eq(table.token, token)).get();
      if (!row) return null;
      let expiresAt = toMs(row.expiresAt);
      const now = Date.now();
      if (expiresAt < now) {
        db.delete(table).where(eq(table.token, token)).run();
        return null;
      }
      if (sliding && expiresAt - now < ttlMs / 2) {
        expiresAt = now + ttlMs;
        db.update(table).set({ expiresAt: new Date(expiresAt) }).where(eq(table.token, token)).run();
      }
      const userId = row.userId as TId;
      const user = resolveUser(userId);
      if (!user) return null;
      return { token: row.token, userId, createdAt: toMs(row.createdAt), expiresAt, user };
    },

    deleteSession(token) {
      getDb().delete(table).where(eq(table.token, token)).run();
    },

    // sesiones activas de un usuario. incluye el token raw solo para identificar
    // la sesión actual por comparación; no enviar tokens al cliente.
    listSessions(userId) {
      const now = Date.now();
      return getDb()
        .select()
        .from(table)
        .where(eq(table.userId, asColId(userId)))
        .orderBy(desc(table.createdAt))
        .all()
        .filter((r) => toMs(r.expiresAt) > now)
        .map((r) => ({
          token: r.token,
          createdAt: toMs(r.createdAt),
          expiresAt: toMs(r.expiresAt),
          userAgent: r.userAgent ?? null,
        }));
    },

    // borra las demás sesiones del usuario, preservando la actual. retorna nº eliminadas.
    deleteOtherSessions(userId, currentToken) {
      if (!currentToken) throw new Error('currentToken requerido para preservar la sesión actual');
      const result = getDb()
        .delete(table)
        .where(and(eq(table.userId, asColId(userId)), ne(table.token, currentToken)))
        .run();
      return result.changes;
    },

    cleanupExpiredSessions() {
      const result = getDb().delete(table).where(lt(table.expiresAt, new Date())).run();
      if (result.changes > 0) console.log(`[session] limpiadas ${result.changes} sesiones expiradas`);
    },
  };
}
