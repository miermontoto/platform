// gestión de la clase html.compact: la señal compartida de "layout móvil" de los
// clientes web de la plataforma. compact = viewport estrecho (<= breakpoint) O app
// nativa (un tablet nativo es ancho pero queremos layout móvil igualmente).
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

export interface InstallCompactOptions {
  // ancho (px) bajo el cual el layout web pasa a compacto. default 720.
  breakpoint?: number;
}

/**
 * instala la gestión de html.compact: marca .native en plataforma nativa y mantiene
 * .compact = (<= breakpoint O .native), reaccionando a cambios de viewport. seguro
 * de llamar una vez en el boot del root layout; devuelve una función de limpieza.
 */
export function installCompact(options: InstallCompactOptions = {}): () => void {
  const breakpoint = options.breakpoint ?? COMPACT_BREAKPOINT_DEFAULT;
  const root = document.documentElement;
  // nativo: el webview puede ser ancho (tablet) y aun así queremos layout móvil.
  if (Capacitor.isNativePlatform()) root.classList.add('native');
  const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
  const apply = () => root.classList.toggle('compact', mq.matches || root.classList.contains('native'));
  apply();
  mq.addEventListener('change', apply);
  return () => mq.removeEventListener('change', apply);
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
