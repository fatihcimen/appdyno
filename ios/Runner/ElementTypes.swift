import UIKit
import XCTest

extension Device {
    private static let clickableTypes: Set<XCUIElement.ElementType> = [
        .button, .cell, .link, .tab, .menuItem, .segmentedControl, .switch, .toggle, .slider, .stepper, .picker,
        .pickerWheel, .key, .icon, .incrementArrow, .decrementArrow, .radioButton, .checkBox, .popUpButton,
        .menuButton, .disclosureTriangle, .pageIndicator
    ]
    private static let editableTypes: Set<XCUIElement.ElementType> = [
        .textField, .secureTextField, .searchField, .textView
    ]
    private static let scrollableTypes: Set<XCUIElement.ElementType> = [.scrollView, .table, .collectionView, .webView]
    private static let checkableTypes: Set<XCUIElement.ElementType> = [.switch, .toggle, .checkBox]

    private static let keyboardFocusKey = NSSelectorFromString("hasKeyboardFocus")

    /**
     * The text field the keyboard types into: XCUI's snapshot knows it (the attribute its focus queries
     * use) though `hasFocus` is the focus engine's and stays false for a typed-into field. Where the
     * snapshot has no such attribute, nothing is assumed.
     */
    static func hasKeyboardFocus(_ snap: XCUIElementSnapshot) -> Bool {
        guard let object = snap as? NSObject, object.responds(to: keyboardFocusKey) else { return false }
        return (object.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
    }

    /// `frame`: where it is in the screen's space, its own frame but for the home screen app's (`turnedFrame`).
    static func node(_ snap: XCUIElementSnapshot, frame: CGRect, parent: Int, window: Int, screen: CGRect) -> Node {
        let b = box(frame)
        let t = snap.elementType
        var f = 0
        if frame.width > 0, frame.height > 0, frame.intersects(screen) { f |= Flag.visible }
        if clickableTypes.contains(t) { f |= Flag.clickable }
        if editableTypes.contains(t) { f |= Flag.editable | Flag.focusable }
        if snap.hasFocus || (editableTypes.contains(t) && hasKeyboardFocus(snap)) { f |= Flag.focused }
        if snap.isEnabled { f |= Flag.enabled }
        if snap.isSelected { f |= Flag.selected }
        if scrollableTypes.contains(t) { f |= Flag.scrollable }
        if t == .secureTextField { f |= Flag.password }
        if checkableTypes.contains(t) {
            f |= Flag.checkable
            if (snap.value as? String) == "1" || (snap.value as? NSNumber)?.intValue == 1 { f |= Flag.checked }
        }
        let value = (snap.value as? String) ?? (snap.value as? NSNumber)?.stringValue
        func nonEmpty(_ x: String?) -> String? { x.flatMap { $0.isEmpty ? nil : $0 } }
        let placeholder = nonEmpty(snap.placeholderValue)
        // the app itself is the screen, not an element of it: its name is no text on the screen
        let label = t == .application ? nil : nonEmpty(snap.label)
        return Node(parent: parent, window: window, type: typeName(t), id: nonEmpty(snap.identifier),
                    text: value == placeholder ? nil : nonEmpty(value), label: label, hint: placeholder,
                    left: b[0], top: b[1], right: b[2], bottom: b[3], flags: f)
    }

    private static let names: [XCUIElement.ElementType: String] = [
        .any: "Any", .other: "Other", .application: "Application", .group: "Group", .window: "Window",
        .sheet: "Sheet", .drawer: "Drawer", .alert: "Alert", .dialog: "Dialog", .button: "Button",
        .radioButton: "RadioButton", .radioGroup: "RadioGroup", .checkBox: "CheckBox",
        .disclosureTriangle: "DisclosureTriangle", .popUpButton: "PopUpButton", .comboBox: "ComboBox",
        .menuButton: "MenuButton", .toolbarButton: "ToolbarButton", .popover: "Popover", .keyboard: "Keyboard",
        .key: "Key", .navigationBar: "NavigationBar", .tabBar: "TabBar", .tabGroup: "TabGroup", .toolbar: "Toolbar",
        .statusBar: "StatusBar", .table: "Table", .tableRow: "TableRow", .tableColumn: "TableColumn",
        .outline: "Outline", .outlineRow: "OutlineRow", .browser: "Browser", .collectionView: "CollectionView",
        .slider: "Slider", .pageIndicator: "PageIndicator", .progressIndicator: "ProgressIndicator",
        .activityIndicator: "ActivityIndicator", .segmentedControl: "SegmentedControl", .picker: "Picker",
        .pickerWheel: "PickerWheel", .switch: "Switch", .toggle: "Toggle", .link: "Link", .image: "Image",
        .icon: "Icon", .searchField: "SearchField", .scrollView: "ScrollView", .scrollBar: "ScrollBar",
        .staticText: "StaticText", .textField: "TextField", .secureTextField: "SecureTextField",
        .datePicker: "DatePicker", .textView: "TextView", .menu: "Menu", .menuItem: "MenuItem", .menuBar: "MenuBar",
        .menuBarItem: "MenuBarItem", .map: "Map", .webView: "WebView", .incrementArrow: "IncrementArrow",
        .decrementArrow: "DecrementArrow", .timeline: "Timeline", .ratingIndicator: "RatingIndicator",
        .valueIndicator: "ValueIndicator", .splitGroup: "SplitGroup", .splitter: "Splitter",
        .relevanceIndicator: "RelevanceIndicator", .colorWell: "ColorWell", .helpTag: "HelpTag", .matte: "Matte",
        .dockItem: "DockItem", .ruler: "Ruler", .rulerMarker: "RulerMarker", .grid: "Grid",
        .levelIndicator: "LevelIndicator", .cell: "Cell", .layoutArea: "LayoutArea", .layoutItem: "LayoutItem",
        .handle: "Handle", .stepper: "Stepper", .tab: "Tab", .touchBar: "TouchBar"
    ]

    static func typeName(_ t: XCUIElement.ElementType) -> String { names[t] ?? "Type\(t.rawValue)" }
}
