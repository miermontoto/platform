<script lang="ts">
  // switcher de idioma compartido (prop-driven, sin acoplarse al runtime de paraglide de
  // la app). la app le pasa el locale actual, la lista de locales y el handler de cambio
  // (típicamente createI18n().switchLanguage). estilo vía tokens --ui-* con fallbacks: en
  // duckhunt heredan el ámbar; en otras apps degradan a neutros.
  let {
    locale,
    locales,
    onswitch,
  }: {
    locale: string;
    locales: readonly string[];
    onswitch: (locale: string) => void;
  } = $props();
</script>

<div class="ui-lang" role="group" aria-label="idioma / language">
  {#each locales as l, i (l)}
    {#if i > 0}<span class="ui-lang-sep" aria-hidden="true">/</span>{/if}
    <button
      type="button"
      class="ui-lang-opt"
      class:active={l === locale}
      aria-pressed={l === locale}
      onclick={() => onswitch(l)}>{l}</button
    >
  {/each}
</div>

<style>
  .ui-lang {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
  }
  .ui-lang-opt {
    padding: 2px 5px;
    background: none;
    border: none;
    border-radius: var(--ui-radius, 2px);
    color: var(--ui-text-muted, #868e9a);
    font: inherit;
    text-transform: uppercase;
    cursor: pointer;
  }
  .ui-lang-opt:hover {
    color: var(--ui-text, #e6eaf0);
  }
  .ui-lang-opt.active {
    color: var(--ui-accent, #f0b040);
  }
  .ui-lang-sep {
    color: var(--ui-border, #1f2630);
  }
</style>
