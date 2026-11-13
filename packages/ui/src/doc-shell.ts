// contexto de las páginas secundarias (privacidad, soporte, guías, documentación). lo que es
// igual en todas las páginas de una app (nombre, contacto, idioma, marca, enlaces del pie) se
// fija UNA vez con setDocShell en el layout del grupo de rutas que las contiene; DocPage,
// PrivacyPolicy y Support lo leen de ahí y cada página solo aporta lo suyo (título, índice,
// secciones). los campos que pueden cambiar sin recargar (idioma sembrado desde el servidor,
// ruta actual) se pasan como getters para que sigan siendo reactivos.
import { getContext, setContext, type Snippet } from 'svelte';

export type DocLang = 'es' | 'en';

export interface DocLink {
  href: string;
  label: string;
}

// entrada del índice: el id es el ancla de la sección (estable entre idiomas)
export interface DocTocEntry {
  id: string;
  title: string;
}

// sección propia de una app dentro de una página compartida: su entrada del índice + cuerpo
export interface DocExtraSection extends DocTocEntry {
  body: Snippet;
}

// afterNavigate de $app/navigation, inyectado (como en trackNavigations de observability): ui no
// depende del router de sveltekit
export type DocAfterNavigate = (callback: (navigation: { from: unknown }) => void) => void;

export interface DocShell {
  appName: string;
  contactEmail: string;
  lang?: DocLang;
  // destino del enlace de la barra (default '/')
  home?: string;
  // ruta actual, para marcar su enlace en el pie (se ignora la barra final)
  path?: string;
  // marca de la barra; sin ella se pinta appName en texto
  brand?: Snippet;
  // lado derecho de la barra (p.ej. el selector de idioma)
  actions?: Snippet;
  // páginas secundarias de la app, en el pie; las http(s) abren en pestaña nueva
  links?: DocLink[];
  // con él, el enlace de la barra vuelve atrás en el historial si se llegó navegando dentro de la
  // app (ajustes, login, otra página secundaria); entrando directo (enlace de la store) va a home
  afterNavigate?: DocAfterNavigate;
}

const DOC_SHELL = Symbol('ui-doc-shell');

export function setDocShell(shell: DocShell): DocShell {
  return setContext(DOC_SHELL, shell);
}

export function getDocShell(): DocShell {
  const shell = getContext<DocShell | undefined>(DOC_SHELL);
  if (!shell) throw new Error('[ui] las páginas secundarias necesitan setDocShell() en un layout padre');
  return shell;
}
