// gestión de la clase html.compact: la señal compartida de "layout móvil" de los
// clientes web de la plataforma. compact = viewport estrecho (<= breakpoint) O app
// nativa, salvo un tablet en horizontal (ahí hay espacio de escritorio de verdad y el
// layout móvil lo desperdicia: bottombar, una sola columna). un tablet nativo en
// vertical sigue compacto, igual que la señal de densidad.
//
// la NAVEGACIÓN (bottombar, topbar colapsado, drill-down de ajustes) keya de
// html.compact en css. la DENSIDAD de contenido es una señal aparte, por @media de
// ancho/orientación, y NO se gestiona aquí (ver convenciones del README).
//
// uso en el root +layout de la app:
//   import { installCompact } from '@platform/mobile/compact';
//   onMount(() => installCompact({ breakpoint: 720 }));  // devuelve cleanup
//
// para evitar FOUC en el primer paint (web estrecha pinta desktop antes de hidratar),
// añade además el snippet inline en el <head> de app.html — installCompact corre
// post-hidratación, así que el estado inicial lo fija el snippet. ver compactHeadSnippet.
import { Capacitor } from '@capacitor/core';

// ancho (px) por defecto bajo el cual el layout web pasa a compacto.
export const COMPACT_BREAKPOINT_DEFAULT = 720;

// tablet apaisado: el único caso nativo con layout de escritorio. el alto mínimo descarta
// al móvil en horizontal (ancho de hasta ~960px pero ~430px de alto); el ancho cubre desde
// el iPad de 10.2" (1080px) y la orientación deja al iPad Pro 13" vertical (1024px) en
// compacto. split view estrecha el viewport y vuelve a compacto sola.
export const TABLET_LANDSCAPE_QUERY = '(orientation: landscape) and (min-width: 1024px) and (min-height: 600px)';

export interface InstallCompactOptions {
  // ancho (px) bajo el cual el layout web pasa a compacto. default 720.
  breakpoint?: number;
}

/**
 * instala la gestión de html.compact: marca .native en plataforma nativa y mantiene
 * .compact = (<= breakpoint O nativo que no es tablet apaisado), reaccionando a cambios
 * de viewport y de orientación. seguro de llamar una vez en el boot del root layout;
 * devuelve una función de limpieza.
 */
export function installCompact(options: InstallCompactOptions = {}): () => void {
  const breakpoint = options.breakpoint ?? COMPACT_BREAKPOINT_DEFAULT;
  const root = document.documentElement;
  const native = Capacitor.isNativePlatform();
  if (native) root.classList.add('native');
  const narrow = window.matchMedia(`(max-width: ${breakpoint}px)`);
  const tabletLandscape = window.matchMedia(TABLET_LANDSCAPE_QUERY);
  const apply = () => root.classList.toggle('compact', narrow.matches || (native && !tabletLandscape.matches));
  const queries = [narrow, tabletLandscape];
  apply();
  queries.forEach((mq) => mq.addEventListener('change', apply));
  return () => queries.forEach((mq) => mq.removeEventListener('change', apply));
}

/**
 * snippet inline para el <head> de app.html: fija html.compact PRE-PAINT en web
 * estrecha (evita FOUC al cargar o estrechar). el resto (.native + listener) lo hace
 * installCompact tras hidratar. el breakpoint debe coincidir con el de installCompact.
 * uso: pegar `<script>${compactHeadSnippet(720)}</script>` en el <head> (app.html es
 * estático, no puede importar este módulo).
 */
export function compactHeadSnippet(breakpoint = COMPACT_BREAKPOINT_DEFAULT): string {
  return `(function(){var r=document.documentElement;r.classList.toggle('compact',window.matchMedia('(max-width:${breakpoint}px)').matches);})();`;
}
