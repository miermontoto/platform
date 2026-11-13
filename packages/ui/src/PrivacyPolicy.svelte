<script module lang="ts">
  // política de privacidad compartida por todas las herramientas de la plataforma, sobre el
  // armazón DocPage (nombre, contacto e idioma salen de setDocShell). el copy por defecto refleja
  // lo que las apps tratan de verdad (ver @platform/auth y @platform/mobile): cuenta + sesiones
  // (token hasheado, fechas, user-agent) en sqlite local y diagnóstico técnico propio
  // (@platform/observability: errores y rendimiento, 14 días en el backend), sin analítica ni
  // sdks de terceros. cada app la monta en /privacy pasando, si usa login de terceros, su proveedor.
  //
  // bilingüe (es/en): sis va en inglés, duckhunt/carreterinas en español. el contenido específico
  // de una app (datos que sincroniza, servicios conectados) va en `extra`: secciones con su
  // entrada en el índice, tras las de por defecto.
  import type { DocLang } from './doc-shell';

  interface PrivacySection {
    // ancla estable entre idiomas
    id: string;
    title: string;
    // párrafos en texto plano; el token {email} se renderiza como enlace mailto
    body: string[];
  }

  // días que el backend de observabilidad conserva el diagnóstico técnico (tooling/observability)
  const DIAGNOSTICS_RETENTION_DAYS = 14;

  // textos de croma y resumen "de un vistazo" por idioma
  const PRIVACY_STRINGS: Record<
    DocLang,
    {
      title: string;
      kicker: string;
      glance: string;
      intro: (app: string) => string;
      glanceItems: (provider: string | null, analytics: boolean) => string[];
    }
  > = {
    es: {
      title: 'Política de privacidad',
      kicker: 'Legal',
      glance: 'De un vistazo',
      intro: (app) =>
        `En ${app} tratamos los menos datos posibles y solo los necesarios para que la herramienta funcione. Esta página explica qué recogemos, para qué y qué control tienes.`,
      glanceItems: (provider, analytics) => [
        provider
          ? `Entras con ${provider}: nunca vemos tu contraseña.`
          : 'Tu contraseña se guarda cifrada, nunca en claro.',
        analytics
          ? 'Solo medición propia, sin analítica de terceros.'
          : 'Sin analítica, rastreadores ni SDKs de terceros.',
        'Nunca vendemos tus datos ni los usamos para publicidad.',
        `El diagnóstico técnico se borra a los ${DIAGNOSTICS_RETENTION_DAYS} días.`,
        'Puedes pedir acceso, corrección o borrado cuando quieras.',
      ],
    },
    en: {
      title: 'Privacy policy',
      kicker: 'Legal',
      glance: 'At a glance',
      intro: (app) =>
        `${app} processes as little data as possible — only what the tool needs to work. This page explains what we collect, why, and what control you have.`,
      glanceItems: (provider, analytics) => [
        provider
          ? `You sign in with ${provider}: we never see your password.`
          : 'Your password is stored hashed, never in plain text.',
        analytics
          ? 'First-party measurement only, no third-party analytics.'
          : 'No third-party analytics, trackers or SDKs.',
        'We never sell your data or use it for advertising.',
        `Diagnostic data is deleted after ${DIAGNOSTICS_RETENTION_DAYS} days.`,
        'You can ask for access, correction or erasure at any time.',
      ],
    },
  };

  function sectionsEs(app: string, provider: string | null, analytics: boolean): PrivacySection[] {
    const login = provider
      ? `Para identificarte, ${app} usa el inicio de sesión de ${provider}. Recibimos de ${provider} únicamente los datos básicos de tu perfil necesarios para crear tu cuenta (identificador y, según el proveedor, nombre, correo o avatar). No accedemos a tu contraseña ni a más información de la que el proveedor expone para iniciar sesión.`
      : `Para acceder a ${app} creas una cuenta con tu correo y una contraseña. La contraseña se guarda siempre cifrada (hash), nunca en claro. Guardamos los datos mínimos necesarios para identificarte y prestarte el servicio.`;

    const tracking = analytics
      ? `${app} utiliza herramientas de medición propias para entender el uso del servicio y mejorarlo. No vendemos tus datos ni los usamos para publicidad de terceros.`
      : `${app} no incorpora analítica, rastreadores ni SDKs publicitarios de terceros. No vendemos ni cedemos tus datos, y no construimos perfiles con fines publicitarios.`;

    return [
      {
        id: 'controller',
        title: 'Responsable del tratamiento',
        body: [
          `El responsable del tratamiento de los datos que se recogen al usar ${app} es la persona que opera esta herramienta. Puedes contactar para cualquier cuestión de privacidad en {email}.`,
        ],
      },
      {
        id: 'data',
        title: 'Qué datos tratamos',
        body: [
          login,
          'Para mantener tu sesión iniciada guardamos un identificador de sesión (un token almacenado de forma hasheada), las fechas de inicio y caducidad de la sesión, y el identificador del navegador o dispositivo (user-agent). Esto te permite ver y cerrar tus sesiones activas desde los ajustes.',
          `Además tratamos los datos que generas al usar ${app}: el contenido y las acciones propias de la herramienta, necesarios para que funcione.`,
          'Para detectar y corregir fallos, la web y las apps envían a nuestro propio servidor datos técnicos de diagnóstico: los errores que se producen, los tiempos de carga y de respuesta, la pantalla en la que ocurren, las interacciones con la interfaz (qué controles se pulsan, nunca el texto que escribes), la versión de la app, el navegador o dispositivo y la dirección IP. Si has iniciado sesión, se asocian a tu cuenta.',
        ],
      },
      {
        id: 'use',
        title: 'Para qué los usamos',
        body: [
          'Usamos estos datos exclusivamente para autenticarte, mantener tu sesión, prestarte el servicio, mantener su seguridad (por ejemplo, detectar accesos no autorizados) y diagnosticar y corregir sus fallos. No los usamos para ninguna otra finalidad sin tu consentimiento.',
          tracking,
        ],
      },
      {
        id: 'storage',
        title: 'Dónde se guardan',
        body: [
          `Los datos se almacenan en la base de datos propia del servicio de ${app}, en su servidor. No se transfieren a terceros, salvo, en su caso, al proveedor de inicio de sesión durante la autenticación.`,
          'En la aplicación móvil, la sesión se guarda únicamente en tu dispositivo (almacenamiento nativo de la app) para mantenerte identificado entre usos.',
        ],
      },
      {
        id: 'retention',
        title: 'Cuánto tiempo los conservamos',
        body: [
          'Las sesiones caducan automáticamente y se eliminan al hacerlo o cuando cierras sesión. Los códigos temporales que se emiten durante el inicio de sesión en la app móvil viven solo unos segundos y se descartan tras un único uso.',
          'Los datos de tu cuenta se conservan mientras la mantengas activa. Si solicitas la baja, se eliminan salvo que debamos conservar algo por una obligación legal.',
          `Los datos técnicos de diagnóstico se eliminan automáticamente a los ${DIAGNOSTICS_RETENTION_DAYS} días.`,
        ],
      },
      {
        id: 'rights',
        title: 'Tus derechos',
        body: [
          'Puedes solicitar el acceso, la rectificación, la supresión y la portabilidad de tus datos, así como oponerte o limitar su tratamiento, conforme al Reglamento General de Protección de Datos (RGPD).',
          'Para ejercer cualquiera de estos derechos, o si tienes dudas sobre el tratamiento de tus datos, escribe a {email}. También puedes presentar una reclamación ante la autoridad de protección de datos competente.',
        ],
      },
      {
        id: 'mobile',
        title: 'Aplicaciones móviles',
        body: [
          `Las apps móviles de ${app} empaquetan la misma interfaz que la versión web y se comunican con el mismo servicio. Solicitan los permisos mínimos imprescindibles para funcionar y no recopilan datos del dispositivo más allá de lo descrito en esta política.`,
        ],
      },
      {
        id: 'changes',
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
        id: 'controller',
        title: 'Data controller',
        body: [
          `The controller of the data collected when you use ${app} is the person who operates this tool. For any privacy matter you can reach out at {email}.`,
        ],
      },
      {
        id: 'data',
        title: 'What data we process',
        body: [
          login,
          'To keep you signed in we store a session identifier (a token kept in hashed form), the session start and expiry dates, and your browser or device identifier (user-agent). This lets you review and revoke your active sessions from settings.',
          `We also process the data you generate while using ${app}: the content and actions that are part of the tool itself, needed for it to work.`,
          'To detect and fix problems, the web and mobile apps send technical diagnostic data to our own server: the errors that occur, load and response times, the screen where they happen, your interactions with the interface (which controls you tap or click, never the text you type), the app version, your browser or device and your IP address. If you are signed in, it is linked to your account.',
        ],
      },
      {
        id: 'use',
        title: 'How we use it',
        body: [
          'We use this data solely to authenticate you, keep your session, provide the service, keep it secure (for example, detecting unauthorized access) and diagnose and fix its problems. We do not use it for any other purpose without your consent.',
          tracking,
        ],
      },
      {
        id: 'storage',
        title: 'Where it is stored',
        body: [
          `Data is stored in ${app}'s own service database, on its server. It is not transferred to third parties, except, where applicable, to the sign-in provider during authentication.`,
          'In the mobile app, your session is stored only on your device (the app’s native storage) to keep you signed in between uses.',
        ],
      },
      {
        id: 'retention',
        title: 'How long we keep it',
        body: [
          'Sessions expire automatically and are deleted when they do, or when you log out. The temporary codes issued during sign-in on the mobile app live for only a few seconds and are discarded after a single use.',
          'Your account data is kept while your account stays active. If you ask to close it, the data is deleted unless we must retain something to meet a legal obligation.',
          `Technical diagnostic data is deleted automatically after ${DIAGNOSTICS_RETENTION_DAYS} days.`,
        ],
      },
      {
        id: 'rights',
        title: 'Your rights',
        body: [
          'You may request access, rectification, erasure and portability of your data, and object to or restrict its processing, under the General Data Protection Regulation (GDPR).',
          'To exercise any of these rights, or if you have questions about how your data is processed, write to {email}. You may also lodge a complaint with your competent data protection authority.',
        ],
      },
      {
        id: 'mobile',
        title: 'Mobile apps',
        body: [
          `${app}’s mobile apps bundle the same interface as the web version and talk to the same service. They request the minimum permissions required to work and collect no device data beyond what this policy describes.`,
        ],
      },
      {
        id: 'changes',
        title: 'Changes to this policy',
        body: [
          'If we change this policy, we will publish the updated version on this same page with its new last-updated date. We recommend reviewing it from time to time.',
        ],
      },
    ];
  }
</script>

<script lang="ts">
  import DocPage from './DocPage.svelte';
  import DocSection from './DocSection.svelte';
  import { getDocShell, type DocExtraSection } from './doc-shell';
  import { emailSegments } from './segments';

  let {
    updated = null,
    authProvider = null,
    analytics = false,
    lang,
    extra = [],
  }: {
    // fecha de última actualización (YYYY-MM-DD); si se omite no se muestra la línea
    updated?: string | Date | null;
    // proveedor de login de terceros (ej. 'Spotify'); null si la app gestiona credenciales
    // propias (email/contraseña)
    authProvider?: string | null;
    // true si la app usa analítica o sdks de terceros (default false: el copy afirma
    // explícitamente que no hay seguimiento)
    analytics?: boolean;
    // override del idioma del shell
    lang?: DocLang;
    // secciones propias de la app, tras las de por defecto
    extra?: DocExtraSection[];
  } = $props();

  const shell = getDocShell();
  const resolvedLang = $derived(lang ?? shell.lang ?? 'es');
  const strings = $derived(PRIVACY_STRINGS[resolvedLang]);
  const sections = $derived(
    (resolvedLang === 'en' ? sectionsEn : sectionsEs)(shell.appName, authProvider, analytics),
  );
  const glance = $derived(strings.glanceItems(authProvider, analytics));
</script>

<DocPage
  title={strings.title}
  kicker={strings.kicker}
  {updated}
  lang={resolvedLang}
  toc={[...sections, ...extra]}
>
  {#snippet intro()}<p>{strings.intro(shell.appName)}</p>{/snippet}

  {#snippet summary()}
    <p class="ui-privacy-glance-label">{strings.glance}</p>
    <ul class="ui-privacy-glance">
      {#each glance as item (item)}
        <li>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
          {item}
        </li>
      {/each}
    </ul>
  {/snippet}

  {#each sections as section (section.id)}
    <DocSection id={section.id} title={section.title}>
      {#each section.body as paragraph (paragraph)}
        <p>
          {#each emailSegments(paragraph, shell.contactEmail) as seg}
            {#if seg.kind === 'email'}<a href="mailto:{seg.value}">{seg.value}</a>{:else}{seg.value}{/if}
          {/each}
        </p>
      {/each}
    </DocSection>
  {/each}

  {#each extra as section (section.id)}
    <DocSection id={section.id} title={section.title}>{@render section.body()}</DocSection>
  {/each}
</DocPage>

<style>
  .ui-privacy-glance-label {
    margin: 0 0 0.75rem;
    font-family: var(--doc-mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--doc-muted);
  }
  .ui-privacy-glance {
    display: grid;
    gap: 0.6rem 1.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--ui-text, inherit);
  }
  .ui-privacy-glance li {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
  }
  .ui-privacy-glance svg {
    flex: none;
    width: 1rem;
    height: 1rem;
    margin-top: 0.1rem;
    fill: none;
    stroke: var(--doc-accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (min-width: 40rem) {
    .ui-privacy-glance {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
