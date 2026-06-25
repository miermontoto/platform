// servicio del changelog: siembra las entradas hand-curated en la tabla y resuelve
// el estado por usuario (no vistas, marcar visto). la identidad del usuario la
// inyecta cada app via el id que ya resuelve su gate; soporta ids integer o
// text/uuid igual que @platform/auth.
import { count, desc, eq, gt, max, notInArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AnyChangelogSeenTable, ChangelogSeenTable, ChangelogTable } from './changelog-table.js';
import type { ChangelogEntry, ChangelogEntryInput, ChangelogState } from './changelog-types.js';

export interface ChangelogServiceOptions<TId extends string | number, TSchema extends Record<string, unknown>> {
  getDb: () => BetterSQLite3Database<TSchema>;
  entryTable: ChangelogTable;
  seenTable: AnyChangelogSeenTable;
  // entradas hand-curated, fuente de verdad. el array manda: seed() las sincroniza
  entries: ChangelogEntryInput[];
}

export interface ChangelogService<TId extends string | number = number> {
  // reconcilia la tabla con el array de entradas (upsert presentes, purga retiradas).
  // idempotente; llamar al arrancar, tras las migraciones
  seed: () => void;
  list: () => ChangelogEntry[];
  unseenCount: (userId: TId) => number;
  // marca como visto hasta `at` (ms); por defecto la entrada más reciente
  markSeen: (userId: TId, at?: number) => void;
  getState: (userId: TId) => ChangelogState;
}

const toMs = (v: Date | number): number => (v instanceof Date ? v.getTime() : Number(v));

// fecha ISO ('YYYY-MM-DD' o ISO completo) → ms; falla pronto ante un valor inválido
const parseDate = (input: string): number => {
  const ms = new Date(input).getTime();
  if (Number.isNaN(ms)) throw new Error(`fecha de changelog inválida: ${input}`);
  return ms;
};

export function createChangelogService<
  TId extends string | number = number,
  TSchema extends Record<string, unknown> = Record<string, unknown>,
>(opts: ChangelogServiceOptions<TId, TSchema>): ChangelogService<TId> {
  const { getDb, entryTable, entries } = opts;
  // las dos variantes de la tabla de "visto" son estructuralmente idénticas salvo
  // el tipo de user_id; el cast localiza aquí la única fricción del union de drizzle
  const seenTable = opts.seenTable as ChangelogSeenTable;
  const asColId = (id: TId): number => id as never;

  const toEntry = (row: typeof entryTable.$inferSelect): ChangelogEntry => ({
    version: row.version,
    publishedAt: toMs(row.publishedAt),
    title: row.title ?? null,
    changes: row.changes,
  });

  // ms del corte de lectura del usuario; 0 si nunca marcó (→ todo es no visto)
  const seenAtMs = (userId: TId): number => {
    const row = getDb().select().from(seenTable).where(eq(seenTable.userId, asColId(userId))).get();
    return row ? toMs(row.seenAt) : 0;
  };

  return {
    seed() {
      const db = getDb();
      const versions = entries.map((e) => e.version);
      // transacción: la reconciliación (upsert + purga) es atómica
      db.transaction((tx) => {
        for (const e of entries) {
          const publishedAt = new Date(parseDate(e.publishedAt));
          const values = { version: e.version, publishedAt, title: e.title ?? null, changes: e.changes };
          tx.insert(entryTable)
            .values(values)
            .onConflictDoUpdate({
              target: entryTable.version,
              set: { publishedAt, title: e.title ?? null, changes: e.changes },
            })
            .run();
        }
        // el array de código es la fuente de verdad: borra versiones ya retiradas
        if (versions.length) tx.delete(entryTable).where(notInArray(entryTable.version, versions)).run();
        else tx.delete(entryTable).run();
      });
    },

    list() {
      return getDb().select().from(entryTable).orderBy(desc(entryTable.publishedAt)).all().map(toEntry);
    },

    // cuenta sin cargar el json de changes: solo para el badge "hay novedades"
    unseenCount(userId) {
      const row = getDb()
        .select({ c: count() })
        .from(entryTable)
        .where(gt(entryTable.publishedAt, new Date(seenAtMs(userId))))
        .get();
      return row?.c ?? 0;
    },

    markSeen(userId, at) {
      // por defecto, el corte se mueve a la entrada más reciente publicada
      const newest = getDb().select({ m: max(entryTable.publishedAt) }).from(entryTable).get()?.m;
      const seenAt = new Date(at ?? (newest ? toMs(newest) : Date.now()));
      getDb()
        .insert(seenTable)
        .values({ userId: asColId(userId), seenAt })
        .onConflictDoUpdate({ target: seenTable.userId, set: { seenAt } })
        .run();
    },

    // estado completo para la ruta GET: reutiliza las entradas en memoria para
    // contar no vistas sin una query extra
    getState(userId) {
      const entriesOut = getDb().select().from(entryTable).orderBy(desc(entryTable.publishedAt)).all().map(toEntry);
      const lastSeen = seenAtMs(userId);
      const unseen = entriesOut.filter((e) => e.publishedAt > lastSeen).length;
      return { entries: entriesOut, unseen, lastSeenAt: lastSeen || null };
    },
  };
}
