// presets de vite compartidos por las webs sveltekit de las apps de la plataforma
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

/**
 * construye las opciones de SvelteKitPWA con los defaults de la plataforma
 * (sw autoUpdate, display standalone, NetworkOnly para rutas de api).
 *
 * @param {object} app
 * @param {string} app.name           nombre completo mostrado al instalar
 * @param {string} app.shortName      etiqueta de home screen
 * @param {string} [app.description]
 * @param {string} [app.themeColor]   tambien usado como background_color
 * @param {Array<{name: string, url: string}>} [app.shortcuts]
 * @param {string[]} [app.networkOnly] prefijos de ruta que nunca se sirven de cache
 * @param {Array<object>} [app.icons]  iconos del manifest (default: pwa-192/512.png). pasar
 *        un svg (`{src,sizes:'any',type:'image/svg+xml',purpose:'any'}`) evita exigir pngs.
 * @param {'generateSW'|'injectManifest'} [app.strategies]  default generateSW (sw autogenerado).
 *        injectManifest = sw a mano (p.ej. para handlers de push). en sveltekit el sw DEBE vivir
 *        en src/service-worker.ts (el plugin inyecta el manifest sobre el output compilado por kit);
 *        srcDir/filename se omiten salvo override explícito.
 * @param {string} [app.srcDir]   override del dir del sw (normalmente innecesario en sveltekit).
 * @param {string} [app.filename] override del nombre del sw (normalmente innecesario en sveltekit).
 */
export function createPwaOptions({
  name,
  shortName,
  description = '',
  themeColor = '#080a0c',
  shortcuts = [],
  networkOnly = ['/api/', '/auth/'],
  icons,
  strategies = 'generateSW',
  srcDir,
  filename,
}) {
  const icon192 = { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' };
  const icon512 = { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' };
  const manifestIcons = icons ?? [icon192, icon512, { ...icon512, purpose: 'maskable' }];
  const base = {
    registerType: 'autoUpdate',
    strategies,
    scope: '/',
    base: '/',
    manifest: {
      name,
      short_name: shortName,
      description,
      theme_color: themeColor,
      background_color: themeColor,
      display: 'standalone',
      scope: '/',
      start_url: '/',
      icons: manifestIcons,
      shortcuts: shortcuts.map(({ name: n, url }) => ({
        name: n,
        url,
        icons: [manifestIcons[0]],
      })),
    },
    devOptions: { enabled: false },
  };
  // injectManifest: el sw lo escribe la app (handlers de push, etc.). vite-plugin-pwa solo
  // inyecta el precache manifest (self.__WB_MANIFEST); el resto del routing lo decide el sw.
  if (strategies === 'injectManifest') {
    return {
      ...base,
      ...(srcDir ? { srcDir } : {}),
      ...(filename ? { filename } : {}),
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
      },
    };
  }
  return {
    ...base,
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
      navigateFallback: '200.html',
      navigateFallbackDenylist: networkOnly.map((p) => new RegExp(`^${p.replace(/\/$/, '')}/`)),
      runtimeCaching: networkOnly.map((prefix) => ({
        urlPattern: (/** @type {{ url: URL }} */ ctx) => ctx.url.pathname.startsWith(prefix),
        handler: 'NetworkOnly',
      })),
    },
  };
}

/**
 * config estandar de vite para las webs (sveltekit) de la plataforma:
 * proxy de dev hacia la api local y pwa opcional.
 *
 * @param {object} [options]
 * @param {object} [options.pwa]      opciones de createPwaOptions(); omitir para no generar pwa
 * @param {string[]} [options.proxy]  prefijos proxificados a la api en dev
 * @param {string} [options.envDir]   donde vive el .env de la app (default: raiz de la app, dos niveles sobre packages/web)
 * @param {import('vite').PluginOption[]} [options.plugins]  plugins extra; se anteponen a sveltekit()
 * @param {true | { project?: string, outdir?: string, strategy?: string[] }} [options.i18n]
 *        activa i18n con paraglide (inlang). true = defaults; objeto para override. la app
 *        debe tener `@inlang/paraglide-js` instalado + `project.inlang` + `messages/`.
 */
export function createWebConfig({ pwa, proxy = ['/api', '/auth'], envDir, plugins: extraPlugins = [], i18n } = {}) {
  return defineConfig(async ({ mode }) => {
    const env = loadEnv(mode, envDir ?? process.cwd() + '/../..', '');
    const apiUrl = `http://localhost:${env.PORT || 3000}`;

    // los plugins de generación (paraglide) deben ir ANTES que sveltekit() para emitir el
    // runtime i18n antes de que kit procese los módulos.
    /** @type {import('vite').PluginOption[]} */
    const plugins = [...extraPlugins];
    if (i18n) {
      // import dinámico (peer-dep opcional): solo se carga si la app pide i18n. mismo
      // patrón que @vite-pwa/sveltekit más abajo.
      const { paraglideVitePlugin } = await import('@inlang/paraglide-js');
      const opts = i18n === true ? {} : i18n;
      plugins.push(
        paraglideVitePlugin({
          project: opts.project ?? './project.inlang',
          outdir: opts.outdir ?? './src/lib/paraglide',
          // el jsdoc tipa strategy como string[]; paraglide espera una union cerrada.
          // los valores por defecto pertenecen a esa union, así que se castea el arg.
          strategy: /** @type {('url'|'cookie'|'baseLocale'|'globalVariable'|'preferredLanguage'|'localStorage')[]} */ (
            opts.strategy ?? ['localStorage', 'preferredLanguage', 'baseLocale']
          ),
        }),
      );
    }
    plugins.push(sveltekit());
    if (pwa) {
      const { SvelteKitPWA } = await import('@vite-pwa/sveltekit');
      plugins.push(SvelteKitPWA(pwa));
    }

    return {
      plugins,
      server: {
        host: '127.0.0.1',
        proxy: Object.fromEntries(proxy.map((p) => [p, apiUrl])),
      },
    };
  });
}
