#!/bin/bash
# build de simulador de una app de la plataforma en un mac + arranque en un dispositivo del
# simulador, para enseñarla en local. versión local de ios-simulator.yml: el proyecto ios/ no
# se commitea (ci lo regenera en cada run con cap add), así que aquí se scaffoldea igual
# (cocoapods, deployment target, url scheme del oauth, app icon y splash de marca) y se compila
# SIN firma. la config sale del caller .github/workflows/ios-release.yml de la app (icon_bg,
# deep_link_scheme, logo_path, logo_has_background, min_ios_version): nada que duplicar por app.
# sin widgets ni intents (piden firma y app group): para eso, TestFlight.
#
# requisitos del mac (una vez): Xcode 27.1+ y su runtime de simulador ios, node 22, pnpm,
# cocoapods (brew install cocoapods) y un locale utf-8 (el script lo exporta para sí mismo).
#
# uso (desde la raíz de la app; o --app <dir> desde cualquier sitio):
#   platform/tooling/mobile/ios-sim.sh                        # build + lanzar en el iPhone Duo
#   platform/tooling/mobile/ios-sim.sh --device "iPhone 18 Pro"
#   platform/tooling/mobile/ios-sim.sh --skip-web             # reusa el build web: solo nativo
#   platform/tooling/mobile/ios-sim.sh --fresh                # regenera packages/web/ios
#   platform/tooling/mobile/ios-sim.sh --no-launch            # solo build
#
# --device es una subcadena del device type (el nombre exacto gana: "iPhone 18 Pro" no cae en
# el Pro Max); se reusa el dispositivo de ese tipo en el runtime ios más nuevo que lo soporte o
# se crea. packages/web/ios/ queda en el árbol de la app: añádelo a su .gitignore.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$PWD" DEVICE="iPhone Duo" FRESH=0 SKIP_WEB=0 LAUNCH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP_DIR="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    --skip-web) SKIP_WEB=1; shift ;;
    --no-launch) LAUNCH=0; shift ;;
    *) echo "[ios-sim] flag desconocida: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[ios-sim] $*"; }
die() { echo "[ios-sim] $*" >&2; exit 1; }

# cocoapods aborta (o avisa y falla después) sin un locale utf-8
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

for t in xcodebuild pod node pnpm; do
  command -v "$t" >/dev/null || die "falta $t en el PATH"
done

APP_DIR="$(cd "$APP_DIR" && pwd)"
WEB="$APP_DIR/packages/web"
IOS="$WEB/ios"
CALLER="$APP_DIR/.github/workflows/ios-release.yml"
[[ -f "$WEB/capacitor.config.ts" ]] || die "$APP_DIR no parece una app con shell capacitor (falta packages/web/capacitor.config.ts)"
[[ -f "$CALLER" ]] || log "aviso: sin $CALLER → sin icono de marca ni url scheme"

# input escalar del caller (`key: valor` en su bloque with:); lo que no es literal (${{ … }}) o
# falta → el default
input() {
  [[ -f "$CALLER" ]] || { echo "${2:-}"; return; }
  node -e '
    const [file, key, def] = process.argv.slice(1);
    const m = require("fs").readFileSync(file, "utf8").match(new RegExp(`^[ \\t]+${key}:[ \\t]*(.+?)(?:[ \\t]+#.*)?[ \\t]*$`, "m"));
    const v = m ? m[1].replace(/^([\x27"])(.*)\1$/, "$2") : "";
    console.log(!v || v.includes("${{") ? def : v);
  ' "$CALLER" "$1" "${2:-}"
}

APP=$(input app "$(basename "$APP_DIR")")
ICON_BG=$(input icon_bg)
SCHEME=$(input deep_link_scheme)
LOGO="$APP_DIR/$(input logo_path packages/web/assets/logo.png)"
LOGO_HAS_BG=$(input logo_has_background false)
MIN_IOS=$(input min_ios_version 15.0)
log "$APP: $(xcodebuild -version | head -1), sdk simulador $(xcrun --sdk iphonesimulator --show-sdk-version)"

# deps: ~/dev se sincroniza sin node_modules, así que el primer build en un mac instala
if [[ ! -d "$WEB/node_modules" ]]; then
  log "pnpm install"
  (cd "$APP_DIR" && pnpm install --frozen-lockfile)
fi

(( FRESH )) && rm -rf "$IOS"
NEW_SCAFFOLD=0
if [[ ! -d "$IOS" ]]; then
  log "scaffold ios (cap add, cocoapods; su error de copy sin build web es esperado)"
  # cocoapods explícito, como en ci: capacitor 8 scaffolda con spm por defecto. el copy de
  # cap add falla sin build web todavía (lo rehace el sync de mobile:build:ios), de ahí que el
  # éxito se mida por el Podfile y no por su exit code
  (cd "$WEB" && pnpm exec cap add ios --packagemanager CocoaPods) || true
  [[ -f "$IOS/App/Podfile" ]] || die "cap add ios no generó $IOS/App/Podfile"
  # deployment target ANTES del sync, que re-ejecuta pod install contra él (ver ios-release.yml)
  sed -i '' -E "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/IPHONEOS_DEPLOYMENT_TARGET = ${MIN_IOS};/g" "$IOS/App/App.xcodeproj/project.pbxproj"
  sed -i '' -E "s/platform :ios, '[0-9.]+'/platform :ios, '${MIN_IOS}'/" "$IOS/App/Podfile"
  NEW_SCAFFOLD=1
fi

# un scaffold nuevo no tiene la web dentro: el build web no se puede saltar
if (( SKIP_WEB && !NEW_SCAFFOLD )); then
  log "build web omitido (--skip-web)"
else
  log "build web + cap sync ios"
  (cd "$WEB" && pnpm run mobile:build:ios)
fi

# vuelta del oauth móvil por deep link: el Info.plist de capacitor no trae CFBundleURLTypes
PLIST="$IOS/App/App/Info.plist"
if [[ -n "$SCHEME" ]] && ! /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy \
    -c "Add :CFBundleURLTypes array" \
    -c "Add :CFBundleURLTypes:0 dict" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLName string $SCHEME" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string $SCHEME" \
    "$PLIST"
  log "url scheme $SCHEME registrado"
fi

# icono + splash de marca. sharp no es dependencia de las apps: entorno npm aislado y
# cacheado entre runs (en ci, uno efímero en RUNNER_TEMP)
if [[ -n "$ICON_BG" && -f "$LOGO" ]]; then
  SHARP_DIR="$HOME/Library/Caches/platform-mobile/sharp"
  if [[ ! -d "$SHARP_DIR/node_modules/sharp" ]]; then
    log "instalando sharp en $SHARP_DIR"
    mkdir -p "$SHARP_DIR"
    (cd "$SHARP_DIR" && npm init -y >/dev/null && npm i sharp --no-audit --no-fund >/dev/null)
  fi
  ASSETS="$IOS/App/App/Assets.xcassets"
  (cd "$SHARP_DIR" \
    && node "$HERE/generate-ios-icons.mjs" "{\"assetsDir\":\"$ASSETS\",\"logo\":\"$LOGO\",\"bgColor\":\"$ICON_BG\",\"logoHasBackground\":$LOGO_HAS_BG}" \
    && node "$HERE/generate-ios-splash.mjs" "{\"assetsDir\":\"$ASSETS\",\"logo\":\"$LOGO\",\"bgColor\":\"$ICON_BG\"}")
fi

DERIVED="$HOME/Library/Developer/Xcode/DerivedData/$APP-sim"
APP_PATH="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"
log "xcodebuild (simulador, sin firma) → $DERIVED"
(cd "$IOS/App" && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" CODE_SIGNING_ALLOWED=NO -quiet build)
[[ -d "$APP_PATH" ]] || die "el build no dejó $APP_PATH"
(( LAUNCH )) || { log "listo: $APP_PATH"; exit 0; }

# dispositivo: device type que case con DEVICE + el runtime ios más nuevo que lo soporte; se
# reusa uno disponible de ese tipo en ese runtime o se crea
UDID=$(DEVICE="$DEVICE" node -e '
  const { execFileSync } = require("child_process");
  const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
  const list = (kind) => JSON.parse(simctl("list", "-j", kind))[kind];
  const fail = (msg) => { console.error(`[ios-sim] ${msg}`); process.exit(1); };
  const want = process.env.DEVICE.toLowerCase();
  const types = list("devicetypes").filter((t) => t.name.toLowerCase().includes(want))
    .sort((a, b) => (b.name.toLowerCase() === want) - (a.name.toLowerCase() === want));
  if (!types.length) fail(`no hay device type que contenga "${process.env.DEVICE}"`);
  const ver = (r) => r.version.split(".").map(Number);
  const newer = (a, b) => ver(a).reduce((d, p, i) => d || p - (ver(b)[i] ?? 0), 0) > 0;
  const runtimes = list("runtimes").filter((r) => r.isAvailable && r.name.startsWith("iOS"));
  for (const type of types) {
    const rt = runtimes.filter((r) => r.supportedDeviceTypes.some((s) => s.identifier === type.identifier))
      .reduce((best, r) => (!best || newer(r, best) ? r : best), null);
    if (!rt) continue;
    const existing = (list("devices")[rt.identifier] ?? []).find((d) => d.isAvailable && d.deviceTypeIdentifier === type.identifier);
    console.log(existing ? existing.udid : simctl("create", type.name, type.identifier, rt.identifier).trim());
    process.exit(0);
  }
  fail(`ningún runtime ios instalado soporta "${process.env.DEVICE}" (runtimes: ${runtimes.map((r) => r.name).join(", ") || "ninguno"}). bájalo con: xcodebuild -downloadPlatform iOS`);
')

if ! xcrun simctl list devices booted | grep -qF "$UDID"; then
  log "arrancando $UDID"
  if ! xcrun simctl boot "$UDID"; then
    # tras instalar o actualizar un runtime, CoreSimulatorService puede quedarse con montajes
    # viejos ("runtime path not found" aunque simctl lo liste): se mata (launchd lo relanza
    # al siguiente simctl) y se reintenta una vez
    log "reiniciando CoreSimulatorService y reintentando"
    killall -9 com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null || true
    xcrun simctl boot "$UDID"
  fi
fi
xcrun simctl bootstatus "$UDID" -b >/dev/null
# visor: Xcode 27 sustituye Simulator.app por DeviceHub.app; por ruta, porque `open -a` no
# los encuentra hasta que launchservices los registra. sin visor la app corre igual (headless)
DEV="$(xcode-select -p)"
for viewer in "$DEV/../Applications/DeviceHub.app" "$DEV/Applications/Simulator.app"; do
  [[ -d "$viewer" ]] && { open "$viewer"; break; }
done

BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_PATH/Info.plist")
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null
log "$BUNDLE_ID lanzada en $UDID"
