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

// luminancia relativa aproximada de un hex (#rgb o #rrggbb) → ¿tema oscuro?
function isDarkColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

export interface PlatformMobileOptions {
  // id de aplicación android/ios (dominio inverso, ej. 'es.carreterinas.app')
  appId: string;
  // nombre visible de la app
  appName: string;
  // color de fondo de la app (hex): pinta el área de las system bars para que
  // los márgenes de edge-to-edge se fundan con el tema (default '#000000')
  backgroundColor?: string;
  // estilo de la status bar ('DARK' = fondo oscuro → iconos claros). si se
  // omite, se deriva de la luminancia de backgroundColor
  statusBarStyle?: 'DARK' | 'LIGHT';
  // directorio del build estático de sveltekit (default 'build')
  webDir?: string;
  // overrides puntuales sobre los defaults
  overrides?: Partial<CapacitorConfig>;
}

export function createCapacitorConfig({
  appId,
  appName,
  backgroundColor = '#000000',
  statusBarStyle,
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
      // contraste de los iconos de la status bar acorde al tema (requiere
      // @capacitor/status-bar en la app). backgroundColor aplica en android < 15;
      // en 15+ la barra es transparente y se ve el fondo de la ventana.
      StatusBar: {
        style: statusBarStyle ?? (isDarkColor(backgroundColor) ? 'DARK' : 'LIGHT'),
        backgroundColor,
      },
    },
    ...overrides,
  };
}
