// contrato de la telemetría de cliente (web y apps nativas → api de la propia app). lo
// comparten el sdk de navegador, que produce los lotes, y la ruta de ingesta, que los valida
// y los mete en el export otlp. sin imports de node ni del dom: los dos lados lo importan tal cual.

/** ruta de ingesta en la api de cada app. pre-auth: la monta createPlatformApp antes del gate. */
export const CLIENT_TELEMETRY_PATH = '/api/_client';

/** topes de un lote: el cliente los respeta al construirlo y el servidor los vuelve a imponer. */
export const WIRE_LIMITS = {
  // bytes del body, por debajo de la cuota de 64 KiB de fetch con keepalive
  bodyBytes: 60 * 1024,
  spans: 100,
  events: 50,
  attrs: 24,
  // longitud de mensajes, nombres y valores de atributo; el stack tiene la suya
  string: 1024,
  stack: 8192,
} as const;

export type WireAttrs = Record<string, string | number | boolean>;
export type WirePlatform = 'web' | 'ios' | 'android';
export type WireLevel = 'info' | 'warn' | 'error';
export type WireSpanKind = 'internal' | 'client';

export interface WireSpan {
  // 32 hex (traza) y 16 hex (span), formato w3c
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  kind: WireSpanKind;
  // epoch ms con decimales (performance.timeOrigin + performance.now())
  start: number;
  end: number;
  // motivo del fallo; ausente si el span acabó bien
  error?: string;
  attrs?: WireAttrs;
}

export interface WireError {
  type: string;
  message: string;
  stack?: string;
}

export interface WireEvent {
  time: number;
  level: WireLevel;
  // como el [scope] de los logs del servidor: 'client', 'web-vitals'
  scope: string;
  msg: string;
  // span activo al ocurrir (navegación o fetch en curso): correlaciona el evento con su traza
  traceId?: string;
  spanId?: string;
  attrs?: WireAttrs;
  error?: WireError;
}

export interface WireBatch {
  // versión del bundle: la app nativa o una pestaña abierta antes de un deploy corren uno
  // anterior al de la api, así que el servidor no puede suponerla
  version?: string;
  platform: WirePlatform;
  // id aleatorio por carga de página: agrupa todo lo que ocurre en una misma pestaña
  session: string;
  // reloj del cliente al enviar (el mismo que fecha los spans): el servidor corrige con él
  // la deriva del dispositivo
  sentAt: number;
  spans: WireSpan[];
  events: WireEvent[];
}

/** recorta un string al tope dado (los dos lados lo aplican: el cliente para no inflar el body). */
export const clip = (value: string, max: number = WIRE_LIMITS.string): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
