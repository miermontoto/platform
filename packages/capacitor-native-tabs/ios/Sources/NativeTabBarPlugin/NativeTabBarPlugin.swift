import Foundation
import Capacitor
import UIKit

/// barra de pestañas nativa de ios: un UITabBar de verdad sobre el webview para que la
/// navegación principal de cada app lleve el liquid glass del sistema (cápsula flotante con sdk
/// 26; antes, la barra translúcida clásica). con css solo se podía imitar: el material lo pinta el
/// sistema. nació en duckhunt (t#439) y vive en platform para que todas las apps la compartan.
///
/// la web manda (@platform/mobile/native-tab-bar): pestañas, selección, visibilidad y tema llegan
/// en un único `render` con el estado COMPLETO (idempotente; los items solo se reconstruyen si cambian).
/// el nativo pinta y avisa de vuelta: `tabSelect` (id = ruta de la spa) y `layout` (alto que tapa
/// la barra desde el pie, para que el contenido pueda scrollear por encima de ella).
///
/// UITabBar suelto y no UITabBarController: el controller exige un view controller por pestaña y
/// mover el webview entre ellos, y aquí todas las pestañas son la MISMA spa. el precio: el scroll
/// edge effect (el difuminado bajo la barra) no llega solo; se engancha a mano con
/// UIScrollEdgeElementContainerInteraction al scroll view del webview.
///
/// una vista nativa siempre queda SOBRE el webview: lo que la web pinte encima (modales, menús,
/// hojas) no puede taparla, así que la web la oculta mientras hay un overlay abierto.
///
/// iPhone Duo: donde el sistema lleva sus barras a una columna lateral (`verticalBarEdge`:
/// pantalla exterior, interior en apaisado) las pestañas pasan a un rail vertical de cristal DENTRO
/// de esa columna (su inset de safe area), al pie y centrado bajo la cámara y la hora: donde la hig
/// pone la tab bar del sistema. el UITabBar no sabe ser vertical (el sistema solo gira las barras de
/// sus contenedores de navegación), así que el rail es propio: mismas pestañas, misma selección,
/// solo iconos (vertical = símbolo). si la columna fuese más estrecha que el rail, va pegado a ella
/// por dentro y lo que sobresale se cuenta a la web. el nativo decide el modo con el trait y lo
/// cuenta en `layout` (`edge` físico + `width` que tapa el rail más allá de la safe area) para que
/// la web reserve ese lado en vez del pie.
///
/// encima del rail va una segunda cápsula, la de acciones: lo que en una app nativa pondría la barra
/// de navegación que el sistema también lleva a la columna. primero atrás (si la web le da título),
/// que recorre el historial del webview y se apaga sin él (`canGoBack`), y detrás las acciones de la
/// web (buscar, la cuenta…), que avisan con `actionSelect` (id + caja del botón, para sacar un menú
/// a su lado). sin ninguna, solo queda el rail. la barra del pie no las lleva: fuera del Duo atrás es
/// el gesto del borde y la web conserva su cabecera.
///
/// el gesto de atrás del sistema (deslizar desde el borde) se enciende en `load` para todo iphone:
/// WKWebView lo trae apagado y capacitor no lo expone en su config. la spa navega con pushState y
/// esas entradas viven en el back-forward list del webview, así que el gesto recorre el historial de
/// la app (popstate → router) como en safari. android no lo necesita: su atrás lo gestiona
/// @capacitor/app. duckhunt hace lo mismo en su WebViewGesturesPlugin, que sobra al subir de platform.
///
/// el paquete lleva un módulo android vacío (ver android/build.gradle): sin él, `cap sync android`
/// rompe. capacitor registra la PRIMERA clase anotada con nombre objc de cada .swift, así que la
/// del plugin va la primera del fichero.
@objc(NativeTabBarPlugin)
public class NativeTabBarPlugin: CAPPlugin, CAPBridgedPlugin, UITabBarDelegate {
    public let identifier = "NativeTabBarPlugin"
    public let jsName = "NativeTabBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise)
    ]

    // fundido al mostrar/ocultar (overlay abierto, teclado, layout de escritorio).
    private static let fadeDuration: TimeInterval = 0.2
    // hueco mínimo del rail con los bordes de la columna, con el contenido y con el pie de la safe area.
    private static let railMargin: CGFloat = 6
    // el chevron de atrás del sistema: el mismo en todas las apps, la web solo pone su título.
    private static let backSymbol = "chevron.backward"
    private static let backId = "back"

    private var tabBar: NativeTabBarView?
    private var rail: NativeRailColumnView?
    // centro del rail a cierta distancia de su borde, uno por borde físico: el que toque se activa
    // al cambiar el trait (girar, abrir, plegar) y su distancia sale de la safe area (placeRail).
    private var railSideConstraints: [RailEdge: NSLayoutConstraint] = [:]
    // borde de la barra vertical del sistema; nil = sin ella (pestañas en el UITabBar del pie).
    private var railEdge: RailEdge?
    private var tabs: [NativeTab] = []
    // cápsula de acciones de la columna: título de atrás (nil = sin botón) y las de la web.
    private var backTitle: String?
    private var actions: [NativeTab] = []
    private var selected: String?
    private var showTitles = true
    private var dark = true
    private var tint: UIColor?
    // lo que pide la web (shell montado, sin overlay ni teclado); la vista que lo cumple sale del borde.
    private var wanted = false
    // lo que tapa la barra desde el pie y el rail más allá de su safe area (0 dentro de la columna);
    // también vuelve en cada render: una recarga borra las variables css de la página pero no el
    // plugin, que no volvería a avisar sin un relayout.
    private var coveredHeight: CGFloat = 0
    private var railWidth: CGFloat = 0
    private var lastLayout: TabLayout?
    private var loadingObservation: NSKeyValueObservation?
    private var backObservation: NSKeyValueObservation?

    override public func load() {
        // el bridge instancia los plugins en su init, en el hilo principal y con el webview creado.
        bridge?.webView?.allowsBackForwardNavigationGestures = true
        // el botón de atrás de la columna se apaga sin historial: lo cuenta el back-forward list,
        // que la web no puede leer (history.length no baja al volver).
        backObservation = bridge?.webView?.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.applyState() }
        }
        // una carga completa de la página (recarga, logout o sesión caducada → /login) arranca
        // sin shell y sin el teardown de la acción web: la barra se oculta hasta otro render.
        loadingObservation = bridge?.webView?.observe(\.isLoading, options: [.new]) { [weak self] webView, _ in
            guard webView.isLoading else { return }
            DispatchQueue.main.async {
                guard let self else { return }
                self.wanted = false
                self.applyState()
            }
        }
    }

    @objc func render(_ call: CAPPluginCall) {
        let tabs = (call.getArray("items", JSObject.self) ?? []).compactMap(NativeTab.init)
        let backTitle = call.getString("backTitle")
        let actions = (call.getArray("actions", JSObject.self) ?? []).compactMap(NativeTab.init)
        let selected = call.getString("selected")
        let visible = call.getBool("visible") ?? false
        let showTitles = call.getBool("showTitles") ?? true
        let dark = call.getBool("dark") ?? true
        let tint = call.getString("tint").flatMap(NativeTabBarPlugin.color(hex:))
        DispatchQueue.main.async {
            guard let bar = self.ensureTabBar() else {
                call.reject("[NativeTabBar] sin vista del bridge donde montar la barra")
                return
            }
            if tabs != self.tabs || showTitles != self.showTitles {
                self.tabs = tabs
                self.showTitles = showTitles
                bar.items = tabs.enumerated().map { index, tab in tab.item(tag: index, showTitle: showTitles) }
                self.rail?.tabs.setTabs(tabs)
            }
            if backTitle != self.backTitle || actions != self.actions {
                self.backTitle = backTitle
                self.actions = actions
                self.rail?.setActions(self.actionItems)
            }
            self.selected = selected
            self.dark = dark
            self.tint = tint
            self.wanted = visible
            self.applyState()
            call.resolve(self.layoutData())
        }
    }

    // también llega al re-tocar la pestaña activa: la web lo usa para volver arriba.
    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        selectTab(at: item.tag)
    }

    private func selectTab(at index: Int) {
        guard tabs.indices.contains(index) else { return }
        notifyListeners("tabSelect", data: ["id": tabs[index].id])
    }

    // botones de la cápsula de acciones, en orden: atrás (si lo hay) y las de la web.
    private var actionItems: [NativeTab] {
        let back = backTitle.map { NativeTab(id: NativeTabBarPlugin.backId, title: $0, symbol: NativeTabBarPlugin.backSymbol) }
        return (back.map { [$0] } ?? []) + actions
    }

    // atrás lo resuelve el nativo (el webview sabe si hay historial); el resto va a la web con la
    // caja del botón en coordenadas del webview (= px css del viewport: la vista del bridge ES el
    // webview), para que saque su menú al lado.
    private func selectAction(at index: Int) {
        let offset = backTitle == nil ? 0 : 1
        guard index >= offset else {
            bridge?.webView?.goBack()
            return
        }
        guard actions.indices.contains(index - offset),
              let host = bridge?.viewController?.view,
              let anchor = rail?.actions.anchor(of: index, in: host) else { return }
        notifyListeners("actionSelect", data: [
            "id": actions[index - offset].id,
            "anchor": [
                "x": Double(anchor.minX),
                "y": Double(anchor.minY),
                "width": Double(anchor.width),
                "height": Double(anchor.height)
            ]
        ])
    }

    // selección, tema y visibilidad sobre la vista del modo en curso; la otra queda oculta.
    private func applyState() {
        guard let bar = tabBar else { return }
        let index = tabs.firstIndex { $0.id == selected }
        bar.selectedItem = index.flatMap { bar.items?[$0] }
        bar.overrideUserInterfaceStyle = dark ? .dark : .light
        bar.tintColor = tint
        let show = wanted && !tabs.isEmpty
        setVisible(show && railEdge == nil, view: bar)
        guard let rail else { return }
        // atrás es el primero de la cápsula: apagado (atenuado y sin toques) sin historial.
        let backDisabled = backTitle != nil && bridge?.webView?.canGoBack != true
        rail.tabs.apply(selected: index, dark: dark, tint: tint)
        rail.actions.apply(selected: nil, dark: dark, tint: tint, disabled: backDisabled ? [0] : [])
        setVisible(show && railEdge != nil, view: rail)
    }

    // la barra se crea en el primer render (hilo principal, webview ya en pantalla), oculta hasta
    // que la web pida mostrarla: así nunca parpadea una barra sin pestañas al arrancar.
    private func ensureTabBar() -> NativeTabBarView? {
        if let tabBar { return tabBar }
        // en CAPBridgeViewController la vista ES el webview: la barra cuelga encima de él.
        guard let host = bridge?.viewController?.view else { return nil }
        let bar = NativeTabBarView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = self
        bar.alpha = 0
        bar.isUserInteractionEnabled = false
        bar.accessibilityElementsHidden = true
        // la barra va pegada a los bordes de la vista: su layout llega en cada giro, apertura o plegado.
        bar.onLayout = { [weak self] height in
            self?.placeRail()
            self?.reportLayout(height)
        }
        host.addSubview(bar)
        // pegada al borde (no a la safe area): el UITabBar suma solo el inset inferior y, con
        // sdk 26, coloca su cápsula flotante dentro. sin appearance propia a propósito: un
        // standardAppearance/backgroundColor sustituiría el cristal del sistema por uno pintado.
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: host.bottomAnchor)
        ])
        if #available(iOS 26.0, *), let scrollView = bridge?.webView?.scrollView {
            let edgeEffect = UIScrollEdgeElementContainerInteraction()
            edgeEffect.scrollView = scrollView
            edgeEffect.edge = .bottom
            bar.addInteraction(edgeEffect)
        }
        tabBar = bar
        // el borde de la barra vertical cambia al girar, abrir o plegar el Duo: rail ↔ barra.
        if #available(iOS 27.1, *) {
            _ = host.registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) { [weak self] (_: UIView, _: UITraitCollection) in
                self?.updateRailEdge()
            }
        }
        updateRailEdge()
        // layout ya: el primer render resuelve con el alto real, no con 0.
        host.layoutIfNeeded()
        return bar
    }

    // el rail nace con la primera barra vertical (solo el Duo la tiene). el inset lateral de la safe
    // area ES la columna del sistema: el rail se centra en ella, al pie (placeRail), con la cápsula
    // de acciones encima.
    private func ensureRail(in host: UIView) -> NativeRailColumnView {
        if let rail { return rail }
        let rail = NativeRailColumnView()
        rail.translatesAutoresizingMaskIntoConstraints = false
        rail.alpha = 0
        rail.isUserInteractionEnabled = false
        rail.accessibilityElementsHidden = true
        rail.tabs.onSelect = { [weak self] index in self?.selectTab(at: index) }
        rail.actions.onSelect = { [weak self] index in self?.selectAction(at: index) }
        rail.onSafeAreaChange = { [weak self] in self?.placeRail() }
        rail.tabs.setTabs(tabs)
        rail.setActions(actionItems)
        host.addSubview(rail)
        railSideConstraints = [
            .left: rail.centerXAnchor.constraint(equalTo: host.leftAnchor),
            .right: rail.centerXAnchor.constraint(equalTo: host.rightAnchor)
        ]
        // sin scroll edge effect: el rail vive en la columna del sistema, nada scrollea por debajo.
        rail.bottomAnchor.constraint(equalTo: host.safeAreaLayoutGuide.bottomAnchor, constant: -NativeTabBarPlugin.railMargin).isActive = true
        self.rail = rail
        return rail
    }

    // dentro de la columna si cabe con su margen (en el eje de la cámara y la hora de encima); si
    // no, pegado a ella por dentro, y lo que pasa de la safe area queda en railWidth para la web.
    private func placeRail() {
        guard let rail, let railEdge, let host = rail.superview else { return }
        let inset = railEdge == .left ? host.safeAreaInsets.left : host.safeAreaInsets.right
        let margin = NativeTabBarPlugin.railMargin
        let width = NativeTabRailView.width
        let fits = inset >= width + 2 * margin
        let offset = fits
            ? NativeTabBarPlugin.columnAxis(in: host, edge: railEdge, inset: inset, half: width / 2 + margin)
            : inset + margin + width / 2
        railSideConstraints[railEdge]?.constant = railEdge == .left ? offset : -offset
        railWidth = fits ? 0 : width + 2 * margin
        reportLayout()
    }

    // re-lee el borde de la barra vertical; al cambiar, mueve el rail a su lado (o lo retira) y
    // avisa a la web, que pasa de reservar el pie a reservar ese lado.
    private func updateRailEdge() {
        guard let host = bridge?.viewController?.view else { return }
        let edge = NativeTabBarPlugin.verticalBarEdge(of: host)
        guard edge != railEdge else { return }
        railEdge = edge
        if let edge {
            _ = ensureRail(in: host)
            // primero fuera el lado viejo: dos centros a la vez son incompatibles.
            NSLayoutConstraint.deactivate(Array(railSideConstraints.values))
            railSideConstraints[edge]?.isActive = true
            placeRail()
            host.layoutIfNeeded()
        }
        applyState()
        reportLayout()
    }

    // distancia del borde al eje de la columna: el de la cámara de la pantalla exterior del Duo (su
    // región ocluida, siempre presente), que es donde el sistema centra la hora y la batería, y no
    // el centro del inset (~5pt más hacia dentro en el simulador: inset ~83pt, eje a ~47pt). sin
    // cámara en la columna (la interior la esconde) vale el centro del inset. acotado a [half,
    // inset - half] para que el rail, con su margen, nunca salga de la columna.
    private static func columnAxis(in host: UIView, edge: RailEdge, inset: CGFloat, half: CGFloat) -> CGFloat {
        let center = inset / 2
        guard #available(iOS 27.1, *) else { return center }
        let bounds = host.bounds
        let axis = host.reservedRegions(kind: .occlusion)
            .map { edge == .left ? $0.frame.midX - bounds.minX : bounds.maxX - $0.frame.midX }
            .first { $0 > 0 && $0 < inset }
        return min(max(axis ?? center, half), inset - half)
    }

    // borde FÍSICO de la barra vertical del sistema (la web reserva izquierda o derecha); nil sin
    // ella: otro iphone, el iPad o el Duo abierto en vertical. el trait es lógico (leading/trailing).
    private static func verticalBarEdge(of host: UIView) -> RailEdge? {
        guard #available(iOS 27.1, *) else { return nil }
        let rtl = host.effectiveUserInterfaceLayoutDirection == .rightToLeft
        switch host.traitCollection.verticalBarEdge {
        case .leading: return rtl ? .right : .left
        case .trailing: return rtl ? .left : .right
        default: return nil
        }
    }

    // oculta = transparente y sin toques ni voiceover: los toques pasan al webview de debajo.
    private func setVisible(_ visible: Bool, view: UIView) {
        guard visible != view.isUserInteractionEnabled else { return }
        view.isUserInteractionEnabled = visible
        view.accessibilityElementsHidden = !visible
        UIView.animate(withDuration: NativeTabBarPlugin.fadeDuration) { view.alpha = visible ? 1 : 0 }
    }

    private func layoutData() -> [String: Any] {
        TabLayout(railEdge: railEdge, coveredHeight: coveredHeight, railWidth: railWidth).data
    }

    private func reportLayout() {
        let layout = TabLayout(railEdge: railEdge, coveredHeight: coveredHeight, railWidth: railWidth)
        guard layout != lastLayout else { return }
        lastLayout = layout
        notifyListeners("layout", data: layout.data)
    }

    private func reportLayout(_ height: CGFloat) {
        coveredHeight = height
        reportLayout()
    }

    // '#rrggbb' (lo que resuelve resolveCssColor en la web) → UIColor; nil si no lo es.
    private static func color(hex: String) -> UIColor? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let rgb = UInt32(digits, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// pestaña tal como la manda la web: id = ruta de la spa, símbolo = nombre de sf symbol.
struct NativeTab: Equatable {
    // respaldo si el símbolo no existe en la versión de ios del dispositivo.
    private static let fallbackSymbol = "circle"
    // variante rellena de un sf symbol: la pestaña seleccionada la usa si existe.
    private static let selectedSuffix = ".fill"

    let id: String
    let title: String
    let symbol: String

    // el de atrás lo arma el nativo: la web solo manda su título.
    init(id: String, title: String, symbol: String) {
        self.id = id
        self.title = title
        self.symbol = symbol
    }

    init?(_ object: JSObject) {
        guard let id = object["id"] as? String,
              let title = object["title"] as? String,
              let symbol = object["symbol"] as? String else { return nil }
        self.init(id: id, title: title, symbol: symbol)
    }

    // la seleccionada, rellena si el símbolo tiene esa variante; lo comparten barra y rail.
    func image(selected: Bool) -> UIImage? {
        let image = UIImage(systemName: symbol) ?? UIImage(systemName: NativeTab.fallbackSymbol)
        guard selected else { return image }
        return UIImage(systemName: symbol + NativeTab.selectedSuffix) ?? image
    }

    // sin título (más pestañas de las que caben en la cápsula) el nombre sigue para voiceover.
    func item(tag: Int, showTitle: Bool) -> UITabBarItem {
        let item = UITabBarItem(title: showTitle ? title : nil, image: image(selected: false), selectedImage: image(selected: true))
        item.tag = tag
        item.accessibilityLabel = title
        return item
    }
}

/// UITabBar que avisa de su alto efectivo tras cada layout (rotación, safe areas, tamaño del
/// texto): lo que tapa desde su borde superior hasta el pie de la vista que lo aloja. se mide con
/// center/bounds y no con frame, que cambiaría con un transform.
final class NativeTabBarView: UITabBar {
    var onLayout: ((CGFloat) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let host = superview else { return }
        onLayout?(host.bounds.height - (center.y - bounds.height / 2))
    }
}

/// borde físico de la pantalla donde va el rail; el valor viaja tal cual a la web.
enum RailEdge: String {
    case left
    case right
}

/// contrato con la web (NativeTabBarLayout en @platform/mobile/native-tab-bar): en modo barra, el alto que
/// tapa desde el pie; en modo rail, su borde y el ancho que tapa más allá de la safe area de ese
/// borde (0 si cabe en la columna del sistema; el pie ya no lo tapa nada). sin `edge` = modo barra.
struct TabLayout: Equatable {
    let height: CGFloat
    let width: CGFloat
    let edge: RailEdge?

    init(railEdge: RailEdge?, coveredHeight: CGFloat, railWidth: CGFloat) {
        height = railEdge == nil ? coveredHeight : 0
        width = railEdge == nil ? 0 : railWidth
        edge = railEdge
    }

    var data: [String: Any] {
        var data: [String: Any] = ["height": Double(height), "width": Double(width)]
        data["edge"] = edge?.rawValue
        return data
    }
}

/// columna del Duo: la cápsula de acciones (atrás, buscar…) encima de la de pestañas, las dos al pie
/// y del mismo ancho. sin acciones la suya se oculta y el stack la pliega: solo queda el rail.
final class NativeRailColumnView: UIView {
    // hueco entre las dos cápsulas: separa navegar (atrás, buscar) de las pestañas.
    private static let capsuleSpacing: CGFloat = 8

    let actions = NativeTabRailView()
    let tabs = NativeTabRailView()
    // la safe area cambia al girar, abrir o plegar: el plugin recoloca la columna.
    var onSafeAreaChange: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        let stack = UIStackView(arrangedSubviews: [actions, tabs])
        stack.axis = .vertical
        stack.spacing = NativeRailColumnView.capsuleSpacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        actions.isHidden = true
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("NativeRailColumnView no se crea desde un storyboard")
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        onSafeAreaChange?()
    }

    func setActions(_ items: [NativeTab]) {
        actions.setTabs(items)
        actions.isHidden = items.isEmpty
    }
}

/// rail vertical de pestañas (iPhone Duo): una cápsula de cristal con un símbolo por pestaña,
/// la activa con su variante rellena sobre una cápsula del tinte. el cristal es el del sistema
/// (UIGlassEffect, ios 26) como la cápsula del UITabBar; el rail solo existe con barra vertical
/// (ios 27.1), así que el desenfoque de respaldo no llega a verse en un Duo. la cápsula de acciones
/// es otra instancia, sin selección y con botones que se pueden apagar (atrás sin historial).
final class NativeTabRailView: UIView {
    // botón cuadrado: el área táctil mínima de la hig.
    private static let itemSize: CGFloat = 44
    private static let padding: CGFloat = 6
    private static let spacing: CGFloat = 2
    // opacidad del tinte en la cápsula de la pestaña activa.
    private static let selectedFillAlpha: CGFloat = 0.18
    // ancho fijo (un botón + el relleno de la cápsula): el plugin decide con él si cabe en la columna.
    static let width = itemSize + 2 * padding

    var onSelect: ((Int) -> Void)?
    private let stack = UIStackView()
    private var tabs: [NativeTab] = []
    private var selected: Int?
    private var tint: UIColor?
    // índices apagados: uikit los atenúa y no reciben toques.
    private var disabled: Set<Int> = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        let background = UIVisualEffectView(effect: NativeTabRailView.material())
        background.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) {
            background.cornerConfiguration = .capsule(maximumRadius: nil)
        } else {
            background.layer.cornerRadius = NativeTabRailView.width / 2
            background.clipsToBounds = true
        }
        stack.axis = .vertical
        stack.spacing = NativeTabRailView.spacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(background)
        background.contentView.addSubview(stack)
        let inset = NativeTabRailView.padding
        NSLayoutConstraint.activate([
            background.topAnchor.constraint(equalTo: topAnchor),
            background.bottomAnchor.constraint(equalTo: bottomAnchor),
            background.leadingAnchor.constraint(equalTo: leadingAnchor),
            background.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: background.contentView.topAnchor, constant: inset),
            stack.bottomAnchor.constraint(equalTo: background.contentView.bottomAnchor, constant: -inset),
            stack.leadingAnchor.constraint(equalTo: background.contentView.leadingAnchor, constant: inset),
            stack.trailingAnchor.constraint(equalTo: background.contentView.trailingAnchor, constant: -inset)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("NativeTabRailView no se crea desde un storyboard")
    }

    // un botón por pestaña, solo si cambian (el render llega en cada cambio de la web).
    func setTabs(_ next: [NativeTab]) {
        guard next != tabs else { return }
        tabs = next
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        next.enumerated().forEach { index, tab in stack.addArrangedSubview(button(for: tab, at: index)) }
        restyle()
    }

    func apply(selected: Int?, dark: Bool, tint: UIColor?, disabled: Set<Int> = []) {
        overrideUserInterfaceStyle = dark ? .dark : .light
        guard selected != self.selected || tint != self.tint || disabled != self.disabled else { return }
        self.selected = selected
        self.tint = tint
        self.disabled = disabled
        restyle()
    }

    // caja del botón `index` en `view`: su alto y el ancho de la cápsula entera, para que lo que la
    // web saque a su lado (un menú) no pise el cristal.
    func anchor(of index: Int, in view: UIView) -> CGRect? {
        guard stack.arrangedSubviews.indices.contains(index) else { return nil }
        let button = stack.arrangedSubviews[index]
        let item = button.convert(button.bounds, to: view)
        let capsule = convert(bounds, to: view)
        return CGRect(x: capsule.minX, y: item.minY, width: capsule.width, height: item.height)
    }

    private func button(for tab: NativeTab, at index: Int) -> UIButton {
        let button = UIButton(configuration: .plain(), primaryAction: UIAction { [weak self] _ in self?.onSelect?(index) })
        button.translatesAutoresizingMaskIntoConstraints = false
        button.accessibilityLabel = tab.title
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: NativeTabRailView.itemSize),
            button.heightAnchor.constraint(equalToConstant: NativeTabRailView.itemSize)
        ])
        return button
    }

    // la activa: símbolo relleno en el tinte sobre su cápsula; el resto, el gris secundario del sistema.
    private func restyle() {
        let accent = tint ?? tintColor ?? .systemBlue
        zip(tabs, stack.arrangedSubviews.compactMap { $0 as? UIButton }).enumerated().forEach { index, pair in
            let (tab, button) = pair
            let active = index == selected
            var config = UIButton.Configuration.plain()
            config.image = tab.image(selected: active)
            config.baseForegroundColor = active ? accent : .secondaryLabel
            config.background.backgroundColor = active ? accent.withAlphaComponent(NativeTabRailView.selectedFillAlpha) : .clear
            config.cornerStyle = .capsule
            button.configuration = config
            let enabled = !disabled.contains(index)
            button.isEnabled = enabled
            // los traits a mano pisan los que uikit calcula: el apagado también se declara aquí.
            var traits: UIAccessibilityTraits = active ? [.button, .selected] : .button
            if !enabled { traits.insert(.notEnabled) }
            button.accessibilityTraits = traits
        }
    }

    private static func material() -> UIVisualEffect {
        if #available(iOS 26.0, *) { return UIGlassEffect(style: .regular) }
        return UIBlurEffect(style: .systemChromeMaterial)
    }
}
