import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse } from "node:path";

const MAXIMUM_NATIVE_OUTPUT_BYTES = 1_048_576;
const NATIVE_ADMISSION_TIMEOUT_MS = 30_000;
const VERIFIER_CONTRACT = "browser-use.reviewed-action-verifier";
const VERIFIER_SCHEMA_VERSION = "1";

/** Code-owned signing and version identity for the local selection capability. */
export const BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION = {
	approvalBrokerIdentifier:
		"com.nathanvow.browser-use-security.approval-broker",
	environmentSupervisorIdentifier:
		"com.nathanvow.browser-use-environment-auth.supervisor",
	signingTeamIdentifier: "6428AK7884",
	productVersion: "0.1.1",
} as const;

const approvalBrokerRequirement = `anchor apple generic and identifier "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.approvalBrokerIdentifier}" and certificate leaf[subject.OU] = "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.signingTeamIdentifier}"`;
const environmentSupervisorRequirement = `anchor apple generic and identifier "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.environmentSupervisorIdentifier}" and certificate leaf[subject.OU] = "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.signingTeamIdentifier}"`;

/** One bounded native command used by the installed-capability admission owner. */
export type BrowserUseNativeAdmissionCommand = {
	kind:
		| "verify-broker-signature"
		| "verify-broker-entitlements"
		| "verify-supervisor-signature"
		| "verify-product-version"
		| "broker-verifier";
	path: string;
	argv: readonly string[];
};

/** Bounded subprocess result. Native stderr is classified, never projected. */
export type BrowserUseNativeAdmissionCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/** Code-owned input roots for installed binding-selection capability discovery. */
export type BrowserUseBindingSelectionCapabilityInput = {
	home: string;
	configRoot: string;
};

/** Public verifier identity emitted by the admitted broker and pinned locally. */
export type BrowserUseInstalledVerifierIdentity = {
	key_id: string;
	public_key: string;
};

/** Fail-closed installed capability result. No observed path or signing text leaks. */
export type BrowserUseBindingSelectionCapabilityResult =
	| { status: "native-capability-absent" }
	| {
			status: "not-admitted";
			code:
				| "installed-layout-unsafe"
				| "broker-signature-invalid"
				| "broker-entitlements-invalid"
				| "supervisor-signature-invalid"
				| "product-version-incompatible"
				| "verifier-pin-invalid"
				| "verifier-pin-mismatch"
				| "broker-verifier-invalid";
	  }
	| {
			status: "admitted";
			brokerPath: string;
			supervisorPath: string;
			verifier: BrowserUseInstalledVerifierIdentity;
	  };

/** Injectable command runner for hermetic admission proof. */
export type BrowserUseNativeAdmissionDeps = {
	run(
		command: BrowserUseNativeAdmissionCommand,
	): Promise<BrowserUseNativeAdmissionCommandResult>;
};

type AdmittedPathMetadata = {
	dev: number;
	ino: number;
};

async function ancestorsAreAdmitted(path: string): Promise<boolean> {
	const processUid = process.getuid?.();
	let current = dirname(path);
	const root = parse(current).root;
	try {
		while (true) {
			if ((await realpath(current)) !== current) return false;
			const metadata = await lstat(current);
			if (
				!metadata.isDirectory() ||
				metadata.isSymbolicLink() ||
				(metadata.mode & 0o022) !== 0 ||
				(processUid !== undefined &&
					metadata.uid !== processUid &&
					metadata.uid !== 0)
			) {
				return false;
			}
			if (current === root) return true;
			current = dirname(current);
		}
	} catch {
		return false;
	}
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
) {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function verifierIdentityOf(
	value: unknown,
): BrowserUseInstalledVerifierIdentity | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (!exactKeys(record, ["key_id", "public_key"])) return undefined;
	if (
		typeof record.key_id !== "string" ||
		!/^[0-9a-f]{64}$/.test(record.key_id) ||
		typeof record.public_key !== "string"
	) {
		return undefined;
	}
	try {
		const raw = Buffer.from(record.public_key, "base64");
		if (raw.length !== 65 || raw[0] !== 4) return undefined;
		if (createHash("sha256").update(raw).digest("hex") !== record.key_id) {
			return undefined;
		}
	} catch {
		return undefined;
	}
	return { key_id: record.key_id, public_key: record.public_key };
}

function brokerVerifierOf(
	stdout: string,
): BrowserUseInstalledVerifierIdentity | undefined {
	try {
		const parsed = JSON.parse(stdout) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return undefined;
		}
		const record = parsed as Record<string, unknown>;
		if (!exactKeys(record, ["ok", "verifier"]) || record.ok !== true) {
			return undefined;
		}
		return verifierIdentityOf(record.verifier);
	} catch {
		return undefined;
	}
}

function brokerEntitlementsAdmitted(stdout: string): boolean {
	const keys = [...stdout.matchAll(/<key>([^<]+)<\/key>/g)].map(
		(match) => match[1],
	);
	const expectedKeys = [
		"com.apple.application-identifier",
		"com.apple.developer.team-identifier",
		"keychain-access-groups",
	].sort();
	if (
		keys.length !== expectedKeys.length ||
		keys.sort().some((key, index) => key !== expectedKeys[index])
	) {
		return false;
	}
	const applicationIdentifier = `${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.signingTeamIdentifier}.${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.approvalBrokerIdentifier}`;
	return (
		stdout.includes(`<string>${applicationIdentifier}</string>`) &&
		stdout.includes(
			`<string>${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.signingTeamIdentifier}</string>`,
		) &&
		(stdout.match(new RegExp(`<string>${applicationIdentifier}</string>`, "g"))
			?.length ?? 0) === 2
	);
}

function pinnedVerifierOf(
	bytes: string,
): BrowserUseInstalledVerifierIdentity | undefined {
	try {
		const parsed = JSON.parse(bytes) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return undefined;
		}
		const record = parsed as Record<string, unknown>;
		if (
			!exactKeys(record, [
				"contract",
				"schema_version",
				"key_id",
				"public_key",
			]) ||
			record.contract !== VERIFIER_CONTRACT ||
			record.schema_version !== VERIFIER_SCHEMA_VERSION
		) {
			return undefined;
		}
		return verifierIdentityOf({
			key_id: record.key_id,
			public_key: record.public_key,
		});
	} catch {
		return undefined;
	}
}

async function admittedPathMetadata(
	path: string,
	kind: "file" | "directory",
	privateFile = false,
	executable = kind === "file" && !privateFile,
): Promise<AdmittedPathMetadata | undefined> {
	try {
		if (
			!isAbsolute(path) ||
			(await realpath(path)) !== path ||
			!(await ancestorsAreAdmitted(path))
		) {
			return undefined;
		}
		const metadata = await lstat(path);
		const expectedKind =
			kind === "file" ? metadata.isFile() : metadata.isDirectory();
		const processUid = process.getuid?.();
		if (
			!expectedKind ||
			metadata.isSymbolicLink() ||
			(metadata.mode & 0o022) !== 0 ||
			(privateFile && (metadata.mode & 0o077) !== 0) ||
			(executable && (metadata.mode & 0o111) === 0) ||
			(kind === "file" && metadata.nlink !== 1) ||
			(processUid !== undefined && metadata.uid !== processUid)
		) {
			return undefined;
		}
		return { dev: metadata.dev, ino: metadata.ino };
	} catch {
		return undefined;
	}
}

async function metadataUnchanged(
	path: string,
	kind: "file" | "directory",
	baseline: AdmittedPathMetadata,
	privateFile = false,
	executable = kind === "file" && !privateFile,
) {
	const current = await admittedPathMetadata(
		path,
		kind,
		privateFile,
		executable,
	);
	return current?.dev === baseline.dev && current.ino === baseline.ino;
}

async function productionRun(
	command: BrowserUseNativeAdmissionCommand,
): Promise<BrowserUseNativeAdmissionCommandResult> {
	const child = Bun.spawn([...command.argv], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
		timeout: NATIVE_ADMISSION_TIMEOUT_MS,
		maxBuffer: MAXIMUM_NATIVE_OUTPUT_BYTES,
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

/**
 * Admit the fixed local binding-selection capability before any private picker.
 *
 * @param input - Fixed user home and canonical Browser Use configuration root
 * @param deps - Optional hermetic command adapter; production uses system code-signing checks
 * @returns An admitted broker/supervisor handle or one typed fail-closed state
 *
 * @example
 * ```typescript
 * await inspectBindingSelectionNativeCapability({
 *   home: '/Users/operator',
 *   configRoot: '/Users/operator/.config/browser-use',
 * })
 * ```
 */
export async function inspectBindingSelectionNativeCapability(
	input: BrowserUseBindingSelectionCapabilityInput,
	deps: BrowserUseNativeAdmissionDeps = { run: productionRun },
): Promise<BrowserUseBindingSelectionCapabilityResult> {
	if (!isAbsolute(input.home) || !isAbsolute(input.configRoot)) {
		return { status: "not-admitted", code: "installed-layout-unsafe" };
	}
	const productRoot = join(input.home, ".local", "browser-use-security");
	const appPath = join(productRoot, "ApprovalBroker.app");
	const brokerPath = join(appPath, "Contents", "MacOS", "ApprovalBroker");
	const supervisorPath = join(
		appPath,
		"Contents",
		"Helpers",
		"browser-use-op-supervisor",
	);
	const profilePath = join(appPath, "Contents", "embedded.provisionprofile");
	const verifierPath = join(input.configRoot, "reviewed-action-verifier.json");

	try {
		await lstat(appPath);
	} catch {
		return { status: "native-capability-absent" };
	}

	const [app, broker, supervisor, profile, verifierFile] = await Promise.all([
		admittedPathMetadata(appPath, "directory"),
		admittedPathMetadata(brokerPath, "file"),
		admittedPathMetadata(supervisorPath, "file"),
		admittedPathMetadata(profilePath, "file", false, false),
		admittedPathMetadata(verifierPath, "file", true),
	]);
	if (
		app === undefined ||
		broker === undefined ||
		supervisor === undefined ||
		profile === undefined ||
		verifierFile === undefined
	) {
		return { status: "not-admitted", code: "installed-layout-unsafe" };
	}

	const brokerSignature = await deps.run({
		kind: "verify-broker-signature",
		path: appPath,
		argv: [
			"/usr/bin/codesign",
			"--verify",
			"--strict",
			"--all-architectures",
			`-R=${approvalBrokerRequirement}`,
			appPath,
		],
	});
	if (brokerSignature.exitCode !== 0) {
		return { status: "not-admitted", code: "broker-signature-invalid" };
	}
	const brokerEntitlements = await deps.run({
		kind: "verify-broker-entitlements",
		path: appPath,
		argv: ["/usr/bin/codesign", "-d", "--entitlements", ":-", appPath],
	});
	if (
		brokerEntitlements.exitCode !== 0 ||
		!brokerEntitlementsAdmitted(brokerEntitlements.stdout)
	) {
		return { status: "not-admitted", code: "broker-entitlements-invalid" };
	}
	const supervisorSignature = await deps.run({
		kind: "verify-supervisor-signature",
		path: supervisorPath,
		argv: [
			"/usr/bin/codesign",
			"--verify",
			"--strict",
			"--all-architectures",
			`-R=${environmentSupervisorRequirement}`,
			supervisorPath,
		],
	});
	if (supervisorSignature.exitCode !== 0) {
		return { status: "not-admitted", code: "supervisor-signature-invalid" };
	}
	const productVersion = await deps.run({
		kind: "verify-product-version",
		path: join(appPath, "Contents", "Info.plist"),
		argv: [
			"/usr/bin/plutil",
			"-extract",
			"CFBundleShortVersionString",
			"raw",
			join(appPath, "Contents", "Info.plist"),
		],
	});
	if (
		productVersion.exitCode !== 0 ||
		productVersion.stdout.trim() !==
			BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.productVersion
	) {
		return { status: "not-admitted", code: "product-version-incompatible" };
	}

	let pinnedVerifier: BrowserUseInstalledVerifierIdentity | undefined;
	try {
		pinnedVerifier = pinnedVerifierOf(await readFile(verifierPath, "utf8"));
	} catch {
		pinnedVerifier = undefined;
	}
	if (pinnedVerifier === undefined) {
		return { status: "not-admitted", code: "verifier-pin-invalid" };
	}
	const brokerVerifierResult = await deps.run({
		kind: "broker-verifier",
		path: brokerPath,
		argv: [brokerPath, "verifier"],
	});
	const brokerVerifier =
		brokerVerifierResult.exitCode === 0
			? brokerVerifierOf(brokerVerifierResult.stdout)
			: undefined;
	if (brokerVerifier === undefined) {
		return { status: "not-admitted", code: "broker-verifier-invalid" };
	}
	if (
		brokerVerifier.key_id !== pinnedVerifier.key_id ||
		brokerVerifier.public_key !== pinnedVerifier.public_key
	) {
		return { status: "not-admitted", code: "verifier-pin-mismatch" };
	}
	const stable = await Promise.all([
		metadataUnchanged(appPath, "directory", app),
		metadataUnchanged(brokerPath, "file", broker),
		metadataUnchanged(supervisorPath, "file", supervisor),
		metadataUnchanged(profilePath, "file", profile, false, false),
		metadataUnchanged(verifierPath, "file", verifierFile, true),
	]);
	if (stable.some((entry) => !entry)) {
		return { status: "not-admitted", code: "installed-layout-unsafe" };
	}
	return {
		status: "admitted",
		brokerPath,
		supervisorPath,
		verifier: brokerVerifier,
	};
}
