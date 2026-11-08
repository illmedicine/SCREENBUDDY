import Foundation

enum Motion: String { case touch, steady }

/// What the user picked, kept in UserDefaults.
struct Settings {
    private let d = UserDefaults.standard

    var buddyId: String? {
        get { d.string(forKey: "buddy") }
        nonmutating set { d.set(newValue, forKey: "buddy") }
    }
    var height: Double {
        get { let v = d.double(forKey: "height"); return v >= 80 && v <= 900 ? v : 240 }
        nonmutating set { d.set(newValue, forKey: "height") }
    }
    var opacity: Double {
        get { let v = d.double(forKey: "opacity"); return v >= 0.2 && v <= 1 ? v : 1 }
        nonmutating set { d.set(newValue, forKey: "opacity") }
    }
    var motion: Motion {
        get { Motion(rawValue: d.string(forKey: "motion") ?? "") ?? .touch }
        nonmutating set { d.set(newValue.rawValue, forKey: "motion") }
    }
    var visible: Bool {
        get { d.object(forKey: "visible") as? Bool ?? true }
        nonmutating set { d.set(newValue, forKey: "visible") }
    }
    var paused: Bool {
        get { d.bool(forKey: "paused") }
        nonmutating set { d.set(newValue, forKey: "paused") }
    }
    /// Window origin (bottom-left, screen points), or nil to use the bottom-right corner.
    var position: (x: Double, y: Double)? {
        get { d.object(forKey: "x") == nil ? nil : (d.double(forKey: "x"), d.double(forKey: "y")) }
        nonmutating set {
            if let p = newValue { d.set(p.x, forKey: "x"); d.set(p.y, forKey: "y") }
            else { d.removeObject(forKey: "x"); d.removeObject(forKey: "y") }
        }
    }
}
