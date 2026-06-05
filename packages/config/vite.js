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
 */
export function createPwaOptions({
  name,
  shortName,
  description = '',
  themeColor = '#080a0c',
  shortcuts = [],
  networkOnly = ['/api/', '/auth/'],
}) {
  const icon192 = { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' };
  const icon512 = { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' };
  return {
    registerType: 'autoUpdate',
    strategies: 'generateSW',
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
      icons: [icon192, icon512, { ...icon512, purpose: 'maskable' }],
      shortcuts: shortcuts.map(({ name: n, url }) => ({
        name: n,
        url,
        icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
      })),
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
      navigateFallback: '200.html',
      navigateFallbackDenylist: networkOnly.map((p) => new RegExp(`^${p.replace(/\/$/, '')}/`)),
      runtimeCaching: networkOnly.map((prefix) => ({
        urlPattern: (/** @type {{ url: URL }} */ ctx) => ctx.url.pathname.startsWith(prefix),
        handler: 'NetworkOnly',
      })),
    },
    devOptions: {
      enabled: false,
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
 */
export function createWebConfig({ pwa, proxy = ['/api', '/auth'], envDir } = {}) {
  return defineConfig(async ({ mode }) => {
    const env = loadEnv(mode, envDir ?? process.cwd() + '/../..', '');
    const apiUrl = `http://localhost:${env.PORT || 3000}`;

    /** @type {import('vite').PluginOption[]} */
    const plugins = [sveltekit()];
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
