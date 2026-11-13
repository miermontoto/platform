<script module lang="ts">
  // armazón de las páginas secundarias de todas las apps (privacidad, soporte, guías,
  // documentación): barra con la marca y las acciones de la app, cabecera (antetítulo, título,
  // fecha, entradilla y una caja destacada), índice fijo a la izquierda en escritorio (fila de
  // chips en móvil), secciones numeradas y pie con las demás páginas. la app fija lo común con
  // setDocShell (doc-shell.ts) y aporta el tema por los tokens --ui-*; cada página solo su
  // contenido, en DocSection. sin js se lee entero (duckhunt la prerenderiza).
  import type { DocLang } from './doc-shell';

  // textos de la croma por idioma
  export const DOC_STRINGS: Record<
    DocLang,
    { updated: string; contents: string; pages: string; home: (app: string) => string }
  > = {
    es: {
      updated: 'Última actualización',
      contents: 'Índice',
      pages: 'Más páginas',
      home: (app) => `Volver a ${app}`,
    },
    en: {
      updated: 'Last updated',
      contents: 'Contents',
      pages: 'More pages',
      home: (app) => `Back to ${app}`,
    },
  };

  // fracción del viewport: la sección en lectura es la última cuyo inicio ya pasó por encima
  const ACTIVE_LINE = 0.3;
  // px de holgura para dar por llegado el final del documento (redondeos de scroll)
  const END_SLACK = 2;
  const EXTERNAL_HREF = /^https?:\/\//;
  const TRAILING_SLASH = /(.)\/$/;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getDocShell, type DocTocEntry } from './doc-shell';

  let {
    title,
    headTitle = null,
    kicker = null,
    updated = null,
    lang,
    toc = [],
    intro,
    summary,
    children,
  }: {
    title: string;
    // <title> de la pestaña; por defecto "título · app" (override si el título ya nombra la app)
    headTitle?: string | null;
    // antetítulo en versalitas sobre el título (p.ej. "Legal")
    kicker?: string | null;
    // fecha de última actualización (YYYY-MM-DD); si se omite no se muestra
    updated?: string | Date | null;
    // override del idioma del shell
    lang?: DocLang;
    // índice: con entradas, la página va a dos columnas y numera sus secciones
    toc?: DocTocEntry[];
    intro?: Snippet;
    // caja destacada bajo la entradilla (resumen, contacto)
    summary?: Snippet;
    children: Snippet;
  } = $props();

  const shell = getDocShell();
  const resolvedLang = $derived(lang ?? shell.lang ?? 'es');
  const strings = $derived(DOC_STRINGS[resolvedLang]);

  // en UTC: una fecha sin hora se parsea como medianoche UTC y en husos negativos saldría el día anterior
  const updatedDate = $derived.by(() => {
    if (updated == null) return null;
    const d = new Date(updated);
    return Number.isNaN(d.getTime()) ? null : d;
  });
  const updatedLabel = $derived(
    updatedDate &&
      new Intl.DateTimeFormat(resolvedLang, { dateStyle: 'long', timeZone: 'UTC' }).format(updatedDate),
  );

  const currentPath = $derived(shell.path?.replace(TRAILING_SLASH, '$1'));

  // cada página monta su DocPage, así que el afterNavigate de su montaje trae de dónde se vino
  // (null en la carga directa del documento)
  let cameFromApp = false;
  shell.afterNavigate?.(({ from }) => {
    cameFromApp = from !== null;
  });
  function back(event: MouseEvent): void {
    if (!cameFromApp) return;
    event.preventDefault();
    history.back();
  }

  // sección en lectura, para marcarla en el índice (mejora progresiva: sin js no se marca nada).
  // al final del documento manda la última: una sección corta al pie nunca llega a la línea
  let active = $state<string | null>(null);
  function trackActive(): void {
    const targets = toc.map((entry) => document.getElementById(entry.id)).filter((el) => el !== null);
    const { scrollHeight } = document.documentElement;
    const atEnd = scrollHeight > innerHeight && scrollY + innerHeight >= scrollHeight - END_SLACK;
    const line = innerHeight * ACTIVE_LINE;
    active = (atEnd ? targets.at(-1) : targets.findLast((el) => el.getBoundingClientRect().top <= line))?.id ?? null;
  }
  $effect(trackActive);
</script>

<svelte:window onscroll={toc.length > 0 ? trackActive : undefined} onresize={toc.length > 0 ? trackActive : undefined} />

<svelte:head><title>{headTitle ?? `${title} · ${shell.appName}`}</title></svelte:head>

<div class="ui-doc" class:has-toc={toc.length > 0}>
  <header class="ui-doc-bar">
    <a class="ui-doc-home" href={shell.home ?? '/'} onclick={back} aria-label={strings.home(shell.appName)}>
      <span class="ui-doc-arrow" aria-hidden="true">←</span>
      <span class="ui-doc-brand">
        {#if shell.brand}{@render shell.brand()}{:else}{shell.appName}{/if}
      </span>
    </a>
    {#if shell.actions}<div class="ui-doc-actions">{@render shell.actions()}</div>{/if}
  </header>

  <main class="ui-doc-page">
    <div class="ui-doc-head">
      {#if kicker}<p class="ui-doc-kicker">{kicker}</p>{/if}
      <h1>{title}</h1>
      {#if updatedDate && updatedLabel}
        <p class="ui-doc-updated">
          {strings.updated}: <time datetime={updatedDate.toISOString().slice(0, 10)}>{updatedLabel}</time>
        </p>
      {/if}
      {#if intro}<div class="ui-doc-intro">{@render intro()}</div>{/if}
      {#if summary}<aside class="ui-doc-summary">{@render summary()}</aside>{/if}
    </div>

    <div class="ui-doc-body">
      {#if toc.length > 0}
        <nav class="ui-doc-toc" aria-label={strings.contents}>
          <p class="ui-doc-toc-label">{strings.contents}</p>
          <ol>
            {#each toc as entry (entry.id)}
              <li>
                <a href="#{entry.id}" aria-current={active === entry.id ? 'location' : undefined}>{entry.title}</a>
              </li>
            {/each}
          </ol>
        </nav>
      {/if}
      <article class="ui-doc-main">{@render children()}</article>
    </div>
  </main>

  {#if shell.links?.length}
    <footer class="ui-doc-foot">
      <nav aria-label={strings.pages}>
        {#each shell.links as link (link.href)}
          {#if EXTERNAL_HREF.test(link.href)}
            <a href={link.href} target="_blank" rel="noopener">{link.label} ↗</a>
          {:else}
            <a href={link.href} aria-current={link.href === currentPath ? 'page' : undefined}>{link.label}</a>
          {/if}
        {/each}
      </nav>
    </footer>
  {/if}
</div>

<style>
  .ui-doc {
    --doc-pad: 1.25rem;
    --doc-prose: var(--ui-prose-width, 42rem);
    --doc-toc-w: 12.5rem;
    --doc-cols-gap: 3.5rem;
    --doc-gap-sm: 1rem;
    --doc-section-gap: 2.25rem;
    --doc-w: var(--doc-prose);
    --doc-rule: var(--ui-rule, var(--ui-border, color-mix(in srgb, currentColor 12%, transparent)));
    --doc-muted: var(--ui-text-muted, color-mix(in srgb, currentColor 65%, transparent));
    --doc-strong: var(--ui-text-strong, var(--ui-text, inherit));
    --doc-accent: var(--ui-accent, currentColor);
    --doc-mono: var(--ui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    --doc-sunken: var(--ui-bg-sunken, color-mix(in srgb, currentColor 6%, transparent));
    --doc-radius: var(--ui-radius, 0.5rem);
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    padding-left: max(var(--doc-pad), var(--safe-left, env(safe-area-inset-left, 0px)));
    padding-right: max(var(--doc-pad), var(--safe-right, env(safe-area-inset-right, 0px)));
    color: var(--ui-text, inherit);
  }

  .ui-doc-bar,
  .ui-doc-page,
  .ui-doc-foot {
    width: min(100%, var(--doc-w));
    margin-inline: auto;
  }

  /* barra */
  .ui-doc-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--doc-gap-sm);
    padding: calc(0.9rem + var(--safe-top, env(safe-area-inset-top, 0px))) 0 0.9rem;
    border-bottom: 1px solid var(--doc-rule);
  }
  .ui-doc-home {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--doc-strong);
    text-decoration: none;
  }
  .ui-doc-arrow {
    color: var(--doc-muted);
    transition: transform 0.15s ease, color 0.15s ease;
  }
  .ui-doc-home:hover .ui-doc-arrow {
    color: var(--doc-accent);
    transform: translateX(-2px);
  }
  .ui-doc-brand {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  /* cabecera */
  .ui-doc-page {
    flex: 1;
    padding: 2.75rem 0 4rem;
  }
  .ui-doc-head {
    margin-bottom: 2.75rem;
  }
  .ui-doc-head > * {
    max-width: var(--doc-prose);
  }
  .ui-doc-kicker {
    margin: 0 0 0.7rem;
    font-family: var(--doc-mono);
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--doc-accent);
  }
  h1 {
    margin: 0;
    font-size: clamp(1.75rem, 1.3rem + 1.8vw, 2.5rem);
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.025em;
    color: var(--doc-strong);
    text-wrap: balance;
  }
  .ui-doc-updated {
    margin: 0.85rem 0 0;
    font-family: var(--doc-mono);
    font-size: 0.75rem;
    color: var(--doc-muted);
  }
  .ui-doc-intro {
    margin-top: 1.15rem;
    font-size: 1.05rem;
    line-height: 1.6;
    color: var(--doc-muted);
    text-wrap: pretty;
  }
  .ui-doc-intro :global(p) {
    margin: 0 0 0.75rem;
  }
  .ui-doc-intro :global(p:last-child) {
    margin-bottom: 0;
  }
  .ui-doc-intro :global(a) {
    color: var(--doc-accent);
  }
  .ui-doc-summary {
    margin-top: 1.75rem;
    padding: 1.1rem 1.25rem;
    border: 1px solid var(--doc-rule);
    border-radius: var(--doc-radius);
    background: var(--ui-bg-card, transparent);
  }

  /* índice: fila de chips con scroll en móvil, columna fija en escritorio */
  .ui-doc-toc {
    margin-bottom: 2.5rem;
  }
  .ui-doc-toc-label {
    margin: 0 0 0.6rem;
    font-family: var(--doc-mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--doc-muted);
  }
  .ui-doc-toc ol {
    display: flex;
    gap: 0.4rem;
    margin: 0;
    padding: 0 0 0.25rem;
    list-style: none;
    overflow-x: auto;
    scrollbar-width: none;
    counter-reset: ui-doc-toc;
  }
  .ui-doc-toc li {
    flex: none;
    counter-increment: ui-doc-toc;
  }
  .ui-doc-toc a {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--doc-rule);
    border-radius: 999px;
    font-size: 0.8rem;
    line-height: 1.35;
    white-space: nowrap;
    color: var(--doc-muted);
    text-decoration: none;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .ui-doc-toc a::before {
    content: counter(ui-doc-toc, decimal-leading-zero);
    font-family: var(--doc-mono);
    font-size: 0.68rem;
    color: var(--doc-accent);
  }
  .ui-doc-toc a:hover,
  .ui-doc-toc a[aria-current] {
    color: var(--doc-strong);
    border-color: var(--doc-accent);
  }
  .ui-doc-main {
    min-width: 0;
    max-width: var(--doc-prose);
    counter-reset: ui-doc-section;
  }

  @media (min-width: 60rem) {
    .ui-doc.has-toc {
      --doc-w: calc(var(--doc-toc-w) + var(--doc-cols-gap) + var(--doc-prose));
    }
    .has-toc .ui-doc-body {
      display: grid;
      grid-template-columns: var(--doc-toc-w) minmax(0, 1fr);
      gap: var(--doc-cols-gap);
      align-items: start;
    }
    .ui-doc-toc {
      position: sticky;
      top: calc(1.5rem + var(--safe-top, env(safe-area-inset-top, 0px)));
      margin: 0;
    }
    .ui-doc-toc ol {
      flex-direction: column;
      gap: 0;
      padding: 0;
      overflow: visible;
    }
    .ui-doc-toc a {
      padding: 0.4rem 0 0.4rem 0.85rem;
      border: none;
      border-left: 1px solid var(--doc-rule);
      border-radius: 0;
      white-space: normal;
    }
  }

  /* pie */
  .ui-doc-foot {
    padding: 1.25rem 0 calc(1.5rem + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
    border-top: 1px solid var(--doc-rule);
  }
  .ui-doc-foot nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.4rem;
    font-size: 0.8rem;
  }
  .ui-doc-foot a {
    color: var(--doc-muted);
    text-decoration: none;
  }
  .ui-doc-foot a:hover,
  .ui-doc-foot a[aria-current] {
    color: var(--doc-strong);
  }

  /* prosa del contenido: global porque las secciones las escribe la página (otro componente).
     especificidad de una clase (:where no suma) para que las clases scoped de la página ganen
     y los estilos de elemento de la app no */
  :global {
    .ui-doc-main {
      font-size: 0.95rem;
      line-height: 1.7;
      text-wrap: pretty;
    }
    .ui-doc-main :where(p, ul, ol, pre, blockquote) {
      margin: 0 0 0.85rem;
    }
    .ui-doc-main :where(p, ul, ol, pre, blockquote):where(:last-child) {
      margin-bottom: 0;
    }
    .ui-doc-main :where(ul, ol) {
      padding-left: 1.25rem;
    }
    .ui-doc-main :where(ul) {
      list-style: disc;
    }
    .ui-doc-main :where(ol) {
      list-style: decimal;
    }
    .ui-doc-main :where(li) {
      margin-bottom: 0.45rem;
    }
    .ui-doc-main :where(li)::marker {
      color: var(--doc-muted);
    }
    .ui-doc-main :where(h3) {
      margin: 1.75rem 0 0.5rem;
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.35;
      color: var(--doc-strong);
    }
    .ui-doc-main :where(strong) {
      font-weight: 600;
      color: var(--doc-strong);
    }
    .ui-doc-main :where(a) {
      color: var(--doc-accent);
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.18em;
    }
    .ui-doc-main :where(a:hover) {
      text-decoration-color: currentColor;
    }
    .ui-doc-main :where(code) {
      padding: 0.1em 0.35em;
      border-radius: var(--doc-radius);
      background: var(--doc-sunken);
      font-family: var(--doc-mono);
      font-size: 0.86em;
      overflow-wrap: anywhere;
    }
    .ui-doc-main :where(pre) {
      padding: 0.85rem 1rem;
      border: 1px solid var(--doc-rule);
      border-radius: var(--doc-radius);
      background: var(--doc-sunken);
      font-size: 0.82rem;
      line-height: 1.6;
      overflow-x: auto;
    }
    .ui-doc-main :where(pre code) {
      padding: 0;
      background: none;
      font-size: inherit;
      overflow-wrap: normal;
    }
  }
</style>
