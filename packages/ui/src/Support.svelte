<script module lang="ts">
  // página de soporte compartida por todas las herramientas de la plataforma, sobre el armazón
  // DocPage (nombre, contacto e idioma salen de setDocShell). App Store y Play exigen una URL de
  // soporte pública; en vez de reescribirla en cada app (duckhunt, sis, carreterinas), cada una
  // monta esta en /support con su FAQ propio. el copy por defecto (contacto + borrado de cuenta,
  // comunes a toda la plataforma) es bilingüe es/en; el FAQ específico de la app se pasa por `faq`
  // y sus secciones propias por `extra`. hermana de PrivacyPolicy.svelte.
  import type { DocLang } from './doc-shell';

  // pregunta/respuesta; en `a` el token {email} se renderiza como enlace mailto
  export interface SupportFaqItem {
    q: string;
    a: string;
  }

  // textos de croma por idioma
  const SUPPORT_STRINGS: Record<
    DocLang,
    {
      title: string;
      kicker: string;
      intro: (app: string) => string;
      contact: string;
      response: (days: string) => string;
      faq: string;
      defaultResponseDays: string;
      // FAQ por defecto: solo lo común a toda la plataforma (borrado de cuenta/datos, requisito
      // RGPD que toda app con cuentas debe ofrecer)
      defaultFaq: SupportFaqItem[];
    }
  > = {
    es: {
      title: 'Soporte',
      kicker: 'Ayuda',
      intro: (app) => `¿Necesitas ayuda con ${app}? Escríbenos y te respondemos.`,
      contact: 'Escríbenos',
      response: (days) => `Solemos responder en ${days}.`,
      faq: 'Preguntas frecuentes',
      defaultResponseDays: 'uno o dos días laborables',
      defaultFaq: [
        {
          q: '¿Cómo elimino mi cuenta y mis datos?',
          a: 'Escríbenos a {email} desde el correo de tu cuenta y eliminamos la cuenta y sus datos asociados.',
        },
      ],
    },
    en: {
      title: 'Support',
      kicker: 'Help',
      intro: (app) => `Need help with ${app}? Reach out and we'll get back to you.`,
      contact: 'Write to us',
      response: (days) => `We usually reply within ${days}.`,
      faq: 'FAQ',
      defaultResponseDays: 'one or two business days',
      defaultFaq: [
        {
          q: 'How do I delete my account and data?',
          a: 'Email us at {email} from your account address and we will delete your account and its associated data.',
        },
      ],
    },
  };
</script>

<script lang="ts">
  import DocPage from './DocPage.svelte';
  import DocSection from './DocSection.svelte';
  import { getDocShell, type DocExtraSection } from './doc-shell';
  import { emailSegments } from './segments';

  let {
    lang,
    responseDays = null,
    faq = null,
    extra = [],
  }: {
    // override del idioma del shell
    lang?: DocLang;
    // tiempo de respuesta legible; si null se usa el por defecto del idioma
    responseDays?: string | null;
    // FAQ de la app; reemplaza el por defecto (solo borrado de cuenta)
    faq?: SupportFaqItem[] | null;
    // secciones propias de la app, tras el FAQ
    extra?: DocExtraSection[];
  } = $props();

  const shell = getDocShell();
  const resolvedLang = $derived(lang ?? shell.lang ?? 'es');
  const strings = $derived(SUPPORT_STRINGS[resolvedLang]);
  const resolvedFaq = $derived(faq ?? strings.defaultFaq);
</script>

<DocPage title={strings.title} kicker={strings.kicker} lang={resolvedLang}>
  {#snippet intro()}<p>{strings.intro(shell.appName)}</p>{/snippet}

  {#snippet summary()}
    <p class="ui-support-label">{strings.contact}</p>
    <a class="ui-support-mail" href="mailto:{shell.contactEmail}">
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="M3 5.5l7 5.5 7-5.5" /></svg>
      {shell.contactEmail}
    </a>
    <p class="ui-support-response">{strings.response(responseDays ?? strings.defaultResponseDays)}</p>
  {/snippet}

  {#if resolvedFaq.length > 0}
    <DocSection id="faq" title={strings.faq}>
      <div class="ui-support-faq">
        {#each resolvedFaq as item (item.q)}
          <details>
            <summary>{item.q}</summary>
            <p>
              {#each emailSegments(item.a, shell.contactEmail) as seg}
                {#if seg.kind === 'email'}<a href="mailto:{seg.value}">{seg.value}</a>{:else}{seg.value}{/if}
              {/each}
            </p>
          </details>
        {/each}
      </div>
    </DocSection>
  {/if}

  {#each extra as section (section.id)}
    <DocSection id={section.id} title={section.title}>{@render section.body()}</DocSection>
  {/each}
</DocPage>

<style>
  .ui-support-label {
    margin: 0 0 0.5rem;
    font-family: var(--doc-mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--doc-muted);
  }
  .ui-support-mail {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--doc-accent);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .ui-support-mail:hover {
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }
  .ui-support-mail svg {
    flex: none;
    width: 1.2rem;
    height: 1.2rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .ui-support-response {
    margin: 0.45rem 0 0;
    font-size: 0.85rem;
    color: var(--doc-muted);
  }

  /* acordeón nativo: se abre sin js (la página puede ir prerenderizada) */
  .ui-support-faq {
    border-top: 1px solid var(--doc-rule);
  }
  details {
    border-bottom: 1px solid var(--doc-rule);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.95rem 0;
    font-weight: 600;
    line-height: 1.4;
    color: var(--doc-strong);
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::after {
    content: '+';
    flex: none;
    font-family: var(--doc-mono);
    font-size: 1.1rem;
    font-weight: 400;
    color: var(--doc-accent);
    transition: transform 0.2s ease;
  }
  details[open] summary::after {
    transform: rotate(45deg);
  }
  summary:hover {
    color: var(--doc-accent);
  }
  summary:focus-visible {
    outline: 2px solid var(--doc-accent);
    outline-offset: 2px;
  }
  details p {
    margin: 0;
    padding: 0 2rem 1.1rem 0;
  }
</style>
