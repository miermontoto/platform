# platform

paquetes compartidos de las apps (sis, duckhunt, carreterinas). cada app vive en
su propio repo y consume este como **git submodule** en `platform/`, incluyendo
`platform/packages/*` en su pnpm-workspace (deps `workspace:*`, fuente ts sin build).

## paquetes

```
packages/
  config/     tsconfig base + presets de vite (pwa + proxy dev + i18n paraglide)
  core-api/   hono base, gate de sesión, spa estática, bootstrap del servidor, .env,
              ws-hub (pub/sub por usuario), telemetría http (span + access log)
  db/         factoría sqlite (wal + pragmas + unaccent + migraciones drizzle +
              spans por query y log de queries lentas)
  observability/
              opentelemetry: trazas + logs estructurados, logger con scope,
              bridge de console.*, fetch saliente con traceparent, withSpan
  auth/       tabla canónica de sesiones + servicio de ciclo de vida
  ui/         componentes svelte compartidos (SettingsTabs, SessionsPanel,
              PrivacyPolicy, Support, LanguageSwitcher) + http + i18n +
              base.css (primitivas css móvil/táctil)
  mobile/     shell capacitor (config factory; spa empaquetada + api remota via
              VITE_API_BASE) + compact + system-bars + connectivity + deep-link
tooling/
  backup/     backup-sqlite.sh — copia segura + rotación recent/weekly (docker|local)
  db/         db-sqlite.sh — acceso sqlite en caliente (docker|local), salida json
  observability/
              compose de openobserve (backend otlp) + obs.sh — consulta de trazas
              y logs desde terminal, salida json
  mobile/     generadores de icons/splash android+ios desde el logo de la app
  store/      capturas de tienda: renderer html → png por cdp + specs de app store y
              google play + checker (tamaños, alpha, límites, safe areas)
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

## trazas y logs

cada api llama a `initTelemetry` justo después de `loadAppEnv` (los deps
`@opentelemetry/*` que lista el `package.json` de `@platform/observability` van
también en el de la api: tsup los deja externos). con eso, sin más código:

- **http**: span por request (`GET /api/albums/:id`, status, `user.id` vía el gate de
  sesión) + access log `[http] GET /api/x 200 12ms trace=<id>`. la respuesta lleva
  `x-trace-id` y los 500 de `/api` devuelven `{ error, traceId }`.
- **sqlite**: span hijo por sentencia dentro de una traza; las que pasan de
  `DB_SLOW_QUERY_MS` (100) se loguean siempre como `[db] query lenta`.
- **fetch saliente**: span hijo + `traceparent`, así la traza sigue en el servicio
  destino (p.ej. el login oidc contra mier.info). query params sensibles redactados.
- **logs**: `createLogger(scope)` y los `console.*` existentes (bridge: el `[scope]`
  manual pasa a ser el scope) salen con trace id; `LOG_LEVEL`, `LOG_FORMAT=json`.
- **background**: los ticks de pollers/jobs se envuelven en
  `withSpan(name, fn, { root: true })` para tener traza propia.

el export solo se activa con `OTEL_EXPORTER_OTLP_ENDPOINT`; sin él las trazas viven en
proceso (trace id en logs y respuestas) y no salen de la máquina.

```bash
# backend (una vez): openobserve en 172.17.0.1:5080, retención 14 días
cp tooling/observability/.env.example tooling/observability/.env   # rellenar password
docker compose -f tooling/observability/docker-compose.yml up -d

# en el .env de cada app
OTEL_EXPORTER_OTLP_ENDPOINT=http://172.17.0.1:5080/api/default
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 de email:password>

# consultas (json): errores, lo más lento, sql por tiempo total, una traza entera
tooling/observability/obs.sh errors --service duckhunt --since 6h
tooling/observability/obs.sh slow --kind http --min-ms 500
tooling/observability/obs.sh queries --service sis
tooling/observability/obs.sh trace <trace_id>
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

## capturas de tienda

cada app replica sus pantallas en html en `assets/store/` (`index.html` + `screens.js`, que
también se publica como artifact para revisarlas) y las exporta con el renderer compartido desde
un `assets/store/render.mjs` fino:

```js
import { renderStore } from '../../platform/tooling/store/render.mjs';
renderStore({ dir: HERE, port: 9471, fonts: { families: ['Inter', 'JetBrains Mono'] } });
// fuentes locales: fonts: { dir, files: { Geist: 'Geist-Variable.woff2' } } · extra: routes,
// pages, chromeArgs y modes ({ maps: async (page) => … } se lanza con --maps)
```

```bash
node assets/store/render.mjs [filtro]   # exporta a assets/<tienda>/<idioma>/<slot>/ y valida
node assets/store/render.mjs --check    # solo valida los png ya exportados
node assets/store/render.mjs --serve    # galería en local
```

contrato: `window.STORE.manifest()` devuelve `[{ hash: 'x.<marco>.<n>.<lang>', w, h, outputs:
[{ path, scale }] }]` (px css × scale = px de tienda); la página pinta ese marco con `#<hash>`. las
rutas siguen `<tienda>/<idioma>/<slot>/<nn>-<slug>.png`, un slot por casilla de subida (p.ej.
`app-store/es/iphone-duo/`, `app-store/es/creative/header.png`, `play-store/en/tablet-7in/`), con
los textos de la ficha en `<tienda>/<idioma>/*.txt`. el iPhone Duo es un solo slot: exterior e
interior suman como máximo 10. el checker (`tooling/store/specs.mjs` es la fuente de tamaños) falla si un png no lo aceptaría la
tienda, si tiene alpha, si un slot pasa del máximo por idioma (10 app store, 8 play) o si falta
uno obligatorio (iphone dynamic island mediano 1206×2622, ipad 13"). en los creative de ios 27
(header 21:9 3840×1646, búsqueda 3:2 hasta 3840×2560) lo que marca `[data-safe]` debe caer en la
safe area de las plantillas de apple, que es pequeña y centrada: el fondo va a sangre.

## convenciones

- comentarios en español lowercase, código en inglés (igual que las apps)
- node 22 (.nvmrc) + pnpm
- pendiente (roadmap): billing/entitlements cuando exista pricing, scaffolder
  de apps nuevas

### convenciones web (móvil/tablet)

las apps con shell capacitor (spa empaquetada) comparten estas señales. NO las
confundas: cada una responde a una pregunta distinta.

**1. navegación → `html.compact`** (¿layout de navegación móvil?). compact =
viewport estrecho (`<= breakpoint`) **O** app nativa, salvo un tablet en horizontal
(`TABLET_LANDSCAPE_QUERY`: apaisado, ≥800px de ancho y ≥600px de alto — el alto deja
al móvil en horizontal en compacto; el ancho incluye la pantalla interior de los plegables). el tablet nativo en vertical se queda compacto (con
bottombar), igual que la densidad. lo gestiona `@platform/mobile/compact`:

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

## licencia

[CC BY-NC-SA 4.0](./LICENSE) (Creative Commons Attribution-NonCommercial-ShareAlike
4.0 International). puedes usar, adaptar y redistribuir el código con fines **no
comerciales**, citando la autoría y compartiendo las obras derivadas bajo la misma
licencia. © Juan Mier.
