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

    private var tabBar: NativeTabBarView?
    private var rail: NativeTabRailView?
    // centro del rail a cierta distancia de su borde, uno por borde físico: el que toque se activa
    // al cambiar el trait (girar, abrir, plegar) y su distancia sale de la safe area (placeRail).
    private var railSideConstraints: [RailEdge: NSLayoutConstraint] = [:]
    // borde de la barra vertical del sistema; nil = sin ella (pestañas en el UITabBar del pie).
    private var railEdge: RailEdge?
    private var tabs: [NativeTab] = []
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

    override public func load() {
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
                self.rail?.setTabs(tabs)
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
        rail.apply(selected: index, dark: dark, tint: tint)
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
    // area ES la columna del sistema: el rail se centra en ella, al pie (placeRail).
    private func ensureRail(in host: UIView) -> NativeTabRailView {
        if let rail { return rail }
        let rail = NativeTabRailView()
        rail.translatesAutoresizingMaskIntoConstraints = false
        rail.alpha = 0
        rail.isUserInteractionEnabled = false
        rail.accessibilityElementsHidden = true
        rail.onSelect = { [weak self] index in self?.selectTab(at: index) }
        rail.onSafeAreaChange = { [weak self] in self?.placeRail() }
        rail.setTabs(tabs)
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

    // dentro de la columna si cabe con su margen (centrado, como la cámara y la hora encima); si
    // no, pegado a ella por dentro, y lo que pasa de la safe area queda en railWidth para la web.
    private func placeRail() {
        guard let rail, let railEdge, let host = rail.superview else { return }
        let inset = railEdge == .left ? host.safeAreaInsets.left : host.safeAreaInsets.right
        let margin = NativeTabBarPlugin.railMargin
        let width = NativeTabRailView.width
        let fits = inset >= width + 2 * margin
        let offset = fits ? inset / 2 : inset + margin + width / 2
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

    init?(_ object: JSObject) {
        guard let id = object["id"] as? String,
              let title = object["title"] as? String,
              let symbol = object["symbol"] as? String else { return nil }
        self.id = id
        self.title = title
        self.symbol = symbol
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

/// rail vertical de pestañas (iPhone Duo): una cápsula de cristal con un símbolo por pestaña,
/// la activa con su variante rellena sobre una cápsula del tinte. el cristal es el del sistema
/// (UIGlassEffect, ios 26) como la cápsula del UITabBar; el rail solo existe con barra vertical
/// (ios 27.1), así que el desenfoque de respaldo no llega a verse en un Duo.
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
    // la safe area cambia al girar, abrir o plegar: el plugin recoloca el rail en la columna.
    var onSafeAreaChange: (() -> Void)?
    private let stack = UIStackView()
    private var tabs: [NativeTab] = []
    private var selected: Int?
    private var tint: UIColor?

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

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        onSafeAreaChange?()
    }

    // un botón por pestaña, solo si cambian (el render llega en cada cambio de la web).
    func setTabs(_ next: [NativeTab]) {
        guard next != tabs else { return }
        tabs = next
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        next.enumerated().forEach { index, tab in stack.addArrangedSubview(button(for: tab, at: index)) }
        restyle()
    }

    func apply(selected: Int?, dark: Bool, tint: UIColor?) {
        overrideUserInterfaceStyle = dark ? .dark : .light
        guard selected != self.selected || tint != self.tint else { return }
        self.selected = selected
        self.tint = tint
        restyle()
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
            button.accessibilityTraits = active ? [.button, .selected] : .button
        }
    }

    private static func material() -> UIVisualEffect {
        if #available(iOS 26.0, *) { return UIGlassEffect(style: .regular) }
        return UIBlurEffect(style: .systemChromeMaterial)
    }
}
