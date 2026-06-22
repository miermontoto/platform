<script module lang="ts">
  // página de soporte compartida por todas las herramientas de la plataforma.
  // App Store y Play exigen una URL de soporte pública; en vez de reescribirla en
  // cada app (duckhunt, sis, carreterinas), cada una monta esta en /support
  // pasando su nombre, contacto y un FAQ propio. el copy por defecto (contacto +
  // borrado de cuenta, comunes a toda la plataforma) es bilingüe es/en; el FAQ
  // específico de la app se pasa por `faq`. hermana de PrivacyPolicy.svelte.
  export type SupportLang = 'es' | 'en';

  // pregunta/respuesta; en `a` el token {email} se renderiza como enlace mailto
  export interface SupportFaqItem {
    q: string;
    a: string;
  }

  // textos de chrome por idioma. {app}/{email}/{days} se interpolan.
  export const SUPPORT_STRINGS: Record<
    SupportLang,
    {
      title: string;
      intro: (app: string) => string;
      contactHeading: string;
      contactLine: string; // contiene {email}
      response: (days: string) => string;
      faqHeading: string;
      privacyLink: string; // contiene el ancla a la política
      defaultResponseDays: string;
    }
  > = {
    es: {
      title: 'Soporte',
      intro: (app) => `¿Necesitas ayuda con ${app}? Escríbenos y te respondemos.`,
      contactHeading: 'Contacto',
      contactLine: 'Correo: {email}',
      response: (days) => `Solemos responder en ${days}.`,
      faqHeading: 'Preguntas frecuentes',
      privacyLink: 'Consulta también nuestra política de privacidad.',
      defaultResponseDays: 'uno o dos días laborables',
    },
    en: {
      title: 'Support',
      intro: (app) => `Need help with ${app}? Reach out and we'll get back to you.`,
      contactHeading: 'Contact',
      contactLine: 'Email: {email}',
      response: (days) => `We usually reply within ${days}.`,
      faqHeading: 'FAQ',
      privacyLink: 'See also our privacy policy.',
      defaultResponseDays: 'one or two business days',
    },
  };

  // FAQ por defecto: solo lo común a toda la plataforma (borrado de cuenta/datos,
  // requisito RGPD que toda app con cuentas debe ofrecer). lo específico de la app
  // (qué hace, cómo se usa) se pasa por `faq` y reemplaza este default.
  export function defaultSupportFaq(lang: SupportLang): SupportFaqItem[] {
    return lang === 'en'
      ? [
          {
            q: 'How do I delete my account and data?',
            a: 'Email us at {email} from your account address and we will delete your account and its associated data.',
          },
        ]
      : [
          {
            q: '¿Cómo elimino mi cuenta y mis datos?',
            a: 'Escríbenos a {email} desde el correo de tu cuenta y eliminamos la cuenta y sus datos asociados.',
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
    responseDays = null,
    privacyHref = '/privacy',
    title = null,
    intro = null,
    faq = null,
    children = null,
  }: {
    appName: string;
    contactEmail: string;
    lang?: SupportLang;
    // tiempo de respuesta legible; si null se usa el por defecto del idioma
    responseDays?: string | null;
    // ancla a la política de privacidad; null oculta la línea
    privacyHref?: string | null;
    // override del título/intro por defecto del idioma
    title?: string | null;
    intro?: string | null;
    // FAQ de la app; reemplaza el FAQ por defecto (solo borrado de cuenta). null
    // usa defaultSupportFaq(lang)
    faq?: SupportFaqItem[] | null;
    // contenido extra específico de la app, tras el FAQ y antes del enlace a privacidad
    children?: Snippet | null;
  } = $props();

  const strings = $derived(SUPPORT_STRINGS[lang]);
  const resolvedTitle = $derived(title ?? strings.title);
  const resolvedIntro = $derived(intro ?? strings.intro(appName));
  const resolvedDays = $derived(responseDays ?? strings.defaultResponseDays);
  const resolvedFaq = $derived(faq ?? defaultSupportFaq(lang));

  // parte un texto en torno a {email}: se renderiza como enlace mailto. evita
  // meter html en el copy declarativo. mismo patrón que PrivacyPolicy.
  function segments(text: string): { kind: 'text' | 'email'; value: string }[] {
    const out: { kind: 'text' | 'email'; value: string }[] = [];
    for (const chunk of text.split(/(\{email\})/)) {
      if (chunk === '') continue;
      out.push(chunk === '{email}' ? { kind: 'email', value: contactEmail } : { kind: 'text', value: chunk });
    }
    return out;
  }
</script>

<article class="ui-support">
  <header>
    <h1>{resolvedTitle}</h1>
  </header>

  {#if resolvedIntro}<p class="ui-support-intro">{resolvedIntro}</p>{/if}

  <section class="ui-support-contact">
    <h2>{strings.contactHeading}</h2>
    <p>
      {#each segments(strings.contactLine) as seg}
        {#if seg.kind === 'email'}<a href="mailto:{seg.value}">{seg.value}</a>{:else}{seg.value}{/if}
      {/each}
    </p>
    <p class="ui-support-response">{strings.response(resolvedDays)}</p>
  </section>

  {#if resolvedFaq.length > 0}
    <h2 class="ui-support-faq-heading">{strings.faqHeading}</h2>
    {#each resolvedFaq as item (item.q)}
      <section class="ui-support-faq">
        <h3>{item.q}</h3>
        <p>
          {#each segments(item.a) as seg}
            {#if seg.kind === 'email'}<a href="mailto:{seg.value}">{seg.value}</a>{:else}{seg.value}{/if}
          {/each}
        </p>
      </section>
    {/each}
  {/if}

  {#if children}{@render children()}{/if}

  {#if privacyHref}
    <p class="ui-support-privacy">
      {#each strings.privacyLink.split(/(política de privacidad|privacy policy)/) as part}
        {#if part === 'política de privacidad' || part === 'privacy policy'}<a href={privacyHref}>{part}</a>{:else}{part}{/if}
      {/each}
    </p>
  {/if}
</article>

<style>
  .ui-support {
    max-width: var(--ui-prose-width, 42rem);
    color: var(--ui-text, inherit);
    line-height: 1.6;
  }
  .ui-support header {
    margin-bottom: var(--ui-section-gap, 1.5rem);
  }
  .ui-support h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .ui-support-intro {
    margin: 0 0 var(--ui-section-gap, 1.5rem);
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 70%, transparent));
  }
  .ui-support-contact {
    margin-bottom: var(--ui-section-gap, 1.5rem);
    padding: 1rem;
    border: 1px solid var(--ui-rule, color-mix(in srgb, currentColor 12%, transparent));
    border-radius: var(--ui-radius, 0.5rem);
  }
  .ui-support-contact h2 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
  }
  .ui-support-response {
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 70%, transparent));
  }
  .ui-support-faq-heading {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }
  .ui-support-faq {
    margin-bottom: 1rem;
  }
  .ui-support-faq h3 {
    margin: 0 0 0.25rem;
    font-size: 0.9rem;
  }
  .ui-support p {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
  }
  .ui-support-contact p:last-child,
  .ui-support-faq p:last-child {
    margin-bottom: 0;
  }
  .ui-support-privacy {
    margin-top: var(--ui-section-gap, 1.5rem);
    font-size: 0.8rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 70%, transparent));
  }
  .ui-support a {
    color: var(--ui-accent, inherit);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
</style>
