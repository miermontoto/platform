// simbolización de los stacks de error del cliente con los source maps del build de la spa
// (vite los emite `hidden`: sin comentario sourceMappingURL, el navegador no los pide, y
// mountSpa no los sirve). la api ya tiene el build en su static/, así que cada frame que
// apunta a un chunk se traduce a fuente original (`src/routes/+page.svelte:42:7`) al ingerir.
//
// los chunks llevan hash de contenido: si existe el fichero con ese nombre, su map es el de ese
// build exacto. un frame de otro build (pestaña abierta antes del deploy, app nativa compilada
// aparte) no encuentra fichero y se queda minificado, nunca mal traducido.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { originalPositionFor, TraceMap, type EncodedSourceMap } from '@jridgewell/trace-mapping';

// solo los chunks hasheados de sveltekit (cualquier origen: https://, capacitor://)
const CHUNK_PREFIX = '/_app/immutable/';
const CHUNK_EXT = '.js';
const MAP_EXT = '.map';
// maps parseados en memoria (los de las dependencias grandes ocupan varios MB)
const MAX_CACHED_MAPS = 8;
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
    const raw = JSON.parse(await readFile(file + MAP_EXT, 'utf8')) as EncodedSourceMap;
    // el fuente embebido no hace falta para traducir posiciones y es lo que más ocupa
    delete raw.sourcesContent;
    return new TraceMap(raw);
  } catch {
    // sin map o ilegible: el frame se queda como vino
    return null;
  }
};

const loadMap = (file: string): Promise<TraceMap | null> => {
  const map = cache.get(file) ?? readMap(file);
  cache.delete(file);
  cache.set(file, map);
  if (cache.size > MAX_CACHED_MAPS) cache.delete(cache.keys().next().value!);
  return map;
};

const cleanSource = (source: string): string => source.replace(LEADING_PARENTS, '').replace(PNPM_STORE, NODE_MODULES);

const resolveLine = async (staticDir: string, line: string): Promise<string> => {
  const frame = parseFrame(line);
  const file = frame && chunkFile(staticDir, frame.url);
  const map = file ? await loadMap(file) : null;
  if (!frame || !map) return line;
  // columnas del stack 1-based; las del map, 0-based
  const pos = originalPositionFor(map, { line: frame.line, column: frame.column - 1 });
  if (!pos.source || pos.line === null) return line;
  return `    at ${pos.name ?? frame.fn ?? '<anonymous>'} (${cleanSource(pos.source)}:${pos.line}:${pos.column + 1})`;
};

/** traduce los frames de chunks de la spa a su fuente original; el resto queda intacto. */
export async function symbolicate(stack: string, staticDir: string | undefined): Promise<string> {
  if (!staticDir || !stack.includes(CHUNK_PREFIX)) return stack;
  const root = path.resolve(staticDir);
  const lines = await Promise.all(stack.split('\n').map((line) => resolveLine(root, line)));
  return lines.join('\n');
}
