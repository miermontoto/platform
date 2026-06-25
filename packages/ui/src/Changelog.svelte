<script module lang="ts">
  // "novedades" compartido por las apps. los datos vienen de la api de cada app
  // (GET /api/changelog → estado de @platform/changelog: entradas + nº no vistas).
  // bilingüe (es/en) como PrivacyPolicy y con `labels` overridables como SessionsPanel.
  // presentacional: emite ondismiss; el marcar-visto (POST /api/changelog/seen) lo
  // dispara la app.
  export type ChangelogLang = 'es' | 'en';
  export type ChangelogType = 'feature' | 'improvement' | 'fix' | 'breaking';

  export interface ChangelogChange {
    type: ChangelogType;
    es: string;
    en: string;
  }

  export interface ChangelogEntry {
    version: string;
    publishedAt: number;
    title: string | null;
    changes: ChangelogChange[];
  }

  // etiqueta de cada categoría por idioma (overridable via prop `typeLabels`)
  const DEFAULT_TYPE_LABELS: Record<ChangelogLang, Record<ChangelogType, string>> = {
    es: { feature: 'Nuevo', improvement: 'Mejora', fix: 'Corrección', breaking: 'Cambio importante' },
    en: { feature: 'New', improvement: 'Improved', fix: 'Fixed', breaking: 'Breaking' },
  };

  // textos de chrome por idioma (overridables via prop `labels`), como PrivacyPolicy
  export const CHANGELOG_STRINGS: Record<ChangelogLang, { title: string; dismiss: string; empty: string }> = {
    es: { title: 'Novedades', dismiss: 'Entendido', empty: 'Sin novedades por ahora' },
    en: { title: "What's new", dismiss: 'Got it', empty: 'No updates yet' },
  };
</script>

<script lang="ts">
  let {
    entries,
    lang = 'es',
    variant = 'modal',
    labels = {},
    typeLabels = {},
    ondismiss,
  }: {
    entries: ChangelogEntry[];
    lang?: ChangelogLang;
    // 'modal': overlay con botón de cierre; 'inline': solo el contenido (panel)
    variant?: 'modal' | 'inline';
    labels?: Partial<(typeof CHANGELOG_STRINGS)['es']>;
    typeLabels?: Partial<Record<ChangelogType, string>>;
    ondismiss?: () => void;
  } = $props();

  const t = $derived({ ...CHANGELOG_STRINGS[lang], ...labels });
  const tl = $derived({ ...DEFAULT_TYPE_LABELS[lang], ...typeLabels });

  const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'es', { dateStyle: 'long' });
  const text = (c: ChangelogChange): string => (lang === 'en' ? c.en : c.es);
</script>

{#snippet body()}
  <div class="ui-changelog-head">
    <h2>{t.title}</h2>
    {#if variant === 'modal'}
      <button type="button" class="close" aria-label={t.dismiss} onclick={ondismiss}>×</button>
    {/if}
  </div>

  {#if entries.length === 0}
    <p class="ui-changelog-empty">{t.empty}</p>
  {:else}
    <ol class="ui-changelog-list">
      {#each entries as e (e.version)}
        <li class="entry">
          <div class="meta">
            <span class="version">{e.version}</span>
            <span class="date">{fmt.format(new Date(e.publishedAt))}</span>
          </div>
          {#if e.title}<p class="entry-title">{e.title}</p>{/if}
          <ul class="changes">
            {#each e.changes as c}
              <li class="change">
                <span class="tag" data-type={c.type}>{tl[c.type]}</span>
                <span class="change-text">{text(c)}</span>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ol>
  {/if}

  {#if variant === 'modal'}
    <div class="ui-changelog-foot">
      <button type="button" class="primary" onclick={ondismiss}>{t.dismiss}</button>
    </div>
  {/if}
{/snippet}

<!-- Escape cierra el modal (svelte:window debe ir a nivel raíz; el guard de
     variante va en el handler, no en el emplazamiento) -->
<svelte:window onkeydown={(ev) => variant === 'modal' && ev.key === 'Escape' && ondismiss?.()} />

{#if variant === 'modal'}
  <!-- overlay: clic fuera cierra (delegado a ondismiss) -->
  <div
    class="ui-changelog-overlay"
    role="presentation"
    onclick={(ev) => ev.target === ev.currentTarget && ondismiss?.()}
  >
    <div class="ui-changelog ui-changelog-modal" role="dialog" aria-modal="true" aria-label={t.title}>
      {@render body()}
    </div>
  </div>
{:else}
  <div class="ui-changelog">{@render body()}</div>
{/if}

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
  .ui-changelog-modal {
    width: 100%;
    max-width: 32rem;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--ui-bg-card, white);
    border: 1px solid var(--ui-border, color-mix(in srgb, currentColor 25%, transparent));
    border-radius: var(--ui-radius, 4px);
    padding: 1rem 1.25rem;
  }
  .ui-changelog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .ui-changelog-head h2 {
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
  .ui-changelog-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .entry {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--ui-border, color-mix(in srgb, currentColor 15%, transparent));
  }
  .entry:last-child {
    border-bottom: none;
  }
  .meta {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .version {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--ui-text, inherit);
  }
  .date {
    font-size: 0.72rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
  .entry-title {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    color: var(--ui-text, inherit);
  }
  .changes {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .change {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .tag {
    flex: none;
    font-size: 0.62rem;
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
  .change-text {
    font-size: 0.85rem;
    color: var(--ui-text, inherit);
  }
  .ui-changelog-foot {
    margin-top: 0.75rem;
    display: flex;
    justify-content: flex-end;
  }
  .ui-changelog-foot .primary {
    font: inherit;
    font-size: 0.85rem;
    color: var(--ui-accent-text, white);
    background: var(--ui-accent, #333);
    border: 1px solid var(--ui-accent, #333);
    border-radius: var(--ui-radius, 4px);
    padding: 0.4rem 1rem;
    cursor: pointer;
  }
  .ui-changelog-foot .primary:hover {
    opacity: 0.9;
  }
  .ui-changelog-empty {
    font-size: 0.8rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
</style>
