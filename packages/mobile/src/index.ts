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
  // color de fondo de la app (hex): pinta el área de las system bars para que
  // los márgenes de edge-to-edge se fundan con el tema (default '#000000')
  backgroundColor?: string;
  // directorio del build estático de sveltekit (default 'build')
  webDir?: string;
  // overrides puntuales sobre los defaults
  overrides?: Partial<CapacitorConfig>;
}

export function createCapacitorConfig({
  appId,
  appName,
  backgroundColor = '#000000',
  webDir = 'build',
  overrides = {},
}: PlatformMobileOptions): CapacitorConfig {
  return {
    appId,
    appName,
    webDir,
    backgroundColor,
    server: {
      // origen https://localhost: scheme seguro, cookies y storage estables
      androidScheme: 'https',
    },
    android: {
      // android 15 (sdk 35) fuerza edge-to-edge: el webview dibujaría debajo de
      // la status bar y la nav bar, y el webview android no expone
      // env(safe-area-inset-*). márgenes nativos automáticos en su lugar.
      adjustMarginsForEdgeToEdge: 'auto',
    },
    plugins: {
      // fetch/XHR via capa nativa: cookie jar nativo, sin CORS en llamadas a la api
      CapacitorHttp: { enabled: true },
      CapacitorCookies: { enabled: true },
    },
    ...overrides,
  };
}
