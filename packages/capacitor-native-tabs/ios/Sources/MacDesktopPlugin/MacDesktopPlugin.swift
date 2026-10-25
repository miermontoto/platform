import Foundation
import Capacitor
import UIKit
import WebKit

/// la app de ios en un mac (iOS Apps on Mac en apple silicon, o un build mac catalyst): es el
/// mismo binario que en el iPad, así que sin esto la web se pinta como en una tablet táctil y a
/// escala de iPad. dos ajustes en `load`, antes de la primera página (el bridge carga los plugins
/// en su init, con el webview ya creado y sin navegar todavía):
///
/// - marca `<html class="mac">` con un user script al inicio del documento, así la web lo ve
///   antes del primer paint y en cada recarga. @platform/mobile pinta entonces el escritorio que
///   pintaría safari: installCompact no marca .native (cromo táctil) ni fuerza compact, y
///   native-tab-bar no monta la barra nativa (navega la web).
/// - compensa la escala del idiom iPad: macos pinta una app con idiom iPad al 77% para que sus
///   métricas de iPad (texto de 17pt) encajen con las del mac (13pt), y la web, que ya trae sus
///   tamaños de escritorio, saldría diminuta. el pageZoom inverso deja 1px css = 1pt del mac, como
///   en safari. con idiom mac (catalyst «optimize interface for mac») no hay escala que compensar.
///
/// sin métodos js. vive en este pod porque decide el cromo nativo de todas las apps (en el mac no
/// hay barra de pestañas) y así llega a todas sin otra dependencia. isMacCatalystApp es true en
/// ambos casos (iOS Apps on Mac y catalyst); isiOSAppOnMac solo en el primero.
@objc(MacDesktopPlugin)
public class MacDesktopPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MacDesktopPlugin"
    public let jsName = "MacDesktop"
    public let pluginMethods: [CAPPluginMethod] = []

    // escala con la que macos pinta una app con idiom iPad (hig de mac catalyst: 77%).
    private static let padIdiomScale: CGFloat = 0.77
    // clase de <html>: contrato con MAC_CLASS de @platform/mobile/compact.
    private static let macClass = "mac"

    override public func load() {
        guard ProcessInfo.processInfo.isMacCatalystApp, let webView = bridge?.webView else { return }
        let script = "document.documentElement.classList.add('\(MacDesktopPlugin.macClass)');"
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        guard UIDevice.current.userInterfaceIdiom == .pad else { return }
        webView.pageZoom = 1 / MacDesktopPlugin.padIdiomScale
    }
}
