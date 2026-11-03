// simbolización de los stacks de error del cliente con los source maps del build de la spa
// (vite los emite `hidden`: sin comentario sourceMappingURL, el navegador no los pide, y
// mountSpa no los sirve). la api ya tiene el build en su static/, así que cada frame que
// apunta a un chunk se traduce a fuente original (`src/routes/+page.svelte:42:7`) al ingerir.
//
// los chunks llevan hash de contenido: si existe el fichero con ese nombre, su map es el de ese
// build exacto. un frame de otro build (pestaña abierta antes del deploy, app nativa compilada
// aparte) no encuentra fichero y se queda minificado, nunca mal traducido.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { originalPositionFor, TraceMap, type EncodedSourceMap } from '@jridgewell/trace-mapping';

// solo los chunks hasheados de sveltekit (cualquier origen: https://, capacitor://)
const CHUNK_PREFIX = '/_app/immutable/';
const CHUNK_EXT = '.js';
const MAP_EXT = '.map';
// maps parseados en memoria (sin sourcesContent, los grandes ocupan unos MB)
const MAX_CACHED_MAPS = 16;
// el stack llega de un endpoint sin auth: un lote forjado podría apuntar cada frame a un chunk
// distinto y obligar a parsear decenas de maps de varios MB. topes: frames traducidos por
// stack, maps nuevos (fuera de caché) por lote, y tamaño de un map. los frames de arriba van
// primero, así que el presupuesto se gasta en los que importan
const MAX_FRAMES = 30;
const MAX_MAP_LOADS_PER_BATCH = 3;
const MAX_MAP_BYTES = 8 * 1024 * 1024;
// v8 (`at fn (url:1:2)`, `at url:1:2`) y jsc/gecko (`fn@url:1:2`)
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const JSC_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;
// rutas de fuente relativas al map (`../../../src/x.ts`) y el store de pnpm, que no aportan
const LEADING_PARENTS = /^(?:\.\.\/)+/;
const PNPM_STORE = /node_modules\/\.pnpm\/[^/]+\/node_modules\//;
const NODE_MODULES = 'node_modules/';

interface Frame {
  fn?: string;
  url: string;
  line: number;
  column: number;
}

// lru mínimo: el Map conserva el orden de inserción, se reinserta al usar y se expulsa el primero.
// se cachea la promesa, no el map: los frames de un stack se resuelven en paralelo y casi todos
// caen en el mismo chunk, que así se lee y parsea una sola vez. null = sin map (otro build),
// cacheado también para no repetir el fs en cada error de ese build
const cache = new Map<string, Promise<TraceMap | null>>();

const parseFrame = (line: string): Frame | null => {
  const m = V8_FRAME.exec(line) ?? JSC_FRAME.exec(line);
  return m ? { fn: m[1] || undefined, url: m[2], line: Number(m[3]), column: Number(m[4]) } : null;
};

// fichero del chunk dentro de staticDir, o null si el frame no es de un chunk propio. el
// pathname de URL ya viene sin segmentos `..`; la comprobación de prefijo es la red de seguridad
const chunkFile = (staticDir: string, url: string): string | null => {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(CHUNK_PREFIX) || !pathname.endsWith(CHUNK_EXT)) return null;
  const file = path.join(staticDir, pathname);
  return file.startsWith(staticDir + path.sep) ? file : null;
};

const readMap = async (file: string): Promise<TraceMap | null> => {
  try {
    if ((await stat(file + MAP_EXT)).size > MAX_MAP_BYTES) return null;
    const raw = JSON.parse(await readFile(file + MAP_EXT, 'utf8')) as EncodedSourceMap;
    // el fuente embebido no hace falta para traducir posiciones y es lo que más ocupa
    delete raw.sourcesContent;
    return new TraceMap(raw);
  } catch {
    // sin map o ilegible: el frame se queda como vino
    return null;
  }
};

// `budget.loads`: maps nuevos que aún puede leer este lote. sin presupuesto el frame se queda
// minificado y no se cachea nada: un lote posterior (el siguiente error) sí lo traducirá
const loadMap = (file: string, budget: { loads: number }): Promise<TraceMap | null> => {
  const hit = cache.get(file);
  if (!hit && budget.loads <= 0) return Promise.resolve(null);
  if (!hit) budget.loads--;
  const map = hit ?? readMap(file);
  cache.delete(file);
  cache.set(file, map);
  if (cache.size > MAX_CACHED_MAPS) cache.delete(cache.keys().next().value!);
  return map;
};

const cleanSource = (source: string): string => source.replace(LEADING_PARENTS, '').replace(PNPM_STORE, NODE_MODULES);

const resolveLine = async (staticDir: string, line: string, budget: { loads: number }): Promise<string> => {
  const frame = parseFrame(line);
  const file = frame && chunkFile(staticDir, frame.url);
  const map = file ? await loadMap(file, budget) : null;
  if (!frame || !map) return line;
  // columnas del stack 1-based; las del map, 0-based
  const pos = originalPositionFor(map, { line: frame.line, column: frame.column - 1 });
  if (!pos.source || pos.line === null) return line;
  return `    at ${pos.name ?? frame.fn ?? '<anonymous>'} (${cleanSource(pos.source)}:${pos.line}:${pos.column + 1})`;
};

/**
 * simbolizador para un lote: traduce los frames de chunks de la spa a su fuente original (el
 * resto queda intacto), con un presupuesto de maps nuevos compartido por todo el lote.
 */
export function createSymbolicator(staticDir: string | undefined): (stack: string) => Promise<string> {
  const root = staticDir && path.resolve(staticDir);
  const budget = { loads: MAX_MAP_LOADS_PER_BATCH };
  return async (stack) => {
    if (!root || !stack.includes(CHUNK_PREFIX)) return stack;
    const lines = stack.split('\n');
    // la primera línea es el mensaje; los frames por encima del tope quedan tal cual
    const resolved = await Promise.all(lines.map((line, i) => (i <= MAX_FRAMES ? resolveLine(root, line, budget) : line)));
    return resolved.join('\n');
  };
}
