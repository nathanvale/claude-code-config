import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const brokerSource = readFileSync(
	new URL("../targets/ApprovalBroker/ApprovalBroker.swift", import.meta.url),
	"utf8",
);
const protocolSource = readFileSync(
	new URL(
		"../targets/ApprovalBroker/ApprovalBrokerProtocol.swift",
		import.meta.url,
	),
	"utf8",
);
const brokerEntitlements = readFileSync(
	new URL("../entitlements/ApprovalBroker.entitlements", import.meta.url),
	"utf8",
);

describe("Approval Broker signing-key custody source policy", () => {
	test("keeps the opaque handle in the private device-only Keychain group", () => {
		expect(brokerSource).not.toContain("UserDefaults");
		expect(brokerSource).toContain("SecItemAdd");
		expect(brokerSource).toContain(
			"kSecUseDataProtectionKeychain as String: true",
		);
		expect(brokerSource).toContain(
			"SecTaskCopyValueForEntitlement",
		);
		expect(brokerSource).toContain("kSecAttrAccessGroup as String: accessGroup");
		expect(brokerEntitlements).toContain(
			"$(AppIdentifierPrefix)com.side-quest.browser-use-security.approval-broker",
		);
		expect(brokerSource).toContain(
			"kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly",
		);
		expect(brokerSource).not.toContain("SecItemUpdate");
		expect(brokerSource).not.toContain("SecItemDelete");
	});

	test("loads fail closed and creation stays behind explicit enrollment", () => {
		const loadBody = brokerSource.match(
			/static func loadSigningKey\(\)[\s\S]*?(?=\n {4}\/\/\/ Explicitly enroll)/,
		)?.[0];
		const enrollBody = brokerSource.match(
			/static func enrollSigningKey\(\)[\s\S]*?(?=\n {4}private static func encodeCustodyRecord)/,
		)?.[0];

		expect(loadBody).toBeDefined();
		expect(loadBody).toContain("throw BrokerError.signingKeyMissing");
		expect(loadBody).toContain("throw BrokerError.signingKeyCustodyMismatch");
		expect(loadBody).toContain("verifier.key_id == decoded.verifierKeyID");
		expect(loadBody).not.toContain("createDeviceBoundSigningKey");
		expect(enrollBody).toBeDefined();
		expect(enrollBody).toContain("createDeviceBoundSigningKey");
		expect(enrollBody).toContain("SecItemAdd");
		expect(brokerSource).toContain('case "enroll":');
	});

	test("derives receipt presence evidence from the admitted key", () => {
		expect(protocolSource).toContain("presenceBacked: Bool");
		expect(protocolSource).toContain("presence_backed: presenceBacked");
		expect(protocolSource).not.toContain("presence_backed: true");
		expect(brokerSource).toContain("admittedKey.presencePolicy ==");
	});
});
