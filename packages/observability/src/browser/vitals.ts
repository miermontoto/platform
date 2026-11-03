// core web vitals (lcp, inp, cls) + fcp y ttfb con la librería de google: inp y cls tienen
// demasiados casos raros (bfcache, prerender, pestaña en segundo plano) para medirlos a mano.
// la build de atribución añade qué elemento o interacción causó el valor, lo que hace falta
// para arreglarlo. se carga con import dinámico: sus observers usan entradas `buffered`, así
// que llegar tarde no pierde nada y su código no pesa en el arranque.
//
// sin soft navigations, todas las métricas son de la carga del documento (cls e inp acumulan
// la sesión entera): van con la ruta de aterrizaje, no con la actual.
import type { MetricWithAttribution } from 'web-vitals/attribution';
import type { WireAttrs } from '../wire.js';
import { whenLanded } from './spans.js';
import { enqueueEvent, now } from './transport.js';

const SCOPE = 'web-vitals';
// cls es adimensional (fracción de viewport); el resto son ms
const UNITLESS = new Set(['CLS']);
const CLS_DECIMALS = 1000;

const defined = (attrs: Record<string, string | number | undefined>): WireAttrs =>
  Object.fromEntries(Object.entries(attrs).filter((entry): entry is [string, string | number] => entry[1] !== undefined));

// subpartes que explican cada métrica (lo que hay que atacar) y el elemento responsable
const attribution = (metric: MetricWithAttribution): WireAttrs => {
  switch (metric.name) {
    case 'LCP': {
      const a = metric.attribution;
      return defined({
        'web_vital.target': a.target,
        'web_vital.lcp.ttfb_ms': Math.round(a.timeToFirstByte),
        'web_vital.lcp.load_delay_ms': Math.round(a.resourceLoadDelay),
        'web_vital.lcp.load_duration_ms': Math.round(a.resourceLoadDuration),
        'web_vital.lcp.render_delay_ms': Math.round(a.elementRenderDelay),
      });
    }
    case 'INP': {
      const a = metric.attribution;
      return defined({
        'web_vital.target': a.interactionTarget,
        'web_vital.inp.type': a.interactionType,
        'web_vital.inp.input_delay_ms': Math.round(a.inputDelay),
        'web_vital.inp.processing_ms': Math.round(a.processingDuration),
        'web_vital.inp.presentation_ms': Math.round(a.presentationDelay),
        'web_vital.load_state': a.loadState,
      });
    }
    case 'CLS':
      return defined({ 'web_vital.target': metric.attribution.largestShiftTarget, 'web_vital.load_state': metric.attribution.loadState });
    default:
      return {};
  }
};

const report = (metric: MetricWithAttribution): void => {
  const value = UNITLESS.has(metric.name) ? Math.round(metric.value * CLS_DECIMALS) / CLS_DECIMALS : Math.round(metric.value);
  const time = now();
  // ttfb (y a veces fcp) llega antes de que kit pinte la primera ruta: espera a saber cuál es
  whenLanded((route) =>
    enqueueEvent({
      time,
      level: 'info',
      scope: SCOPE,
      msg: `${metric.name} ${value}${UNITLESS.has(metric.name) ? '' : 'ms'} ${metric.rating}`,
      attrs: {
        'web_vital.name': metric.name,
        'web_vital.value': value,
        'web_vital.rating': metric.rating,
        'web_vital.navigation_type': metric.navigationType,
        ...(route && { 'app.route': route }),
        ...attribution(metric),
      },
    }),
  );
};

export function observeVitals(): void {
  import('web-vitals/attribution')
    .then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => [onLCP, onINP, onCLS, onFCP, onTTFB].forEach((on) => on(report)))
    .catch(() => undefined);
}
