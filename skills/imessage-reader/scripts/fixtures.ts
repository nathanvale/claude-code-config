/**
 * Build a synthetic attributedBody-style blob with the common streamtyped markers.
 */
function buildPrefix(): Buffer {
	return Buffer.concat([
		Buffer.from("streamtyped"),
		Buffer.from([0x01, 0x94, 0x84, 0x01]),
		Buffer.from("NSString"),
		Buffer.from([0x01]),
	]);
}

/**
 * Create a short-form attributedBody blob: `0x2B <1-byte len> <text>`.
 */
export function makeShortAttributedBody(text: string): Buffer {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length >= 0x80) {
		throw new Error(
			"Short attributedBody fixtures must be shorter than 128 bytes",
		);
	}
	return Buffer.concat([
		buildPrefix(),
		Buffer.from([0x2b, bytes.length]),
		bytes,
	]);
}

/**
 * Create a long-form attributedBody blob: `0x2B <2-byte len> <control bytes> <text>`.
 */
export function makeLongAttributedBody(
	text: string,
	controlBytes: number[] = [0x00],
): Buffer {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length < 0x80) {
		throw new Error("Long attributedBody fixtures must be at least 128 bytes");
	}

	const high = 0x80 | ((bytes.length >> 8) & 0x7f);
	const low = bytes.length & 0xff;
	return Buffer.concat([
		buildPrefix(),
		Buffer.from([0x2b, high, low, ...controlBytes]),
		bytes,
	]);
}

/**
 * Create a regression fixture where the short-form length byte is printable ASCII.
 */
export function makeJunkByteRegressionBlob(leading: "d" | "Z" = "d"): Buffer {
	const text = `${leading}`.repeat(100);
	return makeShortAttributedBody(text);
}

/**
 * Create a fixture that used to decode as `+` because of a nearby marker sequence.
 */
export function makePlusMarkerRegressionBlob(
	text = "The real message is here",
): Buffer {
	return Buffer.concat([
		buildPrefix(),
		Buffer.from([0x2b, 0x01, 0x2b]),
		Buffer.from([0x00]),
		makeShortAttributedBody(text),
	]);
}

/**
 * Create a strategy-2 fallback fixture with printable text but no NSString marker.
 */
export function makeHeuristicAttributedBody(text: string): Buffer {
	return Buffer.concat([
		Buffer.from("streamtyped"),
		Buffer.from([0x00, 0x00]),
		Buffer.from(text, "utf8"),
		Buffer.from([0x00]),
	]);
}
