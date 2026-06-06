<script lang="ts">
  // listado de sesiones de login activas + cerrar las demás. los datos vienen
  // de la api de cada app (shape SessionInfo de @platform/auth: token hasheado,
  // flag current). textos via `labels` (default español; sis pasa inglés).
  interface SessionInfo {
    hash: string;
    createdAt: number;
    expiresAt: number;
    userAgent: string | null;
    current: boolean;
  }

  let {
    sessions,
    busy = false,
    onlogoutothers,
    labels = {},
  }: {
    sessions: SessionInfo[];
    busy?: boolean;
    onlogoutothers: () => void;
    labels?: Partial<typeof DEFAULT_LABELS>;
  } = $props();

  const DEFAULT_LABELS = {
    current: 'esta sesión',
    unknownAgent: 'dispositivo desconocido',
    created: 'iniciada',
    expires: 'caduca',
    logoutOthers: 'cerrar las demás sesiones',
    empty: 'sin sesiones activas',
  };
  const t = $derived({ ...DEFAULT_LABELS, ...labels });

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  // user-agent abreviado: navegador/os a grandes rasgos, sin librerías
  function agentLabel(ua: string | null): string {
    if (!ua) return t.unknownAgent;
    const browser = /firefox/i.test(ua) ? 'Firefox' : /edg/i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : ua.slice(0, 40);
    const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : '';
    return os ? `${browser} · ${os}` : browser;
  }
</script>

<div class="ui-sessions">
  {#if sessions.length === 0}
    <p class="ui-sessions-empty">{t.empty}</p>
  {:else}
    <ul>
      {#each sessions as s (s.hash)}
        <li class:current={s.current}>
          <div class="agent">
            {agentLabel(s.userAgent)}
            {#if s.current}<span class="badge">{t.current}</span>{/if}
          </div>
          <div class="dates">
            <span>{t.created} {fmt.format(new Date(s.createdAt))}</span>
            <span>{t.expires} {fmt.format(new Date(s.expiresAt))}</span>
          </div>
        </li>
      {/each}
    </ul>
    {#if sessions.length > 1}
      <button type="button" disabled={busy} onclick={onlogoutothers}>
        {t.logoutOthers}
      </button>
    {/if}
  {/if}
</div>

<style>
  .ui-sessions ul {
    list-style: none;
    margin: 0 0 0.75rem;
    padding: 0;
    border: 1px solid var(--ui-border, color-mix(in srgb, currentColor 25%, transparent));
    border-radius: var(--ui-radius, 4px);
    background: var(--ui-bg-card, transparent);
  }
  .ui-sessions li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--ui-border, color-mix(in srgb, currentColor 15%, transparent));
  }
  .ui-sessions li:last-child {
    border-bottom: none;
  }
  .agent {
    font-size: 0.85rem;
    color: var(--ui-text, inherit);
  }
  .badge {
    margin-left: 0.5rem;
    font-size: 0.65rem;
    color: var(--ui-accent, inherit);
    border: 1px solid var(--ui-border, color-mix(in srgb, currentColor 25%, transparent));
    border-radius: var(--ui-radius, 4px);
    padding: 0.05rem 0.4rem;
  }
  .dates {
    display: flex;
    gap: 0.75rem;
    font-size: 0.7rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
  .ui-sessions button {
    font: inherit;
    font-size: 0.8rem;
    color: var(--ui-text, inherit);
    background: var(--ui-bg-card, transparent);
    border: 1px solid var(--ui-border, color-mix(in srgb, currentColor 25%, transparent));
    border-radius: var(--ui-radius, 4px);
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }
  .ui-sessions button:hover {
    background: var(--ui-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  }
  .ui-sessions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ui-sessions-empty {
    font-size: 0.8rem;
    color: var(--ui-text-muted, color-mix(in srgb, currentColor 55%, transparent));
  }
</style>
