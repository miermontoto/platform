// navegación principal nativa de las apps en ios: la pinta NativeTabBarPlugin
// (@platform/capacitor-native-tabs), un UITabBar de verdad con el liquid glass del sistema, que con
// css solo se podía imitar. la acción `nativeTabBar` va sobre la barra de navegación web de la app
// y la sustituye con su misma vida (solo existe con el shell montado), sus mismas pestañas y su
// misma activa. con el plugin presente marca html.native-tabbar: el css de la app oculta su barra
// web y deja que el contenido scrollee BAJO la nativa (el cristal refracta el contenido) con
// --native-tabbar-h de margen. en web, android y la app de ios en un mac (html.mac: escritorio
// con puntero) no hace nada: la barra web sigue como siempre.
//
// el nativo es tonto: cada cambio le llega como un `render` con el estado completo (pestañas,
// activa, visible, tema), deduplicado aquí. una vista nativa SIEMPRE queda sobre el webview, así
// que lo que la web pinte encima no puede taparla: la barra se oculta con un overlay en el dom
// (OVERLAY_SELECTOR: modales, menús y selects por su rol aria; lo que no es un diálogo, como un
// grafo a pantalla completa, lleva data-overlay), con el teclado abierto y fuera de html.compact
// (tablet apaisado: ahí navega el topbar de escritorio).
//
// iPhone Duo: donde el sistema lleva sus barras a una columna lateral (verticalBarEdge) el nativo
// pinta las pestañas como un RAIL vertical dentro de ella y lo cuenta en `layout` (`edge` +
// `width`). entonces la navegación es el rail también fuera de compact (el Duo abierto en apaisado
// tiene layout de escritorio: el rail sustituye a la nav del topbar, html.native-tabrail) y la web
// reserva lo que el rail sobresalga de la columna en --native-rail-left/right, que los tokens de
// safe area de @platform/ui/safe-area.css suman a --safe-left/right: todo lo que ya esquiva la
// columna del sistema esquiva el rail. la reserva no cambia al ocultarlo un overlay o el teclado,
// así nada salta de sitio.
//
// FOOTGUN capacitor: el proxy del plugin nunca sale de una función async (un proxy devuelto desde
// async lee `.then` y el puente responde "NativeTabBar.then() is not implemented").
import type { PluginListenerHandle } from '@capacitor/core';
import { COMPACT_CLASS, MAC_CLASS } from './compact';

/** pestaña de la barra nativa: id = ruta de la spa, symbol = nombre de sf symbol. */
export interface NativeTab {
  id: string;
  title: string;
  symbol: string;
}

export interface NativeTabBarParams {
  tabs: NativeTab[];
  // pestaña activa (null = la ruta actual no es de ninguna).
  selected: string | null;
  // toque en una pestaña, también al re-tocar la activa.
  onSelect: (id: string) => void;
  // clase de <html> con el teclado en pantalla abierto: con ella la barra se oculta.
  keyboardClass?: string;
  // media query del layout móvil de una app que no usa html.compact (installCompact): con ella
  // decide cuándo va la barra (fuera de él solo el rail del Duo). default: la clase compact.
  compactQuery?: string;
  // color de la pestaña activa (cualquier valor css que resuelva a un color); default el acento.
  tint?: string;
  // tema oscuro en curso; default: data-theme de <html> si lo hay, si no prefers-color-scheme.
  isDark?: (root: HTMLElement) => boolean;
}

// estado completo de cada render: contrato con NativeTabBarPlugin.swift.
interface NativeTabBarState {
  items: NativeTab[];
  selected: string | null;
  visible: boolean;
  showTitles: boolean;
  dark: boolean;
  tint: string | null;
}

// borde físico de la columna lateral del sistema, donde va el rail.
type RailEdge = 'left' | 'right';

// lo que tapa la navegación nativa, en `layout` y en la respuesta de cada render (tras una recarga
// el nativo no vuelve a avisar sin relayout). barra: alto desde el pie. rail: su borde y el ancho
// que tapa más allá de la safe area de ese borde (height 0). sin edge = modo barra.
interface NativeTabBarLayout {
  height: number;
  width: number;
  edge?: RailEdge;
}

interface NativeTabBarPlugin {
  render(state: NativeTabBarState): Promise<NativeTabBarLayout>;
  addListener(event: 'tabSelect', listener: (e: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'layout', listener: (e: NativeTabBarLayout) => void): Promise<PluginListenerHandle>;
}

const PLUGIN_NAME = 'NativeTabBar';
/** clase de <html> mientras la barra nativa sustituye a la web (el css de la app la oculta). */
export const NATIVE_TABBAR_CLASS = 'native-tabbar';
/** clase de <html> en modo rail (Duo): fuera la nav del topbar, el pie solo con su safe area. */
export const NATIVE_TABRAIL_CLASS = 'native-tabrail';
/** alto que tapa la barra desde el pie de la pantalla (lo mide el nativo). */
export const NATIVE_TABBAR_HEIGHT_VAR = '--native-tabbar-h';
const RAIL_EDGES: readonly RailEdge[] = ['left', 'right'];
// lo que el rail sobresale de la safe area en su lado (0 si cabe en la columna del sistema).
const railVar = (edge: RailEdge) => `--native-rail-${edge}`;
const DEFAULT_KEYBOARD_CLASS = 'keyboard-open';
const DEFAULT_TINT = 'var(--accent)';
const LIGHT_THEME = 'light';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-overlay]';
// atributos con los que un overlay aparece sin montarse (el grafo a pantalla completa).
const OVERLAY_ATTRIBUTES = ['role', 'aria-modal', 'data-overlay'];
// de <html>: compact y teclado (visibilidad), data-theme (estilo y tinte).
const ROOT_ATTRIBUTES = ['class', 'data-theme'];
// con más pestañas sus títulos no caben en la cápsula del iphone: solo iconos (el nativo deja el
// título para voiceover).
const TITLED_TABS_MAX = 5;

// memo: registrar dos veces avisa por consola, y la acción se remonta al volver a entrar.
let plugin: NativeTabBarPlugin | null = null;

const defaultIsDark = (root: HTMLElement) =>
  root.dataset.theme ? root.dataset.theme !== LIGHT_THEME : window.matchMedia(DARK_SCHEME_QUERY).matches;

// un overlay en el dom que además se pinta (un diálogo montado bajo display: none no cuenta).
function overlayOpen(): boolean {
  return Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some((el) => el.getClientRects().length > 0);
}

function logError(action: string): (err: unknown) => void {
  return (err) => console.error(`[native-tab-bar] ${action} falló: ${(err as Error).message}`);
}

/** acción `use:nativeTabBar` de la barra de navegación web: en la app de ios la sustituye por la nativa con liquid glass (rail lateral en el iPhone Duo); no-op en web, android y en un mac. */
export function nativeTabBar(_node: HTMLElement, params: NativeTabBarParams) {
  const root = document.documentElement;
  const darkScheme = window.matchMedia(DARK_SCHEME_QUERY);
  // la query del layout móvil se fija al montar: cambiarla en caliente no tiene sentido.
  const compactMedia = params.compactQuery ? window.matchMedia(params.compactQuery) : null;
  let current = params;
  let destroyed = false;
  let frame = 0;
  let lastJson = '';
  let lastSent: NativeTabBarState | null = null;
  // borde del rail según el último layout del nativo (null = barra inferior).
  let railEdge: RailEdge | null = null;
  let tint: { key: string; hex: string | null } | null = null;
  let resolveColor: ((value: string) => string | null) | null = null;
  const listeners: Promise<PluginListenerHandle>[] = [];
  const observer = new MutationObserver(() => schedule());

  function state(): NativeTabBarState {
    const dark = (current.isDark ?? defaultIsDark)(root);
    const tintValue = current.tint ?? DEFAULT_TINT;
    // el tinte se resuelve una vez por tema y valor (sonda en el dom), y solo con el resolver cargado.
    const key = `${root.dataset.theme ?? ''}|${dark}|${tintValue}`;
    if (resolveColor && tint?.key !== key) tint = { key, hex: resolveColor(tintValue) };
    const compact = compactMedia ? compactMedia.matches : root.classList.contains(COMPACT_CLASS);
    const keyboard = root.classList.contains(current.keyboardClass ?? DEFAULT_KEYBOARD_CLASS);
    return {
      items: current.tabs,
      selected: current.selected,
      visible: (compact || railEdge !== null) && !keyboard && !overlayOpen(),
      showTitles: current.tabs.length <= TITLED_TABS_MAX,
      dark,
      tint: tint?.hex ?? null,
    };
  }

  // tras el destroy (logout) las variables ya no se reescriben: la barra ya no tapa nada. un cambio
  // de modo (girar, abrir o plegar el Duo) re-evalúa la visibilidad: el rail también vale fuera de compact.
  function applyLayout({ height, width, edge }: NativeTabBarLayout): void {
    if (destroyed) return;
    const next = edge ?? null;
    root.style.setProperty(NATIVE_TABBAR_HEIGHT_VAR, `${height}px`);
    RAIL_EDGES.forEach((side) =>
      side === next ? root.style.setProperty(railVar(side), `${width}px`) : root.style.removeProperty(railVar(side)),
    );
    root.classList.toggle(NATIVE_TABRAIL_CLASS, next !== null);
    if (next === railEdge) return;
    railEdge = next;
    schedule();
  }

  function send(next: NativeTabBarState): void {
    const json = JSON.stringify(next);
    if (!plugin || json === lastJson) return;
    lastJson = json;
    lastSent = next;
    plugin.render(next).then(applyLayout).catch(logError('render'));
  }

  // una mutación del dom llega en ráfagas: se recalcula como mucho una vez por frame.
  function schedule(): void {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (!destroyed) send(state());
    });
  }

  void (async () => {
    const [{ Capacitor, registerPlugin }, { resolveCssColor }] = await Promise.all([
      import('@capacitor/core'),
      import('./system-bars'),
    ]);
    if (destroyed || !Capacitor.isPluginAvailable(PLUGIN_NAME) || root.classList.contains(MAC_CLASS)) return;
    plugin ??= registerPlugin<NativeTabBarPlugin>(PLUGIN_NAME);
    resolveColor = resolveCssColor;
    root.classList.add(NATIVE_TABBAR_CLASS);
    listeners.push(
      plugin.addListener('tabSelect', ({ id }) => current.onSelect(id)),
      plugin.addListener('layout', applyLayout),
    );
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: OVERLAY_ATTRIBUTES,
    });
    observer.observe(root, { attributes: true, attributeFilter: ROOT_ATTRIBUTES });
    darkScheme.addEventListener('change', schedule);
    compactMedia?.addEventListener('change', schedule);
    send(state());
  })().catch(logError('arranque'));

  return {
    update(next: NativeTabBarParams) {
      current = next;
      schedule();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      darkScheme.removeEventListener('change', schedule);
      compactMedia?.removeEventListener('change', schedule);
      listeners.forEach((handle) => void handle.then((h) => h.remove()).catch(logError('quitar listener')));
      root.classList.remove(NATIVE_TABBAR_CLASS, NATIVE_TABRAIL_CLASS);
      root.style.removeProperty(NATIVE_TABBAR_HEIGHT_VAR);
      RAIL_EDGES.forEach((side) => root.style.removeProperty(railVar(side)));
      // fuera del shell (logout, /welcome) la barra se esconde; la instancia siguiente la reaprovecha.
      // con el último estado enviado: en el teardown no se vuelve a leer el dom.
      if (lastSent) send({ ...lastSent, visible: false });
    },
  };
}
