#!/usr/bin/env bash
# añade una app extension (widgets, share…) al proyecto ios/ que ci regenera en cada run, con el gem xcodeproj
# y desde fuentes commiteadas: swift + Info.plist + <nombre>.entitlements. lo usan ios-release.yml (firmada) e
# ios-simulator.yml (sin firma: sin EXT_PROFILE no toca la firma). corre en packages/web/ios/App, DESPUÉS del
# cap sync (pod install no toca este target: no está en el Podfile) y de fijar la versión (la extensión debe
# llevar la MISMA CFBundleShortVersionString/Version que la app o App Store Connect rechaza el binario).
# el app group va en los entitlements de AMBOS targets: es el keychain access group / contenedor que comparten.
#
# obligatorias: EXT_NAME (target y carpeta), EXT_SRC (relativa a packages/web), EXT_BUNDLE_ID, EXT_MIN_IOS.
# opcionales: APP_GROUP, MARKETING_VERSION + BUILD_NUMBER, EXT_PROFILE + APPLE_TEAM_ID (firma manual).
set -euo pipefail

: "${EXT_NAME:?}" "${EXT_SRC:?}" "${EXT_BUNDLE_ID:?}" "${EXT_MIN_IOS:?}"
SRC="$GITHUB_WORKSPACE/packages/web/$EXT_SRC"
[ -d "$SRC" ] || { echo "::error::el dir de la extensión no existe: $SRC"; exit 1; }
# -L: un symlink a un fichero de otro dir de fuentes (una sola copia para dos targets) se resuelve al copiar.
rm -rf "$EXT_NAME" && mkdir "$EXT_NAME" && cp -RL "$SRC"/. "$EXT_NAME"/
[ -f "$EXT_NAME/Info.plist" ] || { echo "::error::falta Info.plist en $EXT_SRC"; exit 1; }
ENT=$(ls "$EXT_NAME"/*.entitlements | head -1)
[ -n "$ENT" ] || { echo "::error::falta <nombre>.entitlements en $EXT_SRC"; exit 1; }

set_plist() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$EXT_NAME/Info.plist" \
    || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$EXT_NAME/Info.plist"
}
if [ -n "${MARKETING_VERSION:-}" ]; then
  set_plist CFBundleShortVersionString "$MARKETING_VERSION"
  set_plist CFBundleVersion "$BUILD_NUMBER"
fi

add_group() {
  local f="$1"
  [ -f "$f" ] || printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict/></plist>\n' > "$f"
  /usr/libexec/PlistBuddy -c "Delete :com.apple.security.application-groups" "$f" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.application-groups array" "$f"
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.application-groups:0 string $APP_GROUP" "$f"
}
if [ -n "${APP_GROUP:-}" ]; then
  add_group "$ENT"
  add_group App/App.entitlements
fi
echo "== entitlements de $EXT_NAME =="; cat "$ENT"

gem list -i xcodeproj >/dev/null 2>&1 || sudo gem install xcodeproj --no-document
ENT_NAME=$(basename "$ENT") ruby -e '
  require "xcodeproj"
  name = ENV["EXT_NAME"]
  project = Xcodeproj::Project.open("App.xcodeproj")
  app = project.targets.find { |t| t.name == "App" } or abort("target App no encontrado")
  ext = project.new_target(:app_extension, name, :ios, ENV["EXT_MIN_IOS"])
  group = project.main_group.new_group(name, name)
  Dir.glob("#{name}/*.swift").sort.each { |f| ext.add_file_references([group.new_file(File.basename(f))]) }
  group.new_file("Info.plist")
  group.new_file(ENV["ENT_NAME"])
  ext.build_configurations.each do |c|
    # explícito: sin PRODUCT_NAME el producto sale como ".appex" (nombre vacío) y el
    # archive muere con "Multiple commands produce .../.appex".
    c.build_settings["PRODUCT_NAME"] = name
    c.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = ENV["EXT_BUNDLE_ID"]
    c.build_settings["INFOPLIST_FILE"] = "#{name}/Info.plist"
    c.build_settings["GENERATE_INFOPLIST_FILE"] = "NO"
    c.build_settings["CODE_SIGN_ENTITLEMENTS"] = "#{name}/#{ENV["ENT_NAME"]}"
    c.build_settings["SWIFT_VERSION"] = "5.0"
    c.build_settings["IPHONEOS_DEPLOYMENT_TARGET"] = ENV["EXT_MIN_IOS"]
    c.build_settings["TARGETED_DEVICE_FAMILY"] = "1,2"
    c.build_settings["SKIP_INSTALL"] = "YES"
    c.build_settings["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
    if ENV["EXT_PROFILE"].to_s != ""
      c.build_settings["CODE_SIGN_STYLE"] = "Manual"
      c.build_settings["DEVELOPMENT_TEAM"] = ENV["APPLE_TEAM_ID"]
      c.build_settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
      c.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = ENV["EXT_PROFILE"]
    end
  end
  # la app también necesita el app group (sin SIWA no había fichero de entitlements).
  if ENV["APP_GROUP"].to_s != ""
    app.build_configurations.each { |c| c.build_settings["CODE_SIGN_ENTITLEMENTS"] = "App/App.entitlements" }
  end
  app.add_dependency(ext)
  # una sola fase de copia aunque haya varias extensiones.
  phase_name = "Embed Foundation Extensions"
  phase = app.copy_files_build_phases.find { |p| p.name == phase_name } || app.new_copy_files_build_phase(phase_name)
  phase.symbol_dst_subfolder_spec = :plug_ins
  phase.dst_path = ""
  phase.add_file_reference(ext.product_reference).settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
  project.save
'
echo "extensión $EXT_NAME añadida (bundle $EXT_BUNDLE_ID, perfil '${EXT_PROFILE:-sin firma}')"
