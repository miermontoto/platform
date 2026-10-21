# el nombre del pod lo deriva capacitor del nombre npm (@platform/capacitor-native-tabs →
# PlatformCapacitorNativeTabs): el fichero y s.name deben coincidir con él o `pod install`
# falla con "No podspec found".
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'PlatformCapacitorNativeTabs'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/miermontoto/platform'
  s.author = package['author']
  s.source = { :git => 'https://github.com/miermontoto/platform.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
