import SwiftUI
import UIKit

/// A UIKit table and label inside SwiftUI, by a representable: a screen whose views are UIKit's under SwiftUI's host.
struct UIKitScreen: UIViewControllerRepresentable {
    func makeUIViewController(context _: Context) -> TableController { TableController() }
    func updateUIViewController(_: TableController, context _: Context) {}

    final class TableController: UIViewController, UITableViewDataSource {
        private let rows = (1...20).map { "UIKit row \($0)" }

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .systemBackground
            let title = UILabel()
            title.text = "UIKit label"
            title.accessibilityIdentifier = "uikit_label"
            let table = UITableView()
            table.accessibilityIdentifier = "uikit_table"
            table.dataSource = self
            table.register(UITableViewCell.self, forCellReuseIdentifier: "row")
            let stack = UIStackView(arrangedSubviews: [title, table])
            stack.axis = .vertical
            stack.spacing = 8
            stack.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
                stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
                stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                stack.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
        }

        func tableView(_: UITableView, numberOfRowsInSection _: Int) -> Int { rows.count }

        func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
            let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
            var content = cell.defaultContentConfiguration()
            content.text = rows[indexPath.row]
            cell.contentConfiguration = content
            return cell
        }
    }
}
