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
tooling/
  backup/     backup-sqlite.sh — copia segura + rotación recent/weekly (docker|local)
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

## convenciones

- comentarios en español lowercase, código en inglés (igual que las apps)
- node 22 (.nvmrc) + pnpm
- pendiente (roadmap): billing/entitlements cuando exista pricing, shells
  capacitor, scaffolder de apps nuevas, migración de carreterinas

† carreterinas pendiente de migrar (svelte 4 → 5, bun → node, split api/web).
