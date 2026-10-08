// specs de los assets de tienda (app store connect + google play): tamaños aceptados, límites y
// safe areas. fuente única para el checker (check.mjs) y referencia al diseñar marcos nuevos.
// revisado 2026-10-08 contra:
//   developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
//   developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications
//   developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
//   support.google.com/googleplay/android-developer/answer/9866151
// las safe areas de header/search salen de la capa "Art Safe Area" de las plantillas psd de apple
// (developer.apple.com/app-store/asset-best-practices): contenido clave (titular, foco) dentro; el
// fondo sí va a sangre. todos los tamaños en px.

export const STORE = { APP: 'app-store', PLAY: 'play-store' };

// cada tamaño en vertical y apaisado
const both = (sizes) => sizes.flatMap(([w, h]) => [[w, h], [h, w]]);

export const APP_STORE = {
  maxPerSlot: 10,
  // ningún asset admite canal alpha ni transparencias
  alpha: false,
  // orden = prioridad al clasificar por tamaño (2048x2732 es a la vez 13" y 12.9": cuenta como 13")
  slots: [
    // un solo dispositivo: exterior (1398x2034) e interior (2007x2853) comparten el máximo de 10
    { id: 'iphone-duo', label: 'iPhone Duo', sizes: both([[1398, 2034], [2007, 2853]]) },
    { id: 'iphone-di-l', label: 'iPhone Dynamic Island grande', sizes: both([[1260, 2736], [1290, 2796], [1320, 2868]]) },
    { id: 'iphone-faceid-l', label: 'iPhone Face ID grande', sizes: both([[1284, 2778], [1242, 2688]]) },
    // obligatorio si la app corre en iphone ("at least one screenshot", aunque su nota cae al
    // face id grande escalado: mejor no depender de esa ambigüedad)
    { id: 'iphone-di-m', label: 'iPhone Dynamic Island mediano', sizes: both([[1179, 2556], [1206, 2622]]), requiredWith: 'iphone' },
    { id: 'iphone-faceid-m', label: 'iPhone Face ID mediano', sizes: both([[1170, 2532], [1125, 2436], [1080, 2340]]) },
    { id: 'ipad-13', label: 'iPad 13"', sizes: both([[2064, 2752], [2048, 2732]]), requiredWith: 'ipad' },
    { id: 'ipad-11', label: 'iPad 11"', sizes: both([[1488, 2266], [1668, 2420], [1668, 2388], [1640, 2360]]) },
    // creative assets (ios/ipados 27+): opcionales, se revisan aparte en asset library
    { id: 'header', label: 'header de la ficha (21:9)', sizes: [[3840, 1646]], safe: { ref: 3840, rect: [1097, 493, 1646, 661] } },
    { id: 'search', label: 'resultados de búsqueda (3:2)', ratio: [3, 2], width: [1920, 3840], safe: { ref: 3840, rect: [836, 765, 2168, 1030] } },
    { id: 'universal', label: 'creative universal (16:9, solo png)', sizes: [[5244, 2950]], safe: { ref: 5244, rect: [1921, 660, 1402, 962] } },
  ],
  // vídeo: no lo genera el renderer; queda aquí para cuando haya previews o creative en vídeo.
  // el iPhone Duo acepta las mismas previews que el resto de iphones modernos
  video: {
    preview: { maxCount: 3, seconds: [15, 30], maxFps: 30, maxMB: 500, iphone: [886, 1920], ipad: [1200, 1600], formats: ['mov', 'm4v', 'mp4'] },
    creative: { seconds: [5, 30], fps: [30, 60], formats: ['mov', 'm4v', 'mp4'] },
  },
};

export const PLAY = {
  maxPerSlot: 8,
  alpha: false,
  slots: [
    { id: 'feature-graphic', label: 'feature graphic', sizes: [[1024, 500]] },
    // lado mínimo 320, máximo 3840 y el largo no pasa del doble del corto
    { id: 'screenshot', label: 'captura', side: [320, 3840], maxAspect: 2 },
  ],
};

const SPECS = { [STORE.APP]: APP_STORE, [STORE.PLAY]: PLAY };

const fits = (slot, w, h) => {
  if (slot.sizes) return slot.sizes.some(([sw, sh]) => sw === w && sh === h);
  if (slot.ratio) return w * slot.ratio[1] === h * slot.ratio[0] && w >= slot.width[0] && w <= slot.width[1];
  const [lo, hi] = [Math.min(w, h), Math.max(w, h)];
  return lo >= slot.side[0] && hi <= slot.side[1] && hi <= lo * slot.maxAspect;
};

// tienda por la primera carpeta de la ruta de salida (app-store/…, play-store/…) + slot que acepta
// ese tamaño. null = carpeta sin spec; slot undefined = tamaño que la tienda rechaza
export const classify = (path, w, h) => {
  const store = path.split('/')[0];
  const spec = SPECS[store];
  return spec ? { store, spec, slot: spec.slots.find((s) => fits(s, w, h)) } : null;
};

// safe area de un slot en px css de la página exportada (ancho de export w, escala de captura)
export const safeRect = (slot, w, scale) => {
  if (!slot?.safe) return null;
  const k = w / slot.safe.ref / scale;
  const [x, y, sw, sh] = slot.safe.rect.map((v) => v * k);
  return { left: x, top: y, right: x + sw, bottom: y + sh };
};
