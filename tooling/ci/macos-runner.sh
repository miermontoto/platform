#!/bin/bash
# prepara un mac como runner propio de github actions para las apps de la plataforma: toolchain de ios y
# android para el usuario del runner y un runner por repo como LaunchDaemon. idempotente: se relanza igual
# para añadir un repo, rehacer el .env/.path o actualizar el toolchain.
#
# lo que los workflows de .github/workflows esperan de un mac propio (etiqueta --label, ia01-macos por
# defecto): Xcode instalado (lo elige la action xcode por DEVELOPER_DIR, sin xcode-select), cocoapods y el gem
# xcodeproj en el ruby del PATH, ANDROID_HOME con las licencias aceptadas, locale utf-8 (cocoapods aborta sin
# él) y ningún sudo: node, pnpm y el jdk los pone cada job (setup-node, pnpm/action-setup, setup-java).
#
# por qué así:
# - un runner POR REPO: en una cuenta personal de github los runners propios solo se registran por repo. cada
#   uno corre un job a la vez, así que un mac hace como mucho un job por app a la vez, todos con el mismo
#   usuario: por eso los workflows anteponen su keychain al search list y dejan los secretos en RUNNER_TEMP.
# - LaunchDaemon con UserName y SessionCreate, no el LaunchAgent de svc.sh: el agente solo arranca con el
#   usuario logueado en la consola, y el del runner no lo está nunca. SessionCreate da la sesión de seguridad
#   que necesitan el keychain temporal y codesign.
# - Nice: los mac comparten equipo con exo (inferencia) y los builds le ceden cpu.
# - ruby de homebrew + GEM_HOME del usuario: el ruby del sistema (2.6) no instala el cocoapods actual, y con
#   los gems en el home del runner se actualizan sin tocar homebrew.
# - un servicio solo se recarga si su plist cambia: recargarlo mataría el job que esté corriendo.
#
# uso: como el administrador dueño de homebrew (con sudo), una línea por repo en stdin: "<owner/repo> [token]".
# el token de registro (1 h de vida) solo hace falta para un repo que aún no tenga runner en este mac:
#   gh api -X POST repos/<owner/repo>/actions/runners/registration-token -q .token
#
#   printf '%s\n' "miermontoto/duckhunt $TOKEN" | tooling/ci/macos-runner.sh --user adm-juan --name mac-1

set -euo pipefail

readonly RUNNER_ARCH=osx-arm64
readonly RUNNER_RELEASE_API=https://api.github.com/repos/actions/runner/releases/latest
readonly BREW=/opt/homebrew/bin/brew
readonly RUBY_BIN=/opt/homebrew/opt/ruby/bin
readonly JDK_HOME=/opt/homebrew/opt/openjdk@21
readonly SDKMANAGER=/opt/homebrew/bin/sdkmanager
readonly DAEMON_DIR=/Library/LaunchDaemons

RUNNER_USER="" NAME="$(hostname -s)" LABEL=ia01-macos NICE=5
ANDROID_PACKAGES="cmdline-tools;latest platform-tools platforms;android-36 build-tools;35.0.0 build-tools;36.0.0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) RUNNER_USER="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --nice) NICE="$2"; shift 2 ;;
    --android-packages) ANDROID_PACKAGES="$2"; shift 2 ;;
    *) echo "[macos-runner] flag desconocida: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[macos-runner] $*"; }
die() { echo "[macos-runner] $*" >&2; exit 1; }

[[ -n $RUNNER_USER ]] || die "falta --user (el usuario macOS que corre los jobs)"
[[ ! -t 0 ]] || die "pasa los repos por stdin: una línea \"<owner/repo> [token]\" por repo"
[[ $(uname -m) == arm64 ]] || die "solo apple silicon ($RUNNER_ARCH)"
id "$RUNNER_USER" >/dev/null 2>&1 || die "no existe el usuario $RUNNER_USER: créalo antes (sysadminctl -addUser)"
[[ -x $BREW && -O /opt/homebrew ]] || die "homebrew en /opt/homebrew, y este script como su dueño ($(stat -f %Su /opt/homebrew 2>/dev/null))"
xcode-select -p >/dev/null || die "falta Xcode (xcodes install …)"

REPOS=$(cat)
UHOME=$(dscl . -read "/Users/$RUNNER_USER" NFSHomeDirectory | awk '{print $2}')
readonly SDK="$UHOME/Library/Android/sdk" GEMS="$UHOME/.gem" RUNNERS="$UHOME/actions-runner"
# PATH de los jobs (.path del runner): gems del usuario y ruby de homebrew delante del ruby del sistema
readonly JOB_PATH="$GEMS/bin:$RUBY_BIN:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$SDK/platform-tools"

# ejecuta como el usuario del runner, con su HOME
as_user() { sudo -u "$RUNNER_USER" -H "$@"; }

install_brew_deps() {
  log "homebrew: ruby, openjdk@21 (para sdkmanager), android-commandlinetools"
  HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 "$BREW" install --quiet ruby openjdk@21
  HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 "$BREW" install --quiet --cask android-commandlinetools
}

install_user_toolchain() {
  log "$RUNNER_USER: cocoapods en $GEMS"
  as_user env GEM_HOME="$GEMS" PATH="$JOB_PATH" bash -c 'gem list -i cocoapods >/dev/null || gem install --no-document cocoapods'
  as_user env GEM_HOME="$GEMS" PATH="$JOB_PATH" ruby -e 'require "xcodeproj"' || die "el ruby de los jobs no carga xcodeproj"
  log "$RUNNER_USER: android sdk en $SDK ($ANDROID_PACKAGES)"
  as_user mkdir -p "$SDK"
  # sin pipe a propósito: con pipefail, el SIGPIPE de `yes` al acabar sdkmanager tumbaría el script
  as_user env JAVA_HOME="$JDK_HOME" "$SDKMANAGER" --sdk_root="$SDK" --licenses < <(yes) >/dev/null
  # ANDROID_PACKAGES sin comillas: un argumento por paquete
  as_user env JAVA_HOME="$JDK_HOME" "$SDKMANAGER" --sdk_root="$SDK" $ANDROID_PACKAGES > /dev/null
}

# tarball del runner más reciente, verificado contra el sha256 que publica la release; imprime su ruta
runner_dist() {
  local json version sha tgz
  json=$(curl -fsSL "$RUNNER_RELEASE_API")
  version=$(plutil -extract tag_name raw -o - - <<< "$json")
  sha=$(plutil -extract body raw -o - - <<< "$json" | sed -n "s/.*BEGIN SHA $RUNNER_ARCH -->\([0-9a-f]*\)<.*/\1/p")
  [[ -n $sha ]] || die "la release $version no publica el sha256 de $RUNNER_ARCH"
  tgz="$RUNNERS/.dist/actions-runner-$RUNNER_ARCH-${version#v}.tar.gz"
  if [[ ! -f $tgz ]]; then
    as_user mkdir -p "$RUNNERS/.dist"
    as_user curl -fsSL -o "$tgz" "https://github.com/actions/runner/releases/download/$version/actions-runner-$RUNNER_ARCH-${version#v}.tar.gz"
  fi
  echo "$sha  $tgz" | shasum -a 256 -c --quiet >&2 || die "sha256 de $tgz no casa con la release $version"
  echo "$tgz"
}

# registra (si hace falta) el runner de un repo y fija su entorno
configure_runner() {
  local repo="$1" token="$2" tgz="$3" dir="$RUNNERS/${1#*/}"
  if [[ ! -f $dir/.runner ]]; then
    [[ -n $token ]] || die "$repo no tiene runner en este mac: pasa su token de registro"
    log "$repo: registrando $NAME ($LABEL)"
    as_user mkdir -p "$dir"
    as_user tar xzf "$tgz" -C "$dir"
    as_user bash -c 'cd "$1" && ./config.sh --unattended --url "https://github.com/$2" --token "$3" --name "$4" --labels "$5" --work _work --replace' \
      _ "$dir" "$repo" "$token" "$NAME" "$LABEL"
  fi
  # config.sh vuelca el entorno de quien lo ejecuta; se reescribe con el de los jobs. runsvc.sh se recopia
  # cada vez (como svc.sh install) por si una auto-actualización del runner lo cambió en bin/
  printf 'LANG=en_US.UTF-8\nLC_ALL=en_US.UTF-8\nANDROID_HOME=%s\nANDROID_SDK_ROOT=%s\nGEM_HOME=%s\n' "$SDK" "$SDK" "$GEMS" \
    | as_user tee "$dir/.env" >/dev/null
  printf '%s\n' "$JOB_PATH" | as_user tee "$dir/.path" >/dev/null
  as_user cp "$dir/bin/runsvc.sh" "$dir/runsvc.sh"
}

# LaunchDaemon del runner (plantilla bin/actions.runner.plist.template del propio runner, de sistema)
install_daemon() {
  local repo="$1" dir="$RUNNERS/${1#*/}" label="actions.runner.${1/\//-}.$NAME" new
  local plist="$DAEMON_DIR/$label.plist" logs="$UHOME/Library/Logs/$label"
  as_user mkdir -p "$logs"
  new=$(mktemp)
  cat > "$new" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key><array><string>$dir/runsvc.sh</string></array>
    <key>UserName</key><string>$RUNNER_USER</string>
    <key>GroupName</key><string>staff</string>
    <key>WorkingDirectory</key><string>$dir</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$logs/stdout.log</string>
    <key>StandardErrorPath</key><string>$logs/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ACTIONS_RUNNER_SVC</key><string>1</string>
      <key>HOME</key><string>$UHOME</string>
      <key>USER</key><string>$RUNNER_USER</string>
      <key>LOGNAME</key><string>$RUNNER_USER</string>
    </dict>
    <key>ProcessType</key><string>Interactive</string>
    <key>Nice</key><integer>$NICE</integer>
    <key>SessionCreate</key><true/>
  </dict>
</plist>
PLIST
  plutil -lint -s "$new" || die "plist inválido para $label"
  if sudo cmp -s "$new" "$plist" && sudo launchctl print "system/$label" >/dev/null 2>&1; then
    log "$repo: servicio $label sin cambios"
  else
    sudo install -m 644 -o root -g wheel "$new" "$plist"
    if sudo launchctl print "system/$label" >/dev/null 2>&1; then sudo launchctl bootout "system/$label"; fi
    sudo launchctl bootstrap system "$plist"
    log "$repo: servicio $label cargado"
  fi
  rm -f "$new"
}

install_brew_deps
install_user_toolchain
TGZ=$(runner_dist)
while read -r repo token <&3; do
  [[ -n $repo ]] || continue
  configure_runner "$repo" "${token:-}" "$TGZ"
  install_daemon "$repo"
done 3<<< "$REPOS"
log "listo: $(sudo launchctl list | grep -c "actions.runner\..*\.$NAME$") runners de $NAME cargados"
