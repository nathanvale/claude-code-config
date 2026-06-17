import { rmSync } from "node:fs";

export interface CleanupRegistry {
	readonly paths: string[];
	readonly servers: Array<{ stop: (closeActiveConnections?: boolean) => void }>;
}

export function createCleanupRegistry(): CleanupRegistry {
	return { paths: [], servers: [] };
}

export function drainCleanup(registry: CleanupRegistry): void {
	const errors: Error[] = [];
	for (const s of registry.servers.splice(0)) {
		try {
			s.stop(true);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	for (const p of registry.paths.splice(0)) {
		try {
			rmSync(p, { recursive: true, force: true });
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, "Fixture cleanup failed.");
	}
}
