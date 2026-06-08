<script module lang="ts">
  // política de privacidad compartida por todas las herramientas de la plataforma.
  // el copy por defecto refleja lo que las apps tratan de verdad (ver @platform/auth
  // y @platform/mobile): cuenta + sesiones (token hasheado, fechas, user-agent) en
  // sqlite local, sin analítica ni sdks de terceros. cada app la monta en /privacy
  // pasando su nombre, contacto y, si usa login de terceros, su proveedor.
  //
  // bilingüe (es/en): sis va en inglés, duckhunt/carreterinas en español. para
  // contenido específico de una app (datos que sincroniza, servicios conectados)
  // se le pasa un snippet `children` que se renderiza tras las secciones.
  export type PrivacyLang = 'es' | 'en';

  export interface PrivacySection {
    title: string;
    // párrafos en texto plano; el token {email} se renderiza como enlace mailto
    body: string[];
  }

  export interface PrivacyDefaultsOptions {
    appName: string;
    lang?: PrivacyLang;
    // proveedor de login de terceros (ej. 'Spotify'); null si la app gestiona
    // credenciales propias (email/contraseña)
    authProvider?: string | null;
    // true si la app usa analítica o sdks de terceros (default false: el copy
    // afirma explícitamente que no hay seguimiento)
    analytics?: boolean;
  }

  // textos de chrome (título, intro, etiqueta de fecha) por idioma
  export const PRIVACY_STRINGS: Record<PrivacyLang, { title: string; updated: string; intro: (app: string) => string }> = {
    es: {
      title: 'Política de privacidad',
      updated: 'Última actualización',
      intro: (app) =>
        `En ${app} tratamos los menos datos posibles y solo los necesarios para que la herramienta funcione. Esta página explica qué recogemos, para qué y qué control tienes.`,
    },
    en: {
      title: 'Privacy policy',
      updated: 'Last updated',
      intro: (app) =>
        `${app} processes as little data as possible — only what the tool needs to work. This page explains what we collect, why, and what control you have.`,
    },
  };

  // secciones por defecto, derivadas de los datos reales que trata la plataforma.
  // exportada para que una app haga spread y retoque (`defaultPrivacySections(o)`
  // y luego edita/añade) en vez de reescribir la política entera.
  export function defaultPrivacySections({
    appName,
    lang = 'es',
    authProvider = null,
    analytics = false,
  }: PrivacyDefaultsOptions): PrivacySection[] {
    return lang === 'en'
      ? sectionsEn(appName, authProvider, analytics)
      : sectionsEs(appName, authProvider, analytics);
  }

  function sectionsEs(app: string, provider: string | null, analytics: boolean): PrivacySection[] {
    const login = provider
      ? `Para identificarte, ${app} usa el inicio de sesión de ${provider}. Recibimos de ${provider} únicamente los datos básicos de tu perfil necesarios para crear tu cuenta (identificador y, según el proveedor, nombre, correo o avatar). No accedemos a tu contraseña ni a más información de la que el proveedor expone para iniciar sesión.`
      : `Para acceder a ${app} creas una cuenta con tu correo y una contraseña. La contraseña se guarda siempre cifrada (hash), nunca en claro. Guardamos los datos mínimos necesarios para identificarte y prestarte el servicio.`;

    const tracking = analytics
      ? `${app} utiliza herramientas de medición propias para entender el uso del servicio y mejorarlo. No vendemos tus datos ni los usamos para publicidad de terceros.`
      : `${app} no incorpora analítica, rastreadores ni SDKs publicitarios de terceros. No vendemos ni cedemos tus datos, y no construimos perfiles con fines publicitarios.`;

    return [
      {
        title: 'Responsable del tratamiento',
        body: [
          `El responsable del tratamiento de los datos que se recogen al usar ${app} es la persona que opera esta herramienta. Puedes contactar para cualquier cuestión de privacidad en {email}.`,
        ],
      },
      {
        title: 'Qué datos tratamos',
        body: [
          login,
          'Para mantener tu sesión iniciada guardamos un identificador de sesión (un token almacenado de forma hasheada), las fechas de inicio y caducidad de la sesión, y el identificador del navegador o dispositivo (user-agent). Esto te permite ver y cerrar tus sesiones activas desde los ajustes.',
          `Además tratamos los datos que generas al usar ${app}: el contenido y las acciones propias de la herramienta, necesarios para que funcione.`,
        ],
      },
      {
        title: 'Para qué los usamos',
        body: [
          'Usamos estos datos exclusivamente para autenticarte, mantener tu sesión, prestarte el servicio y mantener su seguridad (por ejemplo, detectar accesos no autorizados). No los usamos para ninguna otra finalidad sin tu consentimiento.',
          tracking,
        ],
      },
      {
        title: 'Dónde se guardan',
        body: [
          `Los datos se almacenan en la base de datos propia del servicio de ${app}, en su servidor. No se transfieren a terceros, salvo, en su caso, al proveedor de inicio de sesión durante la autenticación.`,
          'En la aplicación móvil, la sesión se guarda únicamente en tu dispositivo (almacenamiento nativo de la app) para mantenerte identificado entre usos.',
        ],
      },
      {
        title: 'Cuánto tiempo los conservamos',
        body: [
          'Las sesiones caducan automáticamente y se eliminan al hacerlo o cuando cierras sesión. Los códigos temporales que se emiten durante el inicio de sesión en la app móvil viven solo unos segundos y se descartan tras un único uso.',
          'Los datos de tu cuenta se conservan mientras la mantengas activa. Si solicitas la baja, se eliminan salvo que debamos conservar algo por una obligación legal.',
        ],
      },
      {
        title: 'Tus derechos',
        body: [
          'Puedes solicitar el acceso, la rectificación, la supresión y la portabilidad de tus datos, así como oponerte o limitar su tratamiento, conforme al Reglamento General de Protección de Datos (RGPD).',
          'Para ejercer cualquiera de estos derechos, o si tienes dudas sobre el tratamiento de tus datos, escribe a {email}. También puedes presentar una reclamación ante la autoridad de protección de datos competente.',
        ],
      },
      {
        title: 'Aplicaciones móviles',
        body: [
          `Las apps móviles de ${app} empaquetan la misma interfaz que la versión web y se comunican con el mismo servicio. Solicitan los permisos mínimos imprescindibles para funcionar y no recopilan datos del dispositivo más allá de lo descrito en esta política.`,
        ],
      },
      {
        title: 'Cambios en esta política',
        body: [
          'Si cambiamos esta política, publicaremos la versión actualizada en esta misma página con su nueva fecha de actualización. Te recomendamos revisarla de vez en cuando.',
        ],
      },
    ];
  }

  function sectionsEn(app: string, provider: string | null, analytics: boolean): PrivacySection[] {
    const login = provider
      ? `To identify you, ${app} uses ${provider} sign-in. From ${provider} we receive only the basic profile data needed to create your account (an identifier and, depending on the provider, your name, email or avatar). We never see your password or any information beyond what the provider exposes for signing in.`
      : `To use ${app} you create an account with your email and a password. The password is always stored hashed, never in plain text. We keep the minimum data needed to identify you and provide the service.`;

    const tracking = analytics
      ? `${app} uses first-party measurement to understand usage and improve the service. We do not sell your data or use it for third-party advertising.`
      : `${app} ships no third-party analytics, trackers or advertising SDKs. We do not sell or share your data, and we do not build advertising profiles.`;

    return [
      {
        title: 'Data controller',
        body: [
          `The controller of the data collected when you use ${app} is the person who operates this tool. For any privacy matter you can reach out at {email}.`,
        ],
      },
      {
        title: 'What data we process',
        body: [
          login,
          'To keep you signed in we store a session identifier (a token kept in hashed form), the session start and expiry dates, and your browser or device identifier (user-agent). This lets you review and revoke your active sessions from settings.',
          `We also process the data you generate while using ${app}: the content and actions that are part of the tool itself, needed for it to work.`,
        ],
      },
      {
        title: 'How we use it',
        body: [
          'We use this data solely to authenticate you, keep your session, provide the service and keep it secure (for example, detecting unauthorized access). We do not use it for any other purpose without your consent.',
          tracking,
        ],
      },
      {
        title: 'Where it is stored',
        body: [
          `Data is stored in ${app}'s own service database, on its server. It is not transferred to third parties, except, where applicable, to the sign-in provider during authentication.`,
          'In the mobile app, your session is stored only on your device (the app’s native storage) to keep you signed in between uses.',
        ],
      },
      {
        title: 'How long we keep it',
        body: [
          'Sessions expire automatically and are deleted when they do, or when you log out. The temporary codes issued during sign-in on the mobile app live for only a few seconds and are discarded after a single use.',
          'Your account data is kept while your account stays active. If you ask to close it, the data is deleted unless we must retain something to meet a legal obligation.',
        ],
      },
      {
        title: 'Your rights',
        body: [
          'You may request access, rectification, erasure and portability of your data, and object to or restrict its processing, under the General Data Protection Regulation (GDPR).',
          'To exercise any of these rights, or if you have questions about how your data is processed, write to {email}. You may also lodge a complaint with your competent data protection authority.',
        ],
      },
      {
        title: 'Mobile apps',
        body: [
          `${app}’s mobile apps bundle the same interface as the web version and talk to the same service. They request the minimum permissions required to work and collect no device data beyond what this policy describes.`,
        ],
      },
      {
        title: 'Changes to this policy',
        body: [
          'If we change this policy, we will publish the updated version on this same page with its new last-updated date. We recommend reviewing it from time to time.',
        ],
      },
    ];
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    appName,
    contactEmail,
    lang = 'es',
    updated = null,
    authProvider = null,
    analytics = false,
    title = null,
    intro = null,
    sections = null,
    children = null,
  }: {
    appName: string;
    contactEmail: string;
    lang?: PrivacyLang;
    // fecha de última actualización; si se omite no se muestra la línea
    updated?: Date | string | number | null;
    authProvider?: string | null;
    analytics?: boolean;
    // override del título/intro por defecto del idioma
    title?: string | null;
    intro?: string | null;
    // reemplaza por completo las secciones por defecto; si null se usan las de
    // defaultPrivacySections() con los props de esta instancia
    sections?: PrivacySection[] | null;
    // contenido extra específico de la app, renderizado tras las secciones
    children?: Snippet | null;
  } = $props();

  const strings = $derived(PRIVACY_STRINGS[lang]);
  const resolvedTitle = $derived(title ?? strings.title);
  const resolvedIntro = $derived(intro ?? strings.intro(appName));
  const resolved = $derived(
    sections ?? defaultPrivacySections({ appName, lang, authProvider, analytics }),
  );

  const updatedLabel = $derived.by(() => {
    if (updated == null) return null;
    const d = updated instanceof Date ? updated : new Date(updated);
    return Number.isNaN(d.getTime())
      ? null
      : new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(d);
  });

  // parte un párrafo en torno a {email}: se renderiza como enlace mailto. evita
  // tener que meter html en el copy declarativo.
  function segments(text: string): { kind: 'text' | 'email'; value: string }[] {
    const out: { kind: 'text' | 'email'; value: string }[] = [];
    for (const chunk of text.split(/(\{email\})/)) {
      if (chunk === '') continue;
      out.push(chunk === '{email}' ? { kind: 'email', value: contactEmail } : { kind: 'text', value: chunk });
    }
    return out;
  }
</script>

<article class="ui-privacy">
  <header>
    <h1>{resolvedTitle}</h1>
    {#if updatedLabel}<p class="ui-privacy-updated">{strings.updated}: {updatedLabel}</p>{/if}
  </header>

  {#if resolvedIntro}<p class="ui-privacy-intro">{resolvedIntro}</p>{/if}

  {#each resolved as section (section.title)}
    <section>
      <h2>{section.title}</h2>
      {#each section.body as paragraph (paragraph)}
        <p>
          {#each segments(paragraph) as seg}
            {#if seg.kind === 'email'}<a href="mailto:{seg.value}">{seg.value}</a>{:else}{seg.value}{/if}
          {/each}
        </p>
      {/each}
    </section>
  {/each}

  {#if children}{@render children()}{/if}
</article>

<style>
  .ui-privacy {
    max-width: var(--ui-prose-width, 42rem);
    color: var(--ui-text, inherit);
    line-height: 1.6;
  }
  .ui-privacy header {
    margin-bottom: var(--ui-section-gap, 1.5rem);
  }
  .ui-privacy h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .ui-privacy-updated {
    margin: 0.35rem 0 0;
    font-size: 0.75rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
  .ui-privacy-intro {
    margin: 0 0 var(--ui-section-gap, 1.5rem);
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 70%, transparent));
  }
  .ui-privacy section {
    margin-bottom: var(--ui-section-gap, 1.5rem);
  }
  .ui-privacy h2 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }
  .ui-privacy p {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
  }
  .ui-privacy section p:last-child {
    margin-bottom: 0;
  }
  .ui-privacy a {
    color: var(--ui-accent, inherit);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
</style>
