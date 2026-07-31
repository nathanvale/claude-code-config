import Foundation

/// Origin-canonicalization predicate shared by both secret-bearing
/// executables (supervisor and field-delivery child) so the two processes
/// can never disagree on which origin a delivery target proves.
@_spi(Executor) public enum EnvironmentDeliveryOriginSafety {
    public static func normalizedOrigin(_ raw: String) -> String? {
        guard raw.utf8.count <= 2_048,
              var components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host?.lowercased(),
              components.user == nil,
              components.password == nil,
              components.path.isEmpty || components.path == "/",
              components.query == nil,
              components.fragment == nil
        else {
            return nil
        }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = components.port == defaultPort ? nil : components.port
        components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = port
        return components.string
    }

    public static func origin(of raw: String) -> String? {
        guard let url = URL(string: raw),
              let scheme = url.scheme,
              let host = url.host
        else {
            return nil
        }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        return normalizedOrigin(components.string ?? "")
    }
}
