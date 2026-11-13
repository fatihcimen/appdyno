import OSLog
import SwiftUI

/// A small shop to try appdyno on: a catalog, a cart and a checkout, with one bug left in on purpose (`discount`).
@main
struct ShopApp: App {
    @State private var cart = Cart()

    var body: some Scene {
        WindowGroup {
            CatalogView().environment(cart)
        }
    }
}

private let log = Logger(subsystem: "dev.appdyno.shop", category: "checkout")

struct Product: Identifiable, Hashable {
    let id: Int
    let name: String
    let cents: Int
}

let catalog = [
    Product(id: 1, name: "Coffee beans", cents: 1_450),
    Product(id: 2, name: "Pour-over kettle", cents: 4_900),
    Product(id: 3, name: "Ceramic dripper", cents: 2_200),
    Product(id: 4, name: "Paper filters", cents: 600),
    Product(id: 5, name: "Burr grinder", cents: 12_900),
    Product(id: 6, name: "Digital scale", cents: 3_400),
    Product(id: 7, name: "Travel mug", cents: 2_800),
    Product(id: 8, name: "Milk frother", cents: 3_900)
]

@MainActor @Observable
final class Cart {
    private(set) var quantities: [Product: Int] = [:]

    var count: Int { quantities.values.reduce(0, +) }

    var lines: [Line] {
        quantities.map { Line(product: $0.key, quantity: $0.value) }.sorted { $0.product.id < $1.product.id }
    }

    func add(_ product: Product) { quantities[product, default: 0] += 1 }

    func empty() { quantities = [:] }
}

struct Line: Hashable {
    let product: Product
    let quantity: Int
}

/// The percent taken off a line by its quantity: none for one, 5 for two.
let discounts = [0, 0, 5]

/// The bug: a line of three or more reads past the end of `discounts`, and the app stops at "Place order".
func discount(forQuantity quantity: Int) -> Int {
    discounts[quantity]
}

func total(of lines: [Line]) -> Int {
    lines.reduce(0) { sum, line in
        log.notice("checkout: \(line.product.name, privacy: .public) x\(line.quantity)")
        let cents = line.product.cents * line.quantity
        return sum + cents - cents * discount(forQuantity: line.quantity) / 100
    }
}

/// In dollars as the US writes them, whatever the device's language: a flow checks the total by its text.
func price(_ cents: Int) -> String {
    (Decimal(cents) / 100).formatted(.currency(code: "USD").locale(Locale(identifier: "en_US")))
}

struct CatalogView: View {
    @Environment(Cart.self) private var cart

    var body: some View {
        NavigationStack {
            List(catalog) { product in
                NavigationLink(value: product) {
                    LabeledContent(product.name, value: price(product.cents))
                }
            }
            .navigationTitle("Shop")
            .navigationDestination(for: Product.self) { ProductView(product: $0) }
            .toolbar {
                NavigationLink("Cart (\(cart.count))") { CartView() }
            }
        }
    }
}

struct ProductView: View {
    @Environment(Cart.self) private var cart
    let product: Product

    var body: some View {
        VStack(spacing: 16) {
            Text(price(product.cents)).font(.title2)
            Button("Add to cart") { cart.add(product) }
                .buttonStyle(.borderedProminent)
            Text("In your cart: \(cart.quantities[product] ?? 0)")
                .foregroundStyle(.secondary)
        }
        .navigationTitle(product.name)
        .toolbar {
            NavigationLink("Cart (\(cart.count))") { CartView() }
        }
    }
}

struct CartView: View {
    @Environment(Cart.self) private var cart

    var body: some View {
        List {
            ForEach(cart.lines, id: \.self) { line in
                LabeledContent(line.product.name, value: "× \(line.quantity)")
            }
            Section {
                NavigationLink("Checkout") { CheckoutView() }
                    .disabled(cart.quantities.isEmpty)
            }
        }
        .navigationTitle("Cart")
    }
}

struct CheckoutView: View {
    @Environment(Cart.self) private var cart
    @State private var placed: Int?

    var body: some View {
        Form {
            Section("Deliver to") {
                Text("Ada Lovelace")
                Text("12 Analytical Street, London")
            }
            if let placed {
                Text("Order placed: \(price(placed))")
            } else {
                Button("Place order") {
                    placed = total(of: cart.lines)
                    cart.empty()
                }
            }
        }
        .navigationTitle("Checkout")
    }
}
