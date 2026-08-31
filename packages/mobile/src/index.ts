// shell móvil de la plataforma: config de capacitor con los defaults comunes.
//
// modelo: la spa estática (adapter-static, la misma que sirve la api) se empaqueta
// DENTRO de la app; las llamadas a la api van al dominio público de cada app via
// VITE_API_BASE (inyectada en el build móvil, ver scripts mobile:* de cada web).
//
// auth: CapacitorHttp parchea fetch a nivel nativo, con cookie jar nativo — las
// cookies de sesión viajan sin pelear con CORS/SameSite del webview. el oauth de
// terceros (sis/spotify, duckhunt/atlassian) usa browser del sistema + deep links:
// ver deep-link.ts.
//
// plataformas: esta config es cross-platform. el bloque `android:` y el plugin
// EdgeToEdge son android-scoped (no-op en ios, que sí expone env(safe-area-inset-*)
// nativo en su webview, sin necesidad del hack de márgenes). ios usa su scheme
// seguro por defecto (capacitor://localhost), así que no necesita iosScheme:'https'.
// StatusBar y CapacitorHttp/Cookies aplican igual en ambas.
import type { CapacitorConfig } from '@capacitor/cli';
import { isDarkColor } from './color';

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
      // env(safe-area-inset-*). el plugin capawesome (EdgeToEdge, abajo) aplica
      // márgenes nativos al webview en su lugar. 'disable' apaga el gestor de
      // insets del PROPIO capacitor: si no, ambos registran un
      // OnApplyWindowInsetsListener sobre el mismo webview (el segundo reemplaza
      // al primero, carrera de orden) y el del core no gestiona el inset del
      // teclado (ime) mientras el de capawesome sí → teclado tapando inputs.
      // capawesome queda como única autoridad de insets (incl. ime) y coloreado.
      adjustMarginsForEdgeToEdge: 'disable',
    },
    plugins: {
      // fetch/XHR via capa nativa: cookie jar nativo, sin CORS en llamadas a la api
      CapacitorHttp: { enabled: true },
      CapacitorCookies: { enabled: true },
      // contraste de los iconos de la status bar acorde al tema. SOLO aplica a las
      // apps que instalan @capacitor/status-bar; las que implementan su propio
      // plugin 'SystemBars' (ver system-bars.ts) ignoran este bloque y fijan el
      // estilo en runtime.
      // backgroundColor aplica en android < 15; en 15+ la barra es transparente y
      // se ve el fondo de la ventana.
      StatusBar: {
        style: statusBarStyle ?? (isDarkColor(backgroundColor) ? 'DARK' : 'LIGHT'),
        backgroundColor,
      },
      // color del área de ambas system bars desde el primer frame en android 15+
      // (requiere @capawesome/capacitor-android-edge-to-edge-support en la app).
      // el recoloreo posterior a la carga —y en cada cambio de tema— lo hace el
      // helper de runtime: import desde '@platform/mobile/system-bars'.
      EdgeToEdge: {
        backgroundColor,
      },
    },
    ...overrides,
  };
}
