<script module lang="ts">
  // "novedades" compartido por las apps: modal con las entradas que sirve la api
  // de cada app (GET /api/changelog → array estático de @platform/changelog).
  // bilingüe (es/en) como PrivacyPolicy. presentacional y sin estado: se abre
  // bajo demanda y emite ondismiss al cerrarse.
  export type ChangelogLang = 'es' | 'en';
  export type ChangelogType = 'feature' | 'improvement' | 'fix' | 'breaking';

  export interface ChangelogChange {
    type: ChangelogType;
    es: string;
    en: string;
  }

  export interface ChangelogEntry {
    version: string;
    publishedAt: string;
    title?: string;
    changes: ChangelogChange[];
  }

  // textos por idioma: chrome + etiqueta de cada categoría
  const STRINGS: Record<ChangelogLang, { title: string; close: string; empty: string; types: Record<ChangelogType, string> }> = {
    es: {
      title: 'Novedades',
      close: 'Cerrar',
      empty: 'Sin novedades por ahora',
      types: { feature: 'Nuevo', improvement: 'Mejora', fix: 'Corrección', breaking: 'Importante' },
    },
    en: {
      title: "What's new",
      close: 'Close',
      empty: 'No updates yet',
      types: { feature: 'New', improvement: 'Improved', fix: 'Fixed', breaking: 'Breaking' },
    },
  };
</script>

<script lang="ts">
  let {
    entries,
    lang = 'es',
    ondismiss,
  }: {
    entries: ChangelogEntry[];
    lang?: ChangelogLang;
    ondismiss?: () => void;
  } = $props();

  const t = $derived(STRINGS[lang]);
  const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'es', { dateStyle: 'medium' });
</script>

<svelte:window onkeydown={(ev) => ev.key === 'Escape' && ondismiss?.()} />

<!-- overlay: clic fuera cierra (delegado a ondismiss) -->
<div class="ui-changelog-overlay" role="presentation" onclick={(ev) => ev.target === ev.currentTarget && ondismiss?.()}>
  <div class="ui-changelog" role="dialog" aria-modal="true" aria-label={t.title}>
    <div class="head">
      <h2>{t.title}</h2>
      <button type="button" class="close" aria-label={t.close} onclick={ondismiss}>×</button>
    </div>

    {#if entries.length === 0}
      <p class="empty">{t.empty}</p>
    {:else}
      <ol class="list">
        {#each entries as e (e.version)}
          <li class="entry">
            <div class="meta">
              <span class="version">{e.version}</span>
              {#if e.title}<span class="entry-title">{e.title}</span>{/if}
              <span class="date">{fmt.format(new Date(e.publishedAt))}</span>
            </div>
            <ul class="changes">
              {#each e.changes as c}
                <li class="change">
                  <span class="tag" data-type={c.type}>{t.types[c.type]}</span>
                  <span>{lang === 'en' ? c.en : c.es}</span>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

<style>
  .ui-changelog-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--ui-overlay, color-mix(in srgb, black 45%, transparent));
    z-index: var(--ui-z-modal, 1000);
  }
  .ui-changelog {
    width: 100%;
    max-width: 34rem;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--ui-bg-card, white);
    border: 1px solid var(--ui-border, color-mix(in srgb, currentColor 25%, transparent));
    border-radius: var(--ui-radius, 4px);
    padding: 1rem 1.25rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
  }
  .head h2 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--ui-text, inherit);
  }
  .close {
    font: inherit;
    font-size: 1.4rem;
    line-height: 1;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 0.25rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .entry {
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--ui-border, color-mix(in srgb, currentColor 15%, transparent));
  }
  .entry:last-child {
    border-bottom: none;
  }
  .meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .version {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--ui-text, inherit);
  }
  .entry-title {
    font-size: 0.85rem;
    color: var(--ui-text, inherit);
  }
  .date {
    margin-left: auto;
    font-size: 0.7rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
  .changes {
    list-style: none;
    margin: 0.45rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .change {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--ui-text, inherit);
  }
  .tag {
    flex: none;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 0.1rem 0.4rem;
    border-radius: var(--ui-radius, 4px);
    border: 1px solid currentColor;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
  /* color por categoría via accent overridable; fallback a currentColor */
  .tag[data-type='feature'] {
    color: var(--ui-changelog-feature, var(--ui-accent, currentColor));
  }
  .tag[data-type='breaking'] {
    color: var(--ui-changelog-breaking, var(--ui-danger, currentColor));
  }
  .empty {
    font-size: 0.8rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
</style>
