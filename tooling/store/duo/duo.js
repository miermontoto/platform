// cromo del iPhone Duo para las réplicas de tienda de las apps (window.StoreDuo; render.mjs lo sirve
// en /platform/duo/ con duo.css): la columna lateral del sistema (cámara, hora, batería), el rail de
// pestañas de @platform/capacitor-native-tabs dentro de ella, y la geometría de los dos marcos del
// slot iphone-duo (la interior abierta en apaisado, la exterior cerrada). cada app pone sus
// pantallas: el layout de dentro (topbar, main, la columna que esquiva) es suyo.
// uso en su index.html, antes de screens.js:
//   <link rel="stylesheet" href="platform/duo/duo.css"><script src="platform/duo/duo.js"></script>
(() => {
  'use strict';

  // réplicas de sf symbols por su nombre real (el mismo `symbol` que la app pasa a la barra
  // nativa): contorno, y relleno en la pestaña activa (la variante .fill). .ln = trazo que no se
  // rellena, .hole = hueco del relleno
  const SF = {
    house: '<path d="M3.6 11.3 12 4.2l8.4 7.1V20h-5.5v-5.6H9.1V20H3.6Z"/>',
    tray: '<path d="M3.5 13.5 6 5h12l2.5 8.5V19h-17Z"/><path d="M3.5 13.5h5l1.2 2.2h4.6l1.2-2.2h5" class="ln"/>',
    'square.and.pencil': '<path d="M12 5H5.5v13.5H19V12" class="ln"/><path d="m10 14 .8-3.2 7.4-7.4 2.4 2.4-7.4 7.4Z"/>',
    'chart.bar': '<path d="M4.5 13h3.6v6.5H4.5Zm5.7-7.5h3.6v14h-3.6Zm5.7 4.5h3.6v9.5h-3.6Z"/>',
    sparkles: '<path d="M10 3.5 11.8 9l5.2 1.8-5.2 1.8L10 18l-1.8-5.4L3 10.8 8.2 9Z"/><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2-2.2-.8 2.2-.8Z"/>',
    gearshape: '<circle cx="12" cy="12" r="7.4" stroke-width="3.2" stroke-dasharray="2.6 3.2" class="ln"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="2.2" class="hole"/>',
    star: '<path d="M12 3.6 14.6 9l5.9.85-4.27 4.15 1 5.87L12 17.1l-5.23 2.77 1-5.87L3.5 9.85 9.4 9Z"/>',
    'square.stack': '<path d="M7.5 4.5h9M5.5 7h13" class="ln"/><rect x="4" y="9.5" width="16" height="10.5" rx="2"/>',
    'person.2': '<circle cx="9" cy="8.4" r="3.3"/><path d="M2.8 19.6c0-3.4 2.8-5.8 6.2-5.8s6.2 2.4 6.2 5.8Z"/><path d="M15.4 5.3a3.1 3.1 0 1 1 0 6.2M17.2 14c2.4.6 4 2.7 4 5.6" class="ln"/>',
    safari: '<circle cx="12" cy="12" r="8.6" class="ln"/><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5Z"/>',
    map: '<path d="M3.8 6.4 9 4.5l6 2 5.2-1.9v13l-5.2 1.9-6-2-5.2 1.9Z"/><path d="M9 4.5v13M15 6.5v13" class="ln"/>',
    location: '<path d="M19.6 4.4 4.5 11l7 1.4 1.4 7Z"/>',
    bookmark: '<path d="M6.5 3.8h11v16.4L12 16.3l-5.5 3.9Z"/>',
    person: '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.6 20.2c0-4 3.3-6.6 7.4-6.6s7.4 2.6 7.4 6.6Z"/>',
    // respaldo, como el nativo cuando el símbolo no existe
    circle: '<circle cx="12" cy="12" r="8"/>',
  };
  const FALLBACK_SYMBOL = 'circle';
  const sf = (name, on) =>
    `<svg class="sf${on ? ' fill' : ''}" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">${SF[name] ?? SF[FALLBACK_SYMBOL]}</svg>`;

  // arco de batería abierto por abajo con el wifi dentro y la cobertura en puntos
  const RING = `<svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true"><path d="M7.4 26.6a13 13 0 1 1 19.2 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M17 13.6c2.4 0 4.6.9 6.2 2.5l-1.4 1.4a6.8 6.8 0 0 0-9.6 0l-1.4-1.4c1.6-1.6 3.8-2.5 6.2-2.5Zm0 4c1.3 0 2.5.5 3.4 1.4L17 22.4 13.6 19c.9-.9 2.1-1.4 3.4-1.4Z" fill="currentColor"/>${[8.5, 14.2, 19.8, 25.5].map((x, i) => `<circle cx="${x}" cy="${i % 3 ? 36 : 34.5}" r="1.9" fill="currentColor" opacity="${i < 3 ? 1 : 0.4}"/>`).join('')}</svg>`;

  // columna del sistema. camera: la exterior la enseña siempre, la interior la esconde. tabs:
  // [id, sf symbol] de la app (sin tabs = no es la app, p.ej. la pantalla de inicio); active: el id.
  // light: app clara (hora y batería oscuras, cristal claro), como la barra nativa con isDark false
  const column = ({ camera = false, tabs, active = null, light = false } = {}) => `
    <div class="duo-col${light ? ' light' : ''}">
      <div class="duo-status${camera ? ' with-cam' : ''}">${camera ? '<span class="cam"></span>' : ''}<b>9:41</b>${RING}</div>
      ${tabs ? `<div class="duo-rail">${tabs.map(([id, symbol]) => `<span class="${id === active ? 'on' : ''}">${sf(symbol, id === active)}</span>`).join('')}</div>` : ''}
    </div>`;
  // indicador de inicio, centrado en la pantalla entera (es del sistema, no de la app)
  const home = () => '<div class="duo-home"></div>';

  // dispositivos que la app pinta: abierto = layout de escritorio, cerrado = compacto (termina en
  // 'phone' para que los helpers de teléfono de la app lo traten como tal)
  const DEV = { open: 'ios-duo-open', closed: 'ios-duo-phone' };
  // un solo slot de app store para las dos pantallas: 5 abierto (01-05) + 5 cerrado (06-10)
  const PER_SCREEN = 5;
  // marcos de marketing (lienzo en px css = pt de la pantalla, export a escala 3): la interior
  // abierta en apaisado (951x669 → 2853x2007, con la bisagra marcada en el bisel) y la exterior
  // cerrada (466x678 → 1398x2034). la app añade slides y out (y retoca la tipografía si quiere)
  const FRAMES = {
    inner: { base: DEV.open, hinge: true, subMax: 'none', w: 951, h: 669, screen: { w: 951, h: 669 }, bezel: 10, rLog: 36, pad: 44, padTop: 30, kicker: 12, head: 30, sub: 15, copyH: 140, bottom: 22, dot: 24 },
    outer: { base: DEV.closed, w: 466, h: 678, screen: { w: 466, h: 678 }, bezel: 9, rLog: 40, pad: 34, padTop: 40, kicker: 11, head: 28, sub: 14, copyH: 176, bottom: 24, dot: 22 },
  };

  window.StoreDuo = { SF, sf, RING, column, home, DEV, PER_SCREEN, FRAMES };
})();
