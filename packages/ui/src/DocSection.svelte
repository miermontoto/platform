<script lang="ts">
  // sección de una página secundaria (siempre dentro de DocPage: usa sus variables --doc-*). el id
  // es el ancla del índice; en las páginas con índice el título lleva su número, que sale de un
  // contador css y no de un prop: así una sección que la app intercala queda numerada sin pasar índices.
  import type { Snippet } from 'svelte';

  let { id, title, children }: { id: string; title: string; children: Snippet } = $props();
</script>

<section {id} class="ui-doc-section">
  <h2>{title}</h2>
  {@render children()}
</section>

<style>
  .ui-doc-section {
    scroll-margin-top: calc(var(--doc-gap-sm) + var(--safe-top, env(safe-area-inset-top, 0px)));
  }
  .ui-doc-section + :global(.ui-doc-section) {
    margin-top: var(--doc-section-gap);
    padding-top: var(--doc-section-gap);
    border-top: 1px solid var(--doc-rule);
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin: 0 0 0.9rem;
    font-size: 1.2rem;
    font-weight: 650;
    line-height: 1.25;
    letter-spacing: -0.015em;
    color: var(--doc-strong);
    text-wrap: balance;
  }
  /* el número solo existe si la página tiene índice: espeja la numeración de sus entradas */
  :global(.ui-doc.has-toc) .ui-doc-section {
    counter-increment: ui-doc-section;
  }
  :global(.ui-doc.has-toc) h2::before {
    content: counter(ui-doc-section, decimal-leading-zero);
    flex: none;
    font-family: var(--doc-mono);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--doc-accent);
  }
</style>
