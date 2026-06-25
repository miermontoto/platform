// tipos del changelog "novedades" compartido por las apps. las entradas son
// hand-curated (la fuente de verdad es un array en el código de cada app); el
// servicio las siembra en la tabla y resuelve el estado por usuario.

// categoría de un cambio: mapea a etiqueta/icono en el componente
export type ChangelogType = 'feature' | 'improvement' | 'fix' | 'breaking';

// un cambio individual, bilingüe (es/en) como el resto de contenido compartido
// (ver @platform/ui PrivacyPolicy): el cliente elige idioma al renderizar
export interface ChangelogChange {
  type: ChangelogType;
  es: string;
  en: string;
}

// entrada tal cual la escribe el dev. publishedAt como fecha ISO ('YYYY-MM-DD'
// o ISO completo); el servicio la normaliza a ms al sembrar
export interface ChangelogEntryInput {
  version: string;
  publishedAt: string;
  // título opcional de la versión (ej. 'Rediseño del panel')
  title?: string;
  changes: ChangelogChange[];
}

// entrada proyectada al cliente: publishedAt ya en ms para ordenar/comparar
export interface ChangelogEntry {
  version: string;
  publishedAt: number;
  title: string | null;
  changes: ChangelogChange[];
}

// estado completo para el usuario actual: entradas + cuántas no ha visto
export interface ChangelogState {
  entries: ChangelogEntry[];
  unseen: number;
  // ms de la entrada más reciente que el usuario marcó como vista; null si nunca
  lastSeenAt: number | null;
}
