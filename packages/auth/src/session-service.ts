// ciclo de vida de sesiones compartido por las apps de la plataforma. la identidad
// del usuario (role, spotifyId, lo que cada app necesite en su gate) se resuelve
// via `resolveUser`, así cada app conserva su propia tabla de users.
import crypto from 'crypto';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SessionTable } from './session-table.js';

export interface PlatformSession<TUser> {
  token: string;
  userId: number;
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

export interface SessionServiceOptions<TUser, TSchema extends Record<string, unknown>> {
  getDb: () => BetterSQLite3Database<TSchema>;
  table: SessionTable;
  ttlMs: number;
  // proyección del user que viaja en la sesión validada. null = usuario
  // borrado → la sesión se considera inválida.
  resolveUser: (userId: number) => TUser | null;
}

export interface SessionService<TUser> {
  createSession: (userId: number, userAgent?: string) => PlatformSession<TUser>;
  validateSession: (token: string) => PlatformSession<TUser> | null;
  deleteSession: (token: string) => void;
  listSessions: (userId: number) => SessionSummary[];
  deleteOtherSessions: (userId: number, currentToken: string) => number;
  cleanupExpiredSessions: () => void;
}

const toMs = (v: Date | number): number => (v instanceof Date ? v.getTime() : Number(v));

export function createSessionService<TUser, TSchema extends Record<string, unknown> = Record<string, unknown>>(
  opts: SessionServiceOptions<TUser, TSchema>,
): SessionService<TUser> {
  const { getDb, table, ttlMs, resolveUser } = opts;

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
          userId,
          createdAt: new Date(now),
          expiresAt: new Date(expiresAt),
          userAgent: userAgent ?? null,
        })
        .run();
      return { token, userId, createdAt: now, expiresAt, user };
    },

    // valida un token; borra la fila si expiró. null si no existe, expiró
    // o el usuario fue borrado.
    validateSession(token) {
      if (!token) return null;
      const db = getDb();
      const row = db.select().from(table).where(eq(table.token, token)).get();
      if (!row) return null;
      const expiresAt = toMs(row.expiresAt);
      if (expiresAt < Date.now()) {
        db.delete(table).where(eq(table.token, token)).run();
        return null;
      }
      const user = resolveUser(row.userId);
      if (!user) return null;
      return { token: row.token, userId: row.userId, createdAt: toMs(row.createdAt), expiresAt, user };
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
        .where(eq(table.userId, userId))
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
        .where(and(eq(table.userId, userId), ne(table.token, currentToken)))
        .run();
      return result.changes;
    },

    cleanupExpiredSessions() {
      const result = getDb().delete(table).where(lt(table.expiresAt, new Date())).run();
      if (result.changes > 0) console.log(`[session] limpiadas ${result.changes} sesiones expiradas`);
    },
  };
}
