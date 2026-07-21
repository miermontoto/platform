// helpers compartidos por los generadores de assets móviles (icons/splash).
import { createRequire } from 'node:module';

// sharp no es dependencia de este repo: se resuelve desde el cwd del caller
// (una app que lo tenga instalado, o el entorno npm aislado del workflow ios)
export const loadSharp = () => createRequire(`${process.cwd()}/`)('sharp');

// '#rrggbb' → objeto de color de sharp
export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
};
