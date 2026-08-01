# platform

paquetes compartidos de las apps (sis, duckhunt, carreterinas†). cada app vive en
su propio repo y consume este como **git submodule** en `platform/`, incluyendo
`platform/packages/*` en su pnpm-workspace (deps `workspace:*`, fuente ts sin build).

## paquetes

```
packages/
  config/     tsconfig base + presets de vite (pwa + proxy dev + i18n paraglide)
  core-api/   hono base, gate de sesión, spa estática, bootstrap del servidor, .env,
              ws-hub (pub/sub por usuario)
  db/         factoría sqlite (wal + pragmas + unaccent + migraciones drizzle)
  auth/       tabla canónica de sesiones + servicio de ciclo de vida
  changelog/  "novedades" compartido: tipos del array hand-curated de cada app
  ui/         componentes svelte compartidos (SettingsTabs, SessionsPanel,
              PrivacyPolicy, Support, Changelog, LanguageSwitcher) + http + i18n +
              base.css (primitivas css móvil/táctil)
  mobile/     shell capacitor (config factory; spa empaquetada + api remota via
              VITE_API_BASE) + compact + system-bars + connectivity + deep-link
tooling/
  backup/     backup-sqlite.sh — copia segura + rotación recent/weekly (docker|local)
  db/         db-sqlite.sh — acceso sqlite en caliente (docker|local), salida json
  mobile/     generadores de icons/splash android+ios desde el logo de la app
  version/    bump snapshot (<yy>w<ww><letra>) + plantilla de hook pre-commit
.github/workflows/
              android-release.yml · ios-release.yml — releases móviles reutilizables
              (workflow_call) que invocan las apps desde un caller fino
```

## consumo desde una app

```yaml
# pnpm-workspace.yaml de la app
packages:
  - 'packages/*'
  - 'platform/packages/*'
```

```jsonc
// package.json del paquete consumidor
"dependencies": { "@platform/db": "workspace:*" }
```

las apis bundlean los paquetes via tsup (`noExternal: [/^@platform\//]`); las webs
via vite. actualizar la plataforma en una app = `git -C platform pull` + commit del
nuevo sha del submodule.

## changelog ("novedades")

enseñar al usuario qué ha cambiado, sin infraestructura: las entradas son
**hand-curated** (array en el código de la app = única fuente de verdad) y se
sirven tal cual. no hay tabla, ni seed, ni estado de "visto" por usuario: el modal
se abre solo cuando el usuario lo pide. `@platform/changelog` es solo el contrato
de tipos; el render lo hace `@platform/ui`.

```ts
// 1. entradas hand-curated (es/en). publishedAt ISO; una línea por cambio
import type { ChangelogEntry } from '@platform/changelog';
export const CHANGELOG: ChangelogEntry[] = [
  { version: '1.4.0', publishedAt: '2026-06-25', changes: [
    { type: 'feature', es: 'Backups automáticos', en: 'Automatic backups' },
    { type: 'fix', es: 'Tema oscuro en móvil', en: 'Dark theme on mobile' },
  ] },
];

// 2. ruta: datos estáticos, sin userId de por medio
app.get('/api/changelog', (c) => c.json({ entries: CHANGELOG }));
```

```svelte
<!-- 3. cliente: GET /api/changelog → { entries }, en respuesta al clic del usuario -->
<script>
  import Changelog from '@platform/ui/Changelog.svelte';
</script>
{#if open}<Changelog {entries} lang="es" ondismiss={() => open = false} />{/if}
```

## backups

```bash
tooling/backup/backup-sqlite.sh --app sis --mode docker --container sis-sis-1 \
    --db /app/data/sis.db --dest ~/dev/sis/data/backups
```

rotación: `recent/` últimas 4 (cada 6h = 24h) + `weekly/` últimas 4 (1 mes).
cada app tiene un wrapper en `scripts/backup.sh` invocado por cron.

## acceso a la db en caliente

consulta/modifica la sqlite de una app **en marcha** (lee el wal en su sitio).
salida json estructurada para que un agente la consuma; `--format table|csv` y
`--pretty` para humanos. el sql viaja por env (DBQ_*), nunca interpolado.

```bash
# orientarse
tooling/db/db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db tables
tooling/db/db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db schema albums

# leer (--readonly = candado de seguridad contra mutaciones accidentales)
tooling/db/db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db --readonly \
    query "select id, name from artists limit 20"

# escribir (acceso total por defecto); '-' lee el sql de stdin
echo "update flags set on=1 where k='beta'" | \
    tooling/db/db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db query -

# local (host python3) sobre un fichero suelto, sin docker
tooling/db/db-sqlite.sh --mode local --db ./packages/api/data/duckhunt.db count users
```

comandos: `query` · `exec` (multi-sentencia) · `tables` · `schema [tabla]` ·
`count <tabla>`. modo `docker` (node+better-sqlite3 dentro del contenedor) o
`local` (python3 stdlib en el host); `docker` se infiere si pasas `--container`.

## convenciones

- comentarios en español lowercase, código en inglés (igual que las apps)
- node 22 (.nvmrc) + pnpm
- pendiente (roadmap): billing/entitlements cuando exista pricing, scaffolder
  de apps nuevas, migración de carreterinas

### convenciones web (móvil/tablet)

las apps con shell capacitor (spa empaquetada) comparten estas señales. NO las
confundas: cada una responde a una pregunta distinta.

**1. navegación → `html.compact`** (¿layout de navegación móvil?). compact =
viewport estrecho (`<= breakpoint`) **O** app nativa (un tablet nativo es ancho pero
queremos bottombar igualmente). lo gestiona `@platform/mobile/compact`:

```ts
// root +layout (post-hidratación): marca .native + mantiene .compact
import { installCompact } from '@platform/mobile/compact';
onMount(() => installCompact({ breakpoint: 720 }));
```

```html
<!-- app.html <head> (pre-paint, evita FOUC en web estrecha). app.html es estático,
     no puede importar el módulo: pegar el snippet con el MISMO breakpoint. -->
<script>(function(){var r=document.documentElement;r.classList.toggle('compact',window.matchMedia('(max-width:720px)').matches);})();</script>
```

en css, la croma de navegación keya de `html.compact` (`html.compact .bottombar`, y
en componentes svelte `:global(html.compact) .x`).

**2. densidad de contenido → `@media`** (¿cuánto cabe?). por ancho/orientación real,
NO por `html.compact` (un tablet apaisado es ancho de verdad → densidad de escritorio):

```css
@media (max-width: 720px), (orientation: portrait) and (max-width: 1024px) {
  /* tarjetas en vez de tablas, modales fullscreen, etc. móvil o tablet en vertical. */
}
```

el `1024px` inclusivo cubre el iPad Pro 12.9" en vertical; la orientación lo distingue
del iPad apaisado (que se queda en desktop).

**3. interacción táctil → `@media (hover: none)`** (¿hay hover?). en táctil no existe
hover: los affordances que en desktop se revelan al pasar el ratón (acciones de fila,
checks) deben ir siempre visibles. el hide-on-hover va dentro de `@media (hover: hover)`.

**primitivas css compartidas** (`@platform/ui/base.css`, importar al principio del
app.css): anti-zoom de iOS en inputs (`<16px` dispara zoom al enfocar), utilidad
`.u-safe-px` (safe-area lateral en landscape) y `.u-touch-show` (reveal-en-táctil).

**drag & drop**: el drag HTML5 (`draggable`/`dataTransfer`) **no existe en iOS
Safari/WKWebView**. si una vista lo usa, dale una alternativa táctil (menú/acciones);
no asumas que el drag funciona en la app nativa.

† carreterinas pendiente de migrar (svelte 4 → 5, bun → node, split api/web).

## licencia

[CC BY-NC-SA 4.0](./LICENSE) (Creative Commons Attribution-NonCommercial-ShareAlike
4.0 International). puedes usar, adaptar y redistribuir el código con fines **no
comerciales**, citando la autoría y compartiendo las obras derivadas bajo la misma
licencia. © Juan Mier.
