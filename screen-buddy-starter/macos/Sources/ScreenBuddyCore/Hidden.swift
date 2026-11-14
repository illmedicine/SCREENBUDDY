import Foundation

/// The website admin's hidden buddies (Firestore `buddies/{id}.hidden`, public to read). A hidden buddy is left out
/// of the library everywhere, built-in ones included. Same rule as the website, Windows and Android.
public enum HiddenBuddies {
    public static let project = "screen-buddy-f968b"
    public static let apiKey = "AIzaSyBQi0TVrDIWQ4hclgFox9SMzRsGQSwC8CU"   // the website's public web key

    /// The Firestore REST list of the admin's per-buddy settings.
    public static var listURL: URL {
        URL(string: "https://firestore.googleapis.com/v1/projects/\(project)/databases/(default)/documents/buddies?pageSize=300&key=\(apiKey)")!
    }

    /// Ids with `hidden == true` in a Firestore REST list response. Anything malformed is skipped; junk gives nil.
    public static func parse(_ data: Data) -> Set<String>? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let docs = root["documents"] as? [[String: Any]] else { return root["error"] == nil ? [] : nil }
        var out = Set<String>()
        for d in docs {
            guard let name = d["name"] as? String,
                  let fields = d["fields"] as? [String: Any],
                  let hidden = fields["hidden"] as? [String: Any],
                  hidden["booleanValue"] as? Bool == true,
                  let id = name.split(separator: "/").last
            else { continue }
            out.insert(String(id))
        }
        return out
    }
}
