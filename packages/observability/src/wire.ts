// contrato entre el sdk de navegador y la api: la ruta a la que el rum de openobserve manda sus
// lotes (opción `proxy` del sdk) y los topes que la api impone al reenviarlos. sin imports de node
// ni del dom, para que los dos lados lo importen tal cual.

/** proxy de rum en la api de cada app. pre-auth: lo monta createPlatformApp antes del gate. */
export const RUM_PROXY_PATH = '/api/_rum';

/** topes de un lote del sdk al pasar por el proxy. */
export const RUM_LIMITS = {
  // el sdk parte los lotes en 16 KiB y un evento suelto llega a 256 KiB: margen sobre eso
  bodyBytes: 512 * 1024,
  // eventos por lote que se reescriben (usr.id); por encima el lote se rechaza
  events: 2000,
} as const;
