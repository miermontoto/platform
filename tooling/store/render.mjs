// renderer compartido de las capturas de tienda de las apps: sirve el dir de la galería
// (index.html + screens.js) por http, abre chromium headless por cdp y captura cada entrada del
// manifiesto (window.STORE.manifest) a su tamaño y escala de tienda. después valida cada png contra
// las specs de app store / google play (check.mjs) y sale con error si la tienda rechazaría alguno.
// cada app lo invoca desde un assets/store/render.mjs fino con su config:
//   renderStore({ dir, port, fonts: { families, dir?, files? }, routes?, pages?, chromeArgs?, modes? })
// uso: node assets/store/render.mjs [filtro-de-ruta] [--out <dir>]   (CHROME_PATH / CDP_PORT opcionales)
//      node assets/store/render.mjs --check    (valida los png ya exportados, sin re-exportar)
//      node assets/store/render.mjs --serve    (solo sirve la galería, para revisarla en un navegador)
//      node assets/store/render.mjs --<modo>   (modos propios de la app, p.ej. --maps en carreterinas)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkFile, checkSafe, checkSet } from './check.mjs';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.geojson': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const DEFAULT_CDP_PORT = 9470;
const SETTLE_MS = 150;
const BOOT_TRIES = 50;
const BOOT_POLL_MS = 100;
const CHROME_FLAGS = ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'];
const GOOGLE_FONTS_LINK = /<link[^>]+fonts\.g[^>]+>\n?/g;
const FONTS_ROUTE = '/fonts/';
const FONT_PROBE_PX = 16;
const NEXT_FRAME = 'document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))';
const IMAGES_READY = 'Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))';
// contenido clave de los creative: la página lo marca con [data-safe="<nombre>"]
const SAFE_RECTS = `[...document.querySelectorAll('[data-safe]')].map((e) => { const r = e.getBoundingClientRect(); return { name: e.dataset.safe || e.tagName.toLowerCase(), left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })`;

const parseArgs = (argv, defaultOut) => {
  const outIdx = argv.indexOf('--out');
  return {
    out: outIdx >= 0 ? resolve(argv[outIdx + 1]) : defaultOut,
    filter: argv.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1)) ?? '',
    flags: new Set(argv.filter((a) => a.startsWith('--'))),
  };
};

// el binario: CHROME_PATH o el chromium que cachea playwright
const findChrome = async () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base) ? (await readdir(base)).filter((d) => d.startsWith('chromium-')).sort().reverse() : [];
  const hit = dirs.map((d) => join(base, d, 'chrome-linux64/chrome')).find(existsSync);
  if (!hit) throw new Error('chromium no encontrado: define CHROME_PATH');
  return hit;
};

// la página se publica sin esqueleto (lo pone el artifact); aquí se envuelve igual. con fuentes
// locales se declaran sus @font-face y se quitan los <link> a google fonts
const skeleton = (body, files) => {
  const faces = Object.entries(files)
    .map(([family, file]) => `@font-face{font-family:'${family}';src:url('${FONTS_ROUTE}${file}') format('woff2');font-weight:100 900}`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${faces && `<style>${faces}</style>`}</head><body>${faces ? body.replace(GOOGLE_FONTS_LINK, '') : body}</body></html>`;
};

// '/' = la galería envuelta, pages = html propio por ruta, routes = prefijo → carpeta, el resto del dir
const serve = ({ dir, pages, routes, fontFiles }) =>
  new Promise((ok) => {
    // confinado a su carpeta: un ..%2f sobrevive a la normalización de URL y se decodifica después
    const fileFor = (path) => {
      const prefix = Object.keys(routes).find((p) => path.startsWith(p));
      const root = resolve(prefix ? routes[prefix] : dir);
      const file = join(root, prefix ? path.slice(prefix.length) : path);
      if (!file.startsWith(root + sep)) throw new Error('fuera de la carpeta servida');
      return file;
    };
    const srv = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      try {
        const html = path === '/' ? skeleton(await readFile(join(dir, 'index.html'), 'utf8'), fontFiles) : pages[path];
        if (html) {
          res.writeHead(200, { 'content-type': MIME['.html'] });
          res.end(html);
          return;
        }
        const file = fileFor(path);
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch (e) {
        // el favicon lo pide chromium solo; el resto de 404 son rutas mal escritas en la página
        if (path !== '/favicon.ico') console.error(`[store] 404 ${path}: ${e.message}`);
        res.writeHead(404).end();
      }
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });

// cliente cdp mínimo sobre el WebSocket global de node 22
const cdp = async (wsUrl) => {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = ko;
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, ko } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? ko(new Error(`${msg.error.message}`)) : ok(msg.result);
    } else if (msg.method) {
      waiters.filter((w) => w.method === msg.method).forEach((w) => w.ok(msg.params));
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok, ko) => {
      pending.set(++id, { ok, ko });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) => new Promise((ok) => waiters.push({ method, ok }));
  return { send, once, close: () => ws.close() };
};

// la pestaña de chromium por cdp: navegar, evaluar, emular el tamaño y capturar
const openPage = async (port) => {
  let targets = [];
  for (let i = 0; i < BOOT_TRIES && !targets.length; i++) {
    await sleep(BOOT_POLL_MS);
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json(), () => []);
  }
  const tab = targets.find((t) => t.type === 'page');
  if (!tab) throw new Error('chromium arrancó sin pestaña');
  const c = await cdp(tab.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const load = async (url) => {
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url });
    await loaded;
    await evaluate(NEXT_FRAME);
  };
  const size = (width, height, deviceScaleFactor) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  const shoot = async (file, width, height) => {
    const { data } = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data, 'base64'));
  };
  return { send: c.send, evaluate, load, size, shoot, close: c.close };
};

// exporta (o con checkOnly solo valida) cada entrada del manifiesto; devuelve las incidencias
const exportJobs = async (page, { base, out, filter, checkOnly, families }) => {
  const fontsReady = `[${families.map((f) => JSON.stringify(`${FONT_PROBE_PX}px "${f}"`))}].every((f) => document.fonts.check(f))`;
  await page.load(base);
  const manifest = await page.evaluate('window.STORE.manifest()');
  // lang y variant (marco + salida, = tipo de dispositivo en play) salen del hash x.<marco>.<n>.<lang>
  const jobs = manifest
    .flatMap((m) => m.outputs.map((o, i) => ({ ...m, ...o, lang: m.hash.split('.').at(-1), variant: `${m.hash.split('.')[1]}:${i}` })))
    .filter((j) => j.path.includes(filter));
  const show = async (j, n) => {
    await page.size(j.w, j.h, j.scale);
    await page.load(`${base}?r=${n}#${j.hash}`);
    if (!(await page.evaluate(fontsReady))) throw new Error(`fuentes sin cargar en ${j.hash}`);
    await page.evaluate(IMAGES_READY);
    await sleep(SETTLE_MS);
  };
  const entries = [];
  for (const [n, j] of jobs.entries()) {
    const file = join(out, j.path);
    if (!checkOnly) {
      await show(j, n);
      await page.shoot(file, j.w, j.h);
      console.log(`${j.path}  ${Math.round(j.w * j.scale)}x${Math.round(j.h * j.scale)}`);
    }
    const res = await checkFile(j, file);
    if (res.slot?.safe) {
      if (checkOnly) await show(j, n);
      res.issues.push(...checkSafe(j, res.slot, await page.evaluate(SAFE_RECTS)));
    }
    entries.push({ job: j, ...res });
  }
  // con filtro el conjunto está incompleto: los límites y obligatorios solo valen sin él
  return { count: jobs.length, issues: [...entries.flatMap((e) => e.issues), ...(filter ? [] : checkSet(entries))] };
};

// imprime las incidencias; true si ninguna es un error
const report = ({ count, issues }) => {
  issues.forEach((i) => (i.level === 'error' ? console.error : console.warn)(`[store] ${i.level === 'error' ? '✗' : '!'} ${i.path}: ${i.msg}`));
  const errors = issues.filter((i) => i.level === 'error').length;
  console.log(errors ? `[store] ${errors} error(es): la tienda rechazaría esos assets` : `[store] ${count} assets dentro de spec${issues.length ? ' (con avisos)' : ''}`);
  return !errors;
};

export const renderStore = async ({ dir, port = DEFAULT_CDP_PORT, fonts = {}, routes = {}, pages = {}, chromeArgs = [], modes = {} }) => {
  const args = parseArgs(process.argv.slice(2), resolve(dir, '..'));
  const srv = await serve({ dir, pages, fontFiles: fonts.files ?? {}, routes: fonts.dir ? { ...routes, [FONTS_ROUTE]: fonts.dir } : routes });
  const base = `http://127.0.0.1:${srv.address().port}/`;
  if (args.flags.has('--serve')) {
    console.log(`galería en ${base}`);
    return;
  }
  const cdpPort = Number(process.env.CDP_PORT ?? port);
  let chrome;
  try {
    chrome = spawn(await findChrome(), [...CHROME_FLAGS, ...chromeArgs, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { stdio: 'ignore' });
    const page = await openPage(cdpPort);
    const mode = Object.keys(modes).find((m) => args.flags.has(`--${m}`));
    if (mode) await modes[mode]({ ...page, base, filter: args.filter });
    else if (!report(await exportJobs(page, { base, out: args.out, filter: args.filter, checkOnly: args.flags.has('--check'), families: fonts.families ?? Object.keys(fonts.files ?? {}) }))) process.exitCode = 1;
    page.close();
  } catch (e) {
    console.error(`[store] export fallido: ${e.message}`);
    process.exitCode = 1;
  } finally {
    chrome?.kill();
    srv.close();
  }
};
