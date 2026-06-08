// helper de i18n compartido por las apps de la plataforma. paraglide compila por proyecto,
// así que el runtime (getLocale/setLocale/locales) lo GENERA cada app; este factory lo
// recibe por inyección y le añade la lógica genérica (cambio de idioma con persistencia +
// recarga, y siembra desde la pref del servidor sin recargar). framework-agnóstico: no
// importa svelte ni nada de la app.

// forma del runtime generado por paraglide ($lib/paraglide/runtime) que necesitamos.
// getLocale/setLocale van como MÉTODOS (no propiedades-flecha) a propósito: el runtime los
// tipa con la locale estrecha del proyecto ('es'|'en'), y la comprobación bivariante de
// parámetros de los métodos permite asignarlos a esta forma con `string` sin error.
export interface ParaglideRuntime {
  getLocale(): string;
  setLocale(locale: string, options?: { reload?: boolean }): void;
  locales: readonly string[];
  baseLocale: string;
}

export interface CreateI18nOptions {
  // persiste la pref en el servidor (ej. PUT /api/user-settings). best-effort: si falla
  // (p.ej. visitante sin sesión en una landing → 401), se ignora. opcional.
  persist?: (locale: string) => Promise<unknown>;
}

export interface I18n {
  getLocale: () => string;
  locales: readonly string[];
  isLocale: (value: string) => boolean;
  // cambia el idioma activo: persiste (si hay persist) y luego setLocale (recarga por
  // defecto para re-renderizar toda la app — cambiar idioma es infrecuente).
  switchLanguage: (locale: string) => Promise<void>;
  // siembra el idioma desde la pref guardada del usuario SIN recargar: llamar en boot antes
  // de pintar la app. solo actúa si difiere del locale ya resuelto por el cliente.
  seedLocaleFromServer: (serverLang: string | null | undefined) => void;
}

export function createI18n(runtime: ParaglideRuntime, { persist }: CreateI18nOptions = {}): I18n {
  const isLocale = (value: string): boolean => runtime.locales.includes(value);

  return {
    getLocale: runtime.getLocale,
    locales: runtime.locales,
    isLocale,
    async switchLanguage(locale: string): Promise<void> {
      if (!isLocale(locale) || locale === runtime.getLocale()) return;
      if (persist) await persist(locale).catch(() => undefined);
      runtime.setLocale(locale); // estrategia localStorage: persiste; reload re-renderiza
    },
    seedLocaleFromServer(serverLang: string | null | undefined): void {
      if (!serverLang || !isLocale(serverLang) || serverLang === runtime.getLocale()) return;
      runtime.setLocale(serverLang, { reload: false });
    },
  };
}
