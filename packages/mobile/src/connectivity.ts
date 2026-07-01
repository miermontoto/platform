// señal autoritativa de conectividad para los clientes móviles de la plataforma.
//
// por qué: en la app nativa las peticiones pasan por CapacitorHttp (fetch parcheado a
// capa nativa), y un fallo offline puede NO rechazar como el TypeError del browser ni
// reflejarse de forma fiable en navigator.onLine. @capacitor/network expone el estado
// real del sistema operativo. en web —o si el plugin no está instalado— caemos a
// navigator.onLine + los eventos online/offline de window.
//
// @capacitor/network es un peer OPCIONAL (mismo patrón que system-bars con status-bar /
// edge-to-edge): si la app no lo instala, todo degrada a navigator.onLine. seguro en web.
import { Capacitor } from '@capacitor/core';

// forma mínima del plugin que consumimos: evita depender del tipo del paquete, que puede
// no estar instalado por ser peer opcional.
interface NetworkStatus {
  connected: boolean;
}
interface NetworkPlugin {
  getStatus(): Promise<NetworkStatus>;
  addListener(
    event: 'networkStatusChange',
    cb: (status: NetworkStatus) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

// carga perezosa del plugin nativo; null si no es plataforma nativa o no está instalado.
async function loadNetwork(): Promise<NetworkPlugin | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = (await import('@capacitor/network')) as { Network: NetworkPlugin };
    return mod.Network;
  } catch {
    // plugin no instalado: sin señal nativa, se cae a navigator.onLine en isOnline().
    return null;
  }
}

// ¿navigator reporta conexión? true si no hay navigator (SSR): no bloquees por defecto.
function navigatorOnline(): boolean {
  return typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true;
}

/**
 * ¿hay conectividad ahora mismo? autoritativo vía @capacitor/network en la app nativa;
 * navigator.onLine como fallback (web o plugin ausente). úsalo como gate antes de decidir
 * si una petición sale a la red o se encola en el outbox offline.
 */
export async function isOnline(): Promise<boolean> {
  const net = await loadNetwork();
  if (net) return (await net.getStatus()).connected;
  return navigatorOnline();
}

/**
 * observa cambios de conectividad y devuelve una función de limpieza. en nativo escucha el
 * evento del plugin (si está instalado); en web, los eventos online/offline de window. el
 * callback recibe el nuevo estado (true = online). no-op si no hay ninguna señal disponible.
 */
export function observeConnectivity(onChange: (online: boolean) => void): () => void {
  if (Capacitor.isNativePlatform()) {
    let remove: (() => void) | null = null;
    let cancelled = false;
    void loadNetwork().then((net) => {
      if (cancelled || !net) return;
      void net
        .addListener('networkStatusChange', (status) => onChange(status.connected))
        .then((handle) => {
          if (cancelled) void handle.remove();
          else remove = () => void handle.remove();
        });
    });
    return () => {
      cancelled = true;
      if (remove) remove();
    };
  }
  // web: eventos del navegador.
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => onChange(navigatorOnline());
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
}
