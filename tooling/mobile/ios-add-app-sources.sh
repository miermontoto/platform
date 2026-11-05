#!/usr/bin/env bash
# añade al target App las fuentes nativas commiteadas en APP_SRC (relativo a packages/web): swift, string
# catalogs y <lang>.lproj/*.strings, con el gem xcodeproj (el proyecto ios/ se regenera en cada run). los
# catálogos solo compilan los idiomas de knownRegions, así que se registran los que traigan (el de desarrollo
# va siempre). corre en packages/web/ios/App, tras el cap sync: pod install no toca estos ficheros. lo usan
# ios-release.yml e ios-simulator.yml.
#
# APP_LAUNCH_HOOK (opcional) = una sentencia swift que se inserta al principio de
# application(_:didFinishLaunchingWithOptions:). es el único punto que corre también en un arranque en segundo
# plano, sin escena ni webview (el load() de un plugin de capacitor no llega ahí). una extensión del AppDelegate no
# puede sobreescribir ese método, y la plantilla de `cap add` ya lo define.
set -euo pipefail

: "${APP_SRC:?}"
SRC="$GITHUB_WORKSPACE/packages/web/$APP_SRC"
[ -d "$SRC" ] || { echo "::error::app_sources_dir no existe: $SRC"; exit 1; }
DEST="App/$(basename "$APP_SRC")"
# -L: un symlink a un fichero de otro dir de fuentes (una sola copia para dos targets) se resuelve al copiar.
rm -rf "$DEST" && mkdir -p "$DEST" && cp -RL "$SRC"/. "$DEST"/
gem list -i xcodeproj >/dev/null 2>&1 || sudo gem install xcodeproj --no-document
DEST="$DEST" ruby -rjson -e '
  require "xcodeproj"
  project = Xcodeproj::Project.open("App.xcodeproj")
  app = project.targets.find { |t| t.name == "App" } or abort("target App no encontrado")
  group = project.main_group.find_subpath("App", true).new_group(File.basename(ENV["DEST"]), File.basename(ENV["DEST"]))
  swift = Dir.glob("#{ENV["DEST"]}/*.swift").sort
  catalogs = Dir.glob("#{ENV["DEST"]}/*.xcstrings").sort
  app.add_file_references(swift.map { |f| group.new_file(File.basename(f)) })
  app.add_resources(catalogs.map { |f| group.new_file(File.basename(f)) })
  # <lang>.lproj/<nombre>.strings → un variant group por nombre (p.ej.
  # AppShortcuts.strings, cuyo .xcstrings exige deployment target 17).
  strings = Dir.glob("#{ENV["DEST"]}/*.lproj/*.strings").sort
  variants = strings.group_by { |f| File.basename(f) }.map do |name, files|
    variant = group.new_variant_group(name)
    files.each { |f| variant.new_file("#{File.basename(File.dirname(f))}/#{name}").name = File.basename(File.dirname(f), ".lproj") }
    variant
  end
  variants.each { |v| app.resources_build_phase.add_file_reference(v, true) }
  langs = catalogs.flat_map { |f| JSON.parse(File.read(f))["strings"].values.flat_map { |v| (v["localizations"] || {}).keys } } +
    strings.map { |f| File.basename(File.dirname(f), ".lproj") }
  project.root_object.known_regions = (project.root_object.known_regions + langs).uniq
  project.save
  puts "target App: #{swift.size} swift, #{catalogs.size} catálogos, #{strings.size} .strings, regiones #{project.root_object.known_regions.join(",")}"
'

if [ -n "${APP_LAUNCH_HOOK:-}" ]; then
  # tras la firma del método, con la sentencia en su propia línea; si la plantilla cambia, se corta aquí y no
  # en el dispositivo (la sentencia entera se comprueba después, literal).
  HOOK="$APP_LAUNCH_HOOK" perl -0pi -e 's/(didFinishLaunchingWithOptions[^\n]*\{\n)/$1        $ENV{HOOK}\n/' App/AppDelegate.swift
  grep -qF "$APP_LAUNCH_HOOK" App/AppDelegate.swift \
    || { echo "::error::no se pudo insertar el arranque en App/AppDelegate.swift (¿cambió la plantilla de capacitor?)"; exit 1; }
  echo "AppDelegate: arranque insertado ($APP_LAUNCH_HOOK)"
fi
