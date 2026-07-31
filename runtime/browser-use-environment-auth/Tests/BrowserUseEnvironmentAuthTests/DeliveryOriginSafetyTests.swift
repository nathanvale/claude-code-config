@_spi(Executor) import BrowserUseEnvironmentAuth
import Foundation
import Testing

@Suite
struct DeliveryOriginSafetyTests {
    @Test
    func normalizedOriginPreservesIPv6Brackets() {
        #expect(
            EnvironmentDeliveryOriginSafety.normalizedOrigin("http://[::1]:8080")
                == "http://[::1]:8080"
        )
        #expect(
            EnvironmentDeliveryOriginSafety.normalizedOrigin("https://[2001:DB8::1]")
                == "https://[2001:db8::1]"
        )
    }

    @Test
    func normalizedOriginDropsIPv6DefaultPort() {
        #expect(
            EnvironmentDeliveryOriginSafety.normalizedOrigin("https://[::1]:443")
                == "https://[::1]"
        )
    }

    @Test
    func normalizedOriginKeepsDNSHostBehavior() {
        #expect(
            EnvironmentDeliveryOriginSafety.normalizedOrigin("HTTPS://Example.COM:443/")
                == "https://example.com"
        )
        #expect(
            EnvironmentDeliveryOriginSafety.normalizedOrigin("http://example.com:8080")
                == "http://example.com:8080"
        )
        #expect(
            EnvironmentDeliveryOriginSafety.normalizedOrigin("https://example.com/path")
                == nil
        )
    }

    @Test
    func originOfIPv6URLMatchesNormalizedOrigin() {
        #expect(
            EnvironmentDeliveryOriginSafety.origin(of: "http://[::1]:8080/login?next=1")
                == "http://[::1]:8080"
        )
        #expect(
            EnvironmentDeliveryOriginSafety.origin(of: "https://example.com/login")
                == "https://example.com"
        )
    }
}
