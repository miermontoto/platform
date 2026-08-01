// tipos del changelog "novedades" compartido por las apps. las entradas son
// hand-curated: cada app declara un array estático en su código y lo sirve tal
// cual (GET /api/changelog), sin tabla ni estado por usuario.

// categoría de un cambio: mapea a etiqueta/color en el componente
export type ChangelogType = 'feature' | 'improvement' | 'fix' | 'breaking';

// un cambio individual, bilingüe (es/en) como el resto de contenido compartido
// (ver @platform/ui PrivacyPolicy): el cliente elige idioma al renderizar
export interface ChangelogChange {
  type: ChangelogType;
  es: string;
  en: string;
}

// entrada de una versión. publishedAt como fecha ISO ('YYYY-MM-DD' o ISO
// completo); el cliente la formatea al renderizar
export interface ChangelogEntry {
  version: string;
  publishedAt: string;
  // título opcional de la versión (ej. 'Rediseño del panel')
  title?: string;
  changes: ChangelogChange[];
}
