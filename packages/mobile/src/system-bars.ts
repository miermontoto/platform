// sincronización en runtime de las system bars (status arriba, navigation abajo)
// con el tema actual de la app.
//
// por qué: createCapacitorConfig (index.ts) fija un backgroundColor estático en
// build-time. en android 15 (edge-to-edge forzado) ambas barras son overlays
// transparentes que muestran el fondo de la VENTANA, y
// @capacitor/status-bar.setBackgroundColor es no-op (bug capacitor 7,
// capacitor-plugins#2341). al cambiar de tema (claro/oscuro) en runtime las
// barras se quedaban con el color de build-time, y la nav bar no se tocaba nunca.
//
// solución: @capawesome/capacitor-android-edge-to-edge-support pinta el área de
// ambas barras en runtime (setBackgroundColor, combinado en su línea 7.x);
// @capacitor/status-bar.setStyle ajusta el contraste de los iconos. ambos
// plugins son peers OPCIONALES: si la app no los instala, se degrada con gracia.
// no-op en web.
import { Capacitor } from '@capacitor/core';
import { isDarkColor, rgbToHex } from './color';

export interface SystemBarsTheme {
  // color de fondo de las barras (hex). en la línea 7.x del plugin de capawesome
  // ambas barras comparten un único color (status + navigation).
  backgroundColor: string;
  // contraste de los iconos de la status bar ('DARK' = fondo oscuro → iconos
  // claros). si se omite, se deriva de la luminancia de backgroundColor.
  style?: 'DARK' | 'LIGHT';
}

let warnedMissingEdgeToEdge = false;

/**
 * recolorea ambas system bars al color del tema y ajusta el contraste de los
 * iconos. no-op fuera de plataforma nativa. seguro de llamar repetidamente
 * (en cada cambio de tema).
 */
export async function applySystemBars(theme: SystemBarsTheme): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { backgroundColor } = theme;
  const dark = theme.style ? theme.style === 'DARK' : isDarkColor(backgroundColor);

  // contraste de iconos de la status bar (sigue valiendo en android 15+).
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    // color de la status bar para android < 15; en 15+ es no-op pero inofensivo.
    await StatusBar.setBackgroundColor({ color: backgroundColor }).catch(() => undefined);
  } catch {
    // @capacitor/status-bar no instalado: sin contraste de iconos.
  }

  // área real de ambas barras en android 15+ (la parte que de verdad funciona).
  try {
    const { EdgeToEdge } = await import(
      '@capawesome/capacitor-android-edge-to-edge-support'
    );
    await EdgeToEdge.setBackgroundColor({ color: backgroundColor });
  } catch {
    if (!warnedMissingEdgeToEdge) {
      warnedMissingEdgeToEdge = true;
      console.warn(
        '[@platform/mobile] @capawesome/capacitor-android-edge-to-edge-support no ' +
          'instalado: el área de las system bars no se recolorea en android 15+.',
      );
    }
  }
}

/**
 * resuelve cualquier expresión de color CSS (var(), color-mix(), nombrado, hex)
 * a '#rrggbb' usando el motor del browser: la escribe en un probe oculto y lee
 * el color computado (siempre rgb(a)). devuelve null si no es resoluble.
 */
export function resolveCssColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const probe = document.createElement('span');
  probe.style.color = trimmed;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color; // 'rgb(...)' / 'rgba(...)'
  probe.remove();
  return rgbToHex(computed);
}

// ¿color con alfa > 0? getComputedStyle devuelve 'rgba(0, 0, 0, 0)' para fondos
// transparentes (sin background propio): los descartamos para caer al fallback.
function isOpaque(color: string): boolean {
  const m = color.match(/rgba?\([^)]*\)/);
  if (!m) return color.trim() !== '' && color.trim() !== 'transparent';
  const parts = color.match(/[\d.]+/g);
  return !parts || parts.length < 4 || parseFloat(parts[3]) > 0;
}

export interface CssSyncOptions {
  // custom property de la que leer el color de fondo (ej. '--bg'). si se omite,
  // se usa el background-color computado de `element` (funciona con tailwind y
  // con apps que no exponen una custom property de fondo).
  backgroundVar?: string;
  // elemento raíz del tema (default document.documentElement). de él se leen las
  // custom properties / el background-color, y se observan sus atributos.
  element?: HTMLElement;
  // override explícito del contraste de iconos (si se omite, por luminancia).
  style?: 'DARK' | 'LIGHT';
}

// resuelve el color de fondo del tema actual a hex: custom property si se indica,
// si no el background-color computado del elemento (con fallback a <body>).
function readThemeBackground(options: CssSyncOptions): string | null {
  const el = options.element ?? document.documentElement;
  if (options.backgroundVar) {
    return resolveCssColor(getComputedStyle(el).getPropertyValue(options.backgroundVar));
  }
  const fromEl = getComputedStyle(el).backgroundColor;
  if (isOpaque(fromEl)) return resolveCssColor(fromEl);
  // <html> sin fondo propio: el color visible suele estar en <body>.
  const fromBody = document.body && getComputedStyle(document.body).backgroundColor;
  return fromBody && isOpaque(fromBody) ? resolveCssColor(fromBody) : null;
}

/**
 * lee el color de fondo del tema actual (custom property o background-color
 * computado) y lo aplica a las system bars. pensado para llamarse tras cada
 * cambio de tema. no-op fuera de plataforma nativa.
 */
export async function syncSystemBarsFromCss(options: CssSyncOptions = {}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const backgroundColor = readThemeBackground(options);
  if (!backgroundColor) return; // fondo no resoluble: nada que hacer.
  await applySystemBars({ backgroundColor, style: options.style });
}

/**
 * sincroniza las barras una vez y vuelve a hacerlo en cada cambio de tema,
 * observando los atributos (class/style/data-theme) del elemento — así la app
 * no tiene que cablear su propio hook de cambio de tema. devuelve una función
 * para desuscribirse. no-op fuera de plataforma nativa.
 */
export function observeSystemBars(options: CssSyncOptions = {}): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  const el = options.element ?? document.documentElement;
  const sync = () => void syncSystemBarsFromCss(options);
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(el, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
  return () => observer.disconnect();
}
