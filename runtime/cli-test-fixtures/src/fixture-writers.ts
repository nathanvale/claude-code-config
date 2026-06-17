import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function writePackageJson(
	dir: string,
	content: Record<string, unknown>,
): void {
	writeFileSync(
		join(dir, "package.json"),
		`${JSON.stringify(content, null, "\t")}\n`,
	);
}
