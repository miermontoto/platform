// glue de oauth móvil para los clientes web: abrir el login en el browser del
// sistema (custom tab) y recibir el deep link de vuelta con el código de canje.
//
// flujo: openExternalLogin(url?mobile=1) → oauth en el browser → el server
// redirige a <scheme>://auth/callback?code=... → android abre la app →
// onAuthDeepLink invoca el callback con la URL parseada. el caller canjea el
// código contra la api (POST /auth/mobile/exchange) y la cookie de sesión
// queda en el cookie jar nativo (CapacitorHttp).
//
// requiere @capacitor/app y @capacitor/browser en la app consumidora, y el
// intent-filter del scheme en AndroidManifest.xml.
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

/** abre la url de login en el browser del sistema (custom tab). */
export async function openExternalLogin(url: string): Promise<void> {
  await Browser.open({ url });
}

/**
 * registra el listener de deep links de auth para un scheme. cierra el custom
 * tab y entrega la URL parseada (searchParams incluidos) al callback.
 */
export async function onAuthDeepLink(
  scheme: string,
  onCallback: (url: URL) => void | Promise<void>,
): Promise<void> {
  await App.addListener('appUrlOpen', ({ url }) => {
    if (!url.startsWith(`${scheme}://`)) return;
    // cerrar el custom tab para volver a la app; best-effort
    Browser.close().catch(() => undefined);
    void onCallback(new URL(url));
  });
}
