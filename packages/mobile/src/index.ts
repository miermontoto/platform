// shell móvil de la plataforma: config de capacitor con los defaults comunes.
//
// modelo: la spa estática (adapter-static, la misma que sirve la api) se empaqueta
// DENTRO de la app; las llamadas a la api van al dominio público de cada app via
// VITE_API_BASE (inyectada en el build móvil, ver scripts mobile:* de cada web).
//
// auth: CapacitorHttp parchea fetch a nivel nativo, con cookie jar nativo — las
// cookies de sesión viajan sin pelear con CORS/SameSite del webview. cuando haya
// oauth de terceros (sis/spotify, duckhunt/atlassian) hará falta browser del
// sistema + deep links; pendiente en el roadmap.
import type { CapacitorConfig } from '@capacitor/cli';

export interface PlatformMobileOptions {
  // id de aplicación android/ios (dominio inverso, ej. 'es.carreterinas.app')
  appId: string;
  // nombre visible de la app
  appName: string;
  // directorio del build estático de sveltekit (default 'build')
  webDir?: string;
  // overrides puntuales sobre los defaults
  overrides?: Partial<CapacitorConfig>;
}

export function createCapacitorConfig({
  appId,
  appName,
  webDir = 'build',
  overrides = {},
}: PlatformMobileOptions): CapacitorConfig {
  return {
    appId,
    appName,
    webDir,
    server: {
      // origen https://localhost: scheme seguro, cookies y storage estables
      androidScheme: 'https',
    },
    plugins: {
      // fetch/XHR via capa nativa: cookie jar nativo, sin CORS en llamadas a la api
      CapacitorHttp: { enabled: true },
      CapacitorCookies: { enabled: true },
    },
    ...overrides,
  };
}
