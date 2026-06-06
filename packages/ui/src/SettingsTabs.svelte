<script lang="ts">
  // shell de ajustes con tabs por subruta (estructura extraída de duckhunt).
  // el tab activo es el de href coincidente MÁS LARGO (el tab raíz no se queda
  // activo en las subrutas). tema via custom properties --ui-* con fallbacks
  // neutros; cada app las mapea a sus tokens en su css global.
  import type { Snippet } from 'svelte';

  let {
    title = null,
    tabs,
    currentPath,
    children,
  }: {
    title?: string | null;
    tabs: { href: string; label: string }[];
    currentPath: string;
    children: Snippet;
  } = $props();

  const matches = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);
  const activeHref = $derived(
    tabs
      .filter((t) => matches(t.href))
      .reduce<string | null>((best, t) => (best === null || t.href.length > best.length ? t.href : best), null),
  );
</script>

<header class="ui-settings-top">
  {#if title}<h1>{title}</h1>{/if}
  <nav class="ui-settings-tabs" aria-label="secciones">
    {#each tabs as tab (tab.href)}
      <a href={tab.href} class:active={tab.href === activeHref}>{tab.label}</a>
    {/each}
  </nav>
</header>

{@render children()}

<style>
  .ui-settings-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-gap, 0.75rem);
    flex-wrap: wrap;
    margin-bottom: var(--ui-section-gap, 1.5rem);
  }
  .ui-settings-top h1 {
    margin: 0;
    font-size: 1.1rem;
  }
  .ui-settings-tabs {
    display: flex;
    gap: var(--ui-gap-sm, 0.25rem);
  }
  .ui-settings-tabs a {
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    padding: 0.25rem 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius, 4px);
    white-space: nowrap;
    text-decoration: none;
  }
  .ui-settings-tabs a:hover {
    color: var(--ui-text, inherit);
    background: var(--ui-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  }
  .ui-settings-tabs a.active {
    color: var(--ui-accent, inherit);
    border-color: var(--ui-border, color-mix(in srgb, currentColor 25%, transparent));
    background: var(--ui-bg-card, transparent);
  }
</style>
