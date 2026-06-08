# platform

paquetes compartidos de las apps (sis, duckhunt, carreterinas†). cada app vive en
su propio repo y consume este como **git submodule** en `platform/`, incluyendo
`platform/packages/*` en su pnpm-workspace (deps `workspace:*`, fuente ts sin build).

## paquetes

```
packages/
  config/     tsconfig base + presets de vite (pwa + proxy dev)
  core-api/   hono base, gate de sesión, spa estática, bootstrap del servidor, .env
  db/         factoría sqlite (wal + pragmas + unaccent + migraciones drizzle)
  auth/       tabla canónica de sesiones + servicio de ciclo de vida
  ui/         transporte http compartido de los clientes web
  mobile/     shell capacitor (config factory; spa empaquetada + api remota via VITE_API_BASE)
tooling/
  backup/     backup-sqlite.sh — copia segura + rotación recent/weekly (docker|local)
  db/         db-sqlite.sh — acceso sqlite en caliente (docker|local), salida json
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

## backups

```bash
tooling/backup/backup-sqlite.sh --app sis --mode docker --container sis-sis-1 \
    --db /app/data/sis.db --dest /home/mier/dev/sis/data/backups
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
- pendiente (roadmap): billing/entitlements cuando exista pricing, shells
  capacitor, scaffolder de apps nuevas, migración de carreterinas

† carreterinas pendiente de migrar (svelte 4 → 5, bun → node, split api/web).
