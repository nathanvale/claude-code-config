import Foundation

/// Origin-canonicalization predicate shared by both secret-bearing
/// executables (supervisor and field-delivery child) so the two processes
/// can never disagree on which origin a delivery target proves.
@_spi(Executor) public enum EnvironmentDeliveryOriginSafety {
    /// `URLComponents.host` and `URL.host` return IPv6 literals
    /// bracket-stripped (Foundation-version dependent). Strip any surviving
    /// brackets so `bracketedAuthorityHost` can re-wrap deterministically.
    private static func unbracketedHost(_ host: String) -> String {
        guard host.hasPrefix("["), host.hasSuffix("]") else { return host }
        return String(host.dropFirst().dropLast())
    }

    /// Rebuild the authority host form: IPv6 literals (the only host kind
    /// containing ":") must be re-bracketed or the rebuilt origin is invalid.
    private static func bracketedAuthorityHost(_ host: String) -> String {
        host.contains(":") ? "[\(host)]" : host
    }

    public static func normalizedOrigin(_ raw: String) -> String? {
        guard raw.utf8.count <= 2_048,
              let components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let rawHost = components.host?.lowercased(),
              components.user == nil,
              components.password == nil,
              components.path.isEmpty || components.path == "/",
              components.query == nil,
              components.fragment == nil
        else {
            return nil
        }
        let host = unbracketedHost(rawHost)
        guard !host.isEmpty else { return nil }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = components.port == defaultPort ? nil : components.port
        if host.contains(":") {
            // Assigning a bracket-stripped IPv6 literal back to
            // `URLComponents.host` yields an invalid authority, so build the
            // bracketed origin deterministically instead.
            let portSuffix = port.map { ":\($0)" } ?? ""
            return "\(scheme)://\(bracketedAuthorityHost(host))\(portSuffix)"
        }
        var rebuilt = URLComponents()
        rebuilt.scheme = scheme
        rebuilt.host = host
        rebuilt.port = port
        return rebuilt.string
    }

    public static func origin(of raw: String) -> String? {
        guard let url = URL(string: raw),
              let scheme = url.scheme,
              let rawHost = url.host
        else {
            return nil
        }
        let host = unbracketedHost(rawHost)
        guard !host.isEmpty else { return nil }
        if host.contains(":") {
            let portSuffix = url.port.map { ":\($0)" } ?? ""
            return normalizedOrigin(
                "\(scheme)://\(bracketedAuthorityHost(host))\(portSuffix)"
            )
        }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        return normalizedOrigin(components.string ?? "")
    }
}
