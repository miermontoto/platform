// kit de composición de las capturas de tienda (window.StoreKit; render.mjs lo sirve en /platform/kit/
// junto a kit.css). la mecánica es compartida: geometría de cada marco, el dispositivo a escala y los
// layouts que lo colocan con su titular. la dirección de arte es de cada app: tono, tipografía y color
// en sus variables css (--kit-*), y motivos, copy y fragmentos en cada slide.
// uso en su index.html, después de duo.js y antes de screens.js:
//   <link rel="stylesheet" href="platform/kit/kit.css"><script src="platform/kit/kit.js"></script>
// una slide: { slug, head(dev), layout, tone?, scr(dev), scale?, lens?, figure?, art?(ctx) }
//   layout  rise   titular arriba y el dispositivo debajo, sangrando por abajo (apaisado: por la derecha)
//           fall   el dispositivo entra desde arriba y el titular cierra abajo (apaisado: desde la izquierda)
//           lens   el dispositivo desplazado y un fragmento de su ui ampliado encima (lens.html, lens.w)
//           poster una cifra o palabra enorme (figure) manda; el dispositivo, pequeño, en una esquina
//           scene  sin dispositivo: el arte de la app (art) es la pieza
//   tone    clase .tone-<tono> en la slide; la app define sus colores (--kit-bg, --kit-ink, --kit-em)
//   art     html detrás de todo, recibe { f, dev, i, n, wide }; panorama() para un motivo continuo
(() => {
  'use strict';

  const { StoreDuo } = window;
  // lienzo en px css (= pt de la pantalla, que la llena entera) y radio de pantalla en px lógicos.
  // base = dispositivo cuyas pantallas pinta (otro tamaño de iphone, el Duo). los tamaños de tienda
  // que acepta cada uno están en specs.mjs
  const FRAME = {
    // dynamic island mediano (1206x2622): el obligatorio de app store
    'ios-phone-m': { base: 'ios-phone', w: 402, h: 874, bezel: 9, rLog: 55 },
    // dynamic island grande (1320x2868): la casilla de 6,5"/6,7"/6,9" de app store connect
    'ios-phone': { w: 440, h: 956, bezel: 9, rLog: 55 },
    'ios-tablet': { w: 1366, h: 1024, bezel: 14, rLog: 20 },
    'android-phone': { w: 360, h: 640, bezel: 7, rLog: 22 },
    'android-tablet': { w: 1280, h: 800, bezel: 12, rLog: 16 },
    ...(StoreDuo && {
      'ios-duo-inner': { base: StoreDuo.DEV.open, hinge: true, ...pick(StoreDuo.FRAMES.inner) },
      'ios-duo-outer': { base: StoreDuo.DEV.closed, ...pick(StoreDuo.FRAMES.outer) },
    }),
  };
  function pick({ w, h, bezel, rLog }) {
    return { w, h, bezel, rLog };
  }

  // proporciones sobre el lado corto del lienzo: margen, titular y separación
  const PAD = 0.08;
  const HEAD = { tall: 0.074, wide: 0.054 };
  const GAP = 0.06;
  // escala del titular por layout (poster cede el protagonismo a la cifra, scene lo gana)
  const HEAD_K = { rise: 1, fall: 1, lens: 1, poster: 0.78, scene: 1.18 };
  // ancho del dispositivo por layout, en fracción del ancho del lienzo
  const DEVICE_W = { tall: { rise: 0.96, fall: 1.02, lens: 0.84, poster: 0.66 }, wide: { rise: 0.74, fall: 0.72, lens: 0.6, poster: 0.56 } };
  // ancho visible del fragmento ampliado de lens
  const LENS_W = { tall: 0.66, wide: 0.4 };
  // ancho de una cifra monoespaciada en em: lo que usa poster para que la cifra llene su columna
  const MONO_CH = 0.6;
  // columna del texto en apaisado (rise/fall/poster), en fracción del ancho
  const WIDE_COL = 0.34;

  const isWide = (f) => f.w > f.h;
  const metrics = (f, layout) => {
    const u = Math.min(f.w, f.h);
    const wide = isWide(f);
    return { wide, pad: u * PAD, gap: u * GAP, head: u * HEAD[wide ? 'wide' : 'tall'] * (HEAD_K[layout] ?? 1) };
  };

  // el dispositivo a un ancho dado: bisel, pantalla escalada y su viewport al tamaño real
  const device = (f, html, width) => {
    const s = (width - 2 * f.bezel) / f.w;
    const rIn = f.rLog * s;
    return `<div class="device kit-device" style="width:${width}px;height:${f.h * s + 2 * f.bezel}px;border-radius:${rIn + f.bezel}px">
        ${f.hinge ? '<i class="hinge"></i>' : ''}
        <div class="screen" style="left:${f.bezel - 1}px;top:${f.bezel - 1}px;width:${f.w * s}px;height:${f.h * s}px;border-radius:${rIn}px">
          <div class="vp" style="width:${f.w}px;height:${f.h}px;transform:scale(${s})">${html}</div>
        </div>
      </div>`;
  };

  // fragmento de la ui ampliado: se pinta a su ancho natural y se escala al visible del layout
  const lens = (f, sl, dev, m) => {
    const { html, w } = sl.lens;
    const k = (f.w * LENS_W[m.wide ? 'wide' : 'tall']) / w;
    return `<div class="kit-lens" style="width:${w}px;scale:${k}">${html(dev)}</div>`;
  };

  // la cifra de poster: llena el ancho de su columna (--kit-col) según sus caracteres
  const figure = (text) => `<div class="kit-figure" style="--ch:${[...text.replace(/<[^>]+>/g, '')].length * MONO_CH}">${text}</div>`;

  // cada layout devuelve el contenido de la slide (encima del arte)
  const LAYOUTS = {
    rise: ({ f, sl, dev, head, dw }) => `<div class="kit-flow">${head}${device(f, sl.scr(dev), dw)}</div>`,
    fall: ({ f, sl, dev, head, dw }) => `<div class="kit-flow end">${device(f, sl.scr(dev), dw)}${head}</div>`,
    lens: ({ f, sl, dev, m, head, dw }) => `<div class="kit-flow">${head}${device(f, sl.scr(dev), dw)}</div>${lens(f, sl, dev, m)}`,
    poster: ({ f, sl, dev, head, dw }) => `<div class="kit-flow">${figure(sl.figure(dev))}${head}${device(f, sl.scr(dev), dw)}</div>`,
    scene: ({ head }) => `<div class="kit-flow">${head}</div>`,
  };

  // la slide entera: tono, variables del layout, arte detrás y el contenido del layout
  const slide = (f, sl, i = 0, n = 1) => {
    const dev = f.base ?? f.key;
    const layout = sl.layout ?? 'rise';
    const m = metrics(f, layout);
    const dw = f.w * (sl.scale ?? DEVICE_W[m.wide ? 'wide' : 'tall'][layout] ?? 1);
    const col = m.wide ? f.w * WIDE_COL : f.w - 2 * m.pad;
    const head = `<h1 class="kit-head">${sl.head(dev)}</h1>`;
    const art = sl.art ? `<div class="kit-art">${sl.art({ f, dev, i, n, wide: m.wide })}</div>` : '';
    const cls = ['slide', 'kit', `kit-${layout}`, m.wide ? 'wide' : 'tall', sl.tone && `tone-${sl.tone}`].filter(Boolean).join(' ');
    return `<div class="${cls}" style="width:${f.w}px;height:${f.h}px;--kit-pad:${m.pad}px;--kit-gap:${m.gap}px;--kit-head:${m.head}px;--kit-col:${col}px">
      ${art}${LAYOUTS[layout]({ f, sl, dev, m, head, dw })}
    </div>`;
  };

  // motivo continuo entre las slides de un marco: fn(anchoTotal, alto) se pinta una vez a lo ancho de
  // las n slides y cada una enseña su tramo, así la tira se lee seguida en la ficha de la tienda
  const panorama = ({ f, i, n }, fn) => `<div class="kit-pano" style="width:${f.w * n}px;height:${f.h}px;left:${-f.w * i}px">${fn(f.w * n, f.h)}</div>`;

  // marcos de una app: el preset del kit + sus slides y salidas (key = el id del marco, que es el
  // dispositivo que pintan sus pantallas si no tiene base)
  const frames = (defs) => Object.fromEntries(Object.entries(defs).map(([key, d]) => [key, { key, ...FRAME[key], ...d }]));

  window.StoreKit = { FRAME, frames, slide, device, panorama, isWide };
})();
