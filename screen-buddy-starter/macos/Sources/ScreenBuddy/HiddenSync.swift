import Foundation
import ScreenBuddyCore

/// Keeps the website admin's hidden list on this Mac (UserDefaults), so hidden buddies stay hidden offline too.
/// Checked at launch and every 6 hours; `onChange` runs on the main thread when the list changed.
final class HiddenSync {
    private static let key = "hiddenBuddies"

    /// The list as last saved. The library reads this on every `list()`.
    static var current: Set<String> { Set(UserDefaults.standard.stringArray(forKey: key) ?? []) }

    var onChange: (() -> Void)?
    private var timer: Timer?

    func start() {
        check()
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in self?.check() }
    }

    func check() {
        var request = URLRequest(url: HiddenBuddies.listURL)
        request.timeoutInterval = 30
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let data, (response as? HTTPURLResponse)?.statusCode == 200,
                  let ids = HiddenBuddies.parse(data) else { return }      // offline: keep the saved list
            DispatchQueue.main.async { [weak self] in
                guard ids != HiddenSync.current else { return }
                UserDefaults.standard.set(ids.sorted(), forKey: HiddenSync.key)
                self?.onChange?()
            }
        }.resume()
    }
}
