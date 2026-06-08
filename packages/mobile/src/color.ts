// helpers de color puros (sin DOM ni capacitor): compartidos por la config de
// build-time (index.ts) y la sincronización en runtime (system-bars.ts).

// luminancia relativa aproximada de un hex (#rgb o #rrggbb) → ¿tema oscuro?
export function isDarkColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

// 'rgb(r, g, b)' / 'rgba(r, g, b, a)' (lo que devuelve el browser al resolver un
// color) → '#rrggbb'. el canal alfa se descarta: las system bars son opacas.
// devuelve null si la cadena no es un rgb(a) parseable.
export function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(parseFloat(m[n]))))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
